import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 60_000;
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist"]);
const DIRECTORY_OPEN_FLAGS = constants.O_RDONLY
  | constants.O_DIRECTORY
  | constants.O_NOFOLLOW;

export type WorkspaceEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WorkspaceEntry[];
};

export type WorkspaceCommandOutput = (
  stream: "stdout" | "stderr",
  data: string,
) => void;

export type WorkspaceCommandResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
};

export type WorkspaceCommand = {
  process: ChildProcess;
  completion: Promise<WorkspaceCommandResult>;
  stop: () => void;
};

export type WorkspaceCommandOptions = {
  timeoutMs?: number;
};

export function isIgnoredWorkspacePath(relativePath: string) {
  return relativePath.split(/[\\/]/).some((component) => IGNORED_DIRECTORIES.has(component));
}

function isContained(base: string, target: string) {
  const pathFromBase = relative(base, target);
  return pathFromBase === ""
    || (!pathFromBase.startsWith(`..${sep}`)
      && pathFromBase !== ".."
      && !isAbsolute(pathFromBase));
}

function assertContained(base: string, target: string) {
  if (!isContained(base, target)) {
    throw new Error("Path is outside the workspace.");
  }
}

export async function resolveWorkspacePath(root: string, relativePath: string) {
  const base = await realpath(root);
  const target = resolve(base, relativePath);
  assertContained(base, target);
  return target;
}

function descriptorPath(handle: FileHandle, name?: string) {
  // Node has no portable openat/openat2 API. On Linux, each directory handle
  // pins the traversed inode and /proc/self/fd supplies descriptor-relative
  // lookup; O_NOFOLLOW plus explicit lstat rejection prevents every path
  // component from being swapped to a symlink between validation and access.
  const base = `/proc/self/fd/${handle.fd}`;
  return name === undefined ? base : `${base}/${name}`;
}

function relativeComponents(base: string, target: string) {
  const pathFromBase = relative(base, target);
  return pathFromBase === "" ? [] : pathFromBase.split(sep);
}

function symbolicLinkError() {
  return new Error("Symbolic links are not allowed in workspace paths.");
}

async function assertNotSymbolicLink(parent: FileHandle, name: string) {
  try {
    if ((await lstat(descriptorPath(parent, name))).isSymbolicLink()) {
      throw symbolicLinkError();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw symbolicLinkError();
    }
    throw error;
  }
}

async function openChildDirectory(parent: FileHandle, name: string) {
  await assertNotSymbolicLink(parent, name);
  try {
    return await open(descriptorPath(parent, name), DIRECTORY_OPEN_FLAGS);
  } catch (error) {
    if (["ELOOP", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      throw symbolicLinkError();
    }
    throw error;
  }
}

async function openWorkspaceRoot(root: string) {
  const base = await realpath(root);
  return { base, handle: await open(base, DIRECTORY_OPEN_FLAGS) };
}

async function openParentDirectory(
  root: string,
  relativePath: string,
  createMissing: boolean,
) {
  const { base, handle: rootHandle } = await openWorkspaceRoot(root);
  const target = resolve(base, relativePath);
  assertContained(base, target);
  const components = relativeComponents(base, target);
  if (components.length === 0) {
    await rootHandle.close();
    throw new Error("A workspace file path is required.");
  }

  const handles = [rootHandle];
  try {
    let current = rootHandle;
    for (const component of components.slice(0, -1)) {
      if (createMissing) {
        try {
          await mkdir(descriptorPath(current, component));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
            throw error;
          }
        }
      }
      current = await openChildDirectory(current, component);
      handles.push(current);
    }
    return { handles, parent: current, name: components.at(-1)! };
  } catch (error) {
    await Promise.all(handles.map((handle) => handle.close()));
    throw error;
  }
}

function assertTextSize(size: number) {
  if (size > MAX_TEXT_FILE_BYTES) {
    throw new Error("File exceeds the 1 MiB limit.");
  }
}

function assertText(buffer: Buffer) {
  if (buffer.includes(0)) {
    throw new Error("Binary files are not supported.");
  }
}

export async function readWorkspaceFile(root: string, relativePath: string) {
  const { handles, parent, name } = await openParentDirectory(root, relativePath, false);
  let file: FileHandle | undefined;
  try {
    await assertNotSymbolicLink(parent, name);
    file = await open(descriptorPath(parent, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.nlink !== 1) {
      throw new Error("Workspace reads require a regular, unlinked file.");
    }
    assertTextSize(metadata.size);
    const content = await file.readFile();
    assertText(content);
    return content.toString("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw symbolicLinkError();
    }
    throw error;
  } finally {
    await file?.close();
    await Promise.all(handles.map((handle) => handle.close()));
  }
}

export async function writeWorkspaceFile(
  root: string,
  relativePath: string,
  content: string,
) {
  const encoded = Buffer.from(content, "utf8");
  assertTextSize(encoded.byteLength);
  assertText(encoded);

  const { handles, parent, name } = await openParentDirectory(root, relativePath, true);
  let file: FileHandle | undefined;
  try {
    try {
      await assertNotSymbolicLink(parent, name);
      file = await open(
        descriptorPath(parent, name),
        constants.O_WRONLY | constants.O_NOFOLLOW,
      );
      const metadata = await file.stat();
      if (!metadata.isFile() || metadata.nlink !== 1) {
        throw new Error("Workspace writes require a regular, unlinked file.");
      }
      await file.truncate(0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      file = await open(
        descriptorPath(parent, name),
        constants.O_WRONLY
          | constants.O_CREAT
          | constants.O_EXCL
          | constants.O_NOFOLLOW,
        0o644,
      );
    }
    await file.writeFile(encoded);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw symbolicLinkError();
    }
    throw error;
  } finally {
    await file?.close();
    await Promise.all(handles.map((handle) => handle.close()));
  }
}

async function readTreeDirectory(
  directory: FileHandle,
  relativeDirectory = "",
): Promise<WorkspaceEntry[]> {
  const entries = await readdir(descriptorPath(directory), { withFileTypes: true });
  const tree: WorkspaceEntry[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink() || (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name))) {
      continue;
    }

    const workspacePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) {
      let child: FileHandle | undefined;
      try {
        child = await openChildDirectory(directory, entry.name);
        tree.push({
          name: entry.name,
          path: workspacePath,
          type: "directory",
          children: await readTreeDirectory(child, workspacePath),
        });
      } finally {
        await child?.close();
      }
    } else if (entry.isFile()) {
      tree.push({ name: entry.name, path: workspacePath, type: "file" });
    }
  }

  return tree;
}

export async function listWorkspaceTree(root: string) {
  const { handle } = await openWorkspaceRoot(root);
  try {
    return await readTreeDirectory(handle);
  } finally {
    await handle.close();
  }
}

export function isAllowedWorkspaceCommand(command: string) {
  return command.trim().length > 0;
}

function terminateProcessGroup(child: ChildProcess) {
  if (child.pid === undefined) {
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
  const forceKill = setTimeout(() => {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        console.error("Failed to kill workspace process group:", error);
      }
    }
  }, 250);
  forceKill.unref();
}

export async function runWorkspaceCommand(
  root: string,
  command: string,
  onOutput: WorkspaceCommandOutput,
  options: WorkspaceCommandOptions = {},
): Promise<WorkspaceCommand> {
  if (!isAllowedWorkspaceCommand(command)) {
    throw new Error("A workspace command is required.");
  }

  const base = await realpath(root);
  const child = spawn(command, {
    cwd: base,
    detached: true,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    terminateProcessGroup(child);
  }, options.timeoutMs ?? COMMAND_TIMEOUT_MS);
  timeout.unref();

  child.stdout?.on("data", (chunk: Buffer) => onOutput("stdout", chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => onOutput("stderr", chunk.toString()));

  const completion = new Promise<WorkspaceCommandResult>((resolveCompletion, reject) => {
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolveCompletion({ code, signal, timedOut });
    });
  });

  return {
    process: child,
    completion,
    stop: () => terminateProcessGroup(child),
  };
}
