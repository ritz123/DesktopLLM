import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isAllowedWorkspaceCommand,
  listWorkspaceTree,
  readWorkspaceFile,
  runWorkspaceCommand,
  writeWorkspaceFile,
} from "./workspace.js";

const temporaryDirectories: string[] = [];

async function makeWorkspace() {
  const parent = await mkdtemp(join(tmpdir(), "desktopllm-workspace-"));
  const root = join(parent, "project");
  await mkdir(root);
  temporaryDirectories.push(parent);
  return { parent, root };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true }),
  ));
});

async function waitForFile(path: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

describe("workspace filesystem boundary", () => {
  it("rejects paths outside the workspace", async () => {
    const { parent, root } = await makeWorkspace();
    await writeFile(join(parent, "outside.txt"), "secret");

    await expect(readWorkspaceFile(root, "../outside.txt"))
      .rejects.toThrow("outside the workspace");
  });

  it("rejects reads and writes through symlinks outside the workspace", async () => {
    const { parent, root } = await makeWorkspace();
    const outside = join(parent, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(outside, join(root, "escape"));

    await expect(readWorkspaceFile(root, "escape/secret.txt"))
      .rejects.toThrow("Symbolic links are not allowed");
    await expect(writeWorkspaceFile(root, "escape/new.txt", "no"))
      .rejects.toThrow("Symbolic links are not allowed");
  });

  it("rejects every symlink component instead of validating then following it", async () => {
    const { root } = await makeWorkspace();
    await mkdir(join(root, "real"));
    await writeFile(join(root, "real", "file.txt"), "inside");
    await symlink(join(root, "real"), join(root, "linked"));

    await expect(readWorkspaceFile(root, "linked/file.txt"))
      .rejects.toThrow("Symbolic links are not allowed");
    await expect(writeWorkspaceFile(root, "linked/new.txt", "no"))
      .rejects.toThrow("Symbolic links are not allowed");
  });

  it("writes text files and creates their parent directories", async () => {
    const { root } = await makeWorkspace();

    await writeWorkspaceFile(root, "src/nested/file.ts", "export {};\n");

    await expect(readFile(join(root, "src/nested/file.ts"), "utf8"))
      .resolves.toBe("export {};\n");
  });

  it("rejects binary and oversized text files", async () => {
    const { root } = await makeWorkspace();
    await writeFile(join(root, "binary.dat"), Buffer.from([65, 0, 66]));
    await writeFile(join(root, "large.txt"), "a".repeat(1024 * 1024 + 1));

    await expect(readWorkspaceFile(root, "binary.dat"))
      .rejects.toThrow("Binary files are not supported");
    await expect(readWorkspaceFile(root, "large.txt"))
      .rejects.toThrow("File exceeds the 1 MiB limit");
    await expect(writeWorkspaceFile(root, "large-write.txt", "a".repeat(1024 * 1024 + 1)))
      .rejects.toThrow("File exceeds the 1 MiB limit");
  });

  it("omits ignored heavy directories from the workspace tree", async () => {
    const { root } = await makeWorkspace();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "index.ts"), "export {};\n");
    for (const directory of ["node_modules", ".git", "dist"]) {
      await mkdir(join(root, directory));
      await writeFile(join(root, directory, "ignored.txt"), "ignored");
    }

    const tree = await listWorkspaceTree(root);

    expect(tree.map((entry) => entry.name)).toEqual(["src"]);
    expect(tree[0]?.children?.map((entry) => entry.path)).toEqual(["src/index.ts"]);
  });
});

describe("workspace command boundary", () => {
  it("accepts user-level developer commands without policy filtering", () => {
    expect(isAllowedWorkspaceCommand("npm test")).toBe(true);
    expect(isAllowedWorkspaceCommand("rm -rf generated")).toBe(true);
    expect(isAllowedWorkspaceCommand("node -e \"require('node:fs').writeFileSync('generated.ts', 'export {}')\"")).toBe(true);
    expect(isAllowedWorkspaceCommand("git clean -fdx && git status")).toBe(true);
    expect(isAllowedWorkspaceCommand("sudo true")).toBe(true);
  });

  it("rejects only an empty command", () => {
    expect(isAllowedWorkspaceCommand("")).toBe(false);
    expect(isAllowedWorkspaceCommand("   ")).toBe(false);
  });

  it("executes raw commands from the selected workspace and streams both outputs", async () => {
    const { root } = await makeWorkspace();
    const output: Array<{ stream: "stdout" | "stderr"; data: string }> = [];

    const command = await runWorkspaceCommand(root, [
      "node -e",
      "\"process.stdout.write(process.cwd()); process.stderr.write('diagnostic')\"",
    ].join(" "), (stream, data) => output.push({ stream, data }));
    const result = await command.completion;

    expect(result).toEqual({ code: 0, signal: null, timedOut: false });
    expect(output).toEqual(expect.arrayContaining([
      { stream: "stdout", data: root },
      { stream: "stderr", data: "diagnostic" },
    ]));
  });

  it("marks a command as timed out and terminates it", async () => {
    const { root } = await makeWorkspace();
    await writeFile(join(root, "sleeper.cjs"), "setInterval(() => {}, 1000);");

    const command = await runWorkspaceCommand(root, "node sleeper.cjs", () => undefined, {
      timeoutMs: 20,
    });

    await expect(command.completion).resolves.toMatchObject({ timedOut: true });
  });

  it("cancels a detached process group including descendants", async () => {
    const { root } = await makeWorkspace();
    const pidFile = join(root, "processes.json");
    await writeFile(join(root, "child.cjs"), `
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
`);
    await writeFile(join(root, "sleeper.cjs"), `
const { fork } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const child = fork("child.cjs", [], { stdio: "ignore" });
writeFileSync("processes.json", JSON.stringify({ parent: process.pid, child: child.pid }));
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
`);

    const command = await runWorkspaceCommand(root, "node sleeper.cjs", () => undefined);
    const processIds = JSON.parse(await waitForFile(pidFile)) as {
      parent: number;
      child: number;
    };
    const processStat = await readFile(`/proc/${command.process.pid}/stat`, "utf8");
    const processGroupId = Number(processStat.slice(processStat.lastIndexOf(")") + 2).split(" ")[2]);
    expect(processGroupId).toBe(command.process.pid);
    command.stop();
    await command.completion;

    const processStopped = async (pid: number) => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    };
    try {
      await expect.poll(async () => ({
        parent: await processStopped(processIds.parent),
        child: await processStopped(processIds.child),
      })).toEqual({ parent: true, child: true });
    } finally {
      for (const pid of [processIds.parent, processIds.child]) {
        if (!(await processStopped(pid))) {
          process.kill(pid, "SIGKILL");
        }
      }
    }
  });
});
