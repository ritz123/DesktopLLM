import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export type ToolCall = { function: { name: string; arguments: Record<string, unknown> } };
export type ToolResult = { name: string; content: string };

export const agentTools = [
  { type: "function", function: { name: "web_search", description: "Search the public web for current information.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "fetch_page", description: "Fetch readable text from a public web page.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
  { type: "function", function: { name: "list_directory", description: "List a directory in the work folder.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "read_file", description: "Read text from a file in the work folder.", parameters: { type: "object", properties: { path: { type: "string" }, start_line: { type: "number" }, end_line: { type: "number" } }, required: ["path"] } } },
  { type: "function", function: { name: "write_file", description: "Create or replace a text file in the work folder.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "run_command", description: "Run a shell command in the work folder.", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
];

const COMMAND_TIMEOUT_MS = 60_000;
const MAX_COMMAND_OUTPUT = 24_000;

export function isAllowedCommand(command: string) {
  const trimmed = command.trim();
  return trimmed.length > 0 && !/\b(sudo|pkexec|doas)\b/i.test(trimmed);
}

export function isSafePublicUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !["localhost", "0.0.0.0", "::1"].includes(host) &&
      !/^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  } catch { return false; }
}

export function sanitizeText(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 24_000);
}

function requireWorkFolder(workFolder?: string) {
  if (!workFolder) throw new Error("Select a work folder before using local file or command tools.");
  return workFolder;
}

async function allowedPath(path: string, workFolder: string, forWrite = false) {
  const root = await realpath(workFolder);
  const target = resolve(path);
  const candidate = forWrite ? await realpath(dirname(target)) : await realpath(target);
  const canonical = forWrite ? resolve(candidate, target.slice(dirname(target).length + 1)) : candidate;
  const pathFromRoot = relative(root, canonical);
  if (!isAbsolute(target) || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("Path is outside the work folder.");
  }
  return target;
}

async function runCommand(command: string, workFolder: string) {
  if (!isAllowedCommand(command)) throw new Error("Privileged commands like sudo are not allowed.");
  const cwd = await realpath(workFolder);
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, COMMAND_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      const output = [stdout.trim(), stderr.trim() ? `stderr:\n${stderr.trim()}` : ""].filter(Boolean).join("\n\n");
      const summary = [
        `$ ${command}`,
        output || "(no output)",
        `exit ${code ?? "unknown"}${timedOut ? " (timed out)" : ""}`,
      ].join("\n\n");
      resolvePromise(summary.slice(0, MAX_COMMAND_OUTPUT));
    });
  });
}

export function toolsForAgent(webAccess: boolean) {
  const allowed = new Set(["list_directory", "read_file", "write_file", "run_command", ...(webAccess ? ["web_search", "fetch_page"] : [])]);
  return agentTools.filter((tool) => allowed.has(tool.function.name));
}

export async function executeTool(call: ToolCall, workFolder: string | undefined, webAccess = true): Promise<ToolResult> {
  const { name, arguments: args } = call.function;
  if (name === "web_search" || name === "fetch_page") {
    if (!webAccess) throw new Error("Web tools are disabled in Settings.");
  }
  if (name === "web_search") {
    const query = String(args.query || "").slice(0, 400);
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error("Web search failed.");
    return { name, content: sanitizeText(await response.text()).slice(0, 12_000) };
  }
  if (name === "fetch_page") {
    const url = String(args.url || "");
    if (!isSafePublicUrl(url)) throw new Error("Only public HTTP(S) URLs are allowed.");
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "DesktopLLM/0.1" } });
    if (!response.ok || !isSafePublicUrl(response.url)) throw new Error("Page fetch was rejected.");
    return { name, content: sanitizeText(await response.text()) };
  }
  const folder = requireWorkFolder(workFolder);
  const path = String(args.path || "");
  if (name === "list_directory") {
    const safe = await allowedPath(path, folder);
    return { name, content: JSON.stringify((await readdir(safe, { withFileTypes: true })).slice(0, 200).map((item) => ({ name: item.name, type: item.isDirectory() ? "directory" : "file" }))) };
  }
  if (name === "read_file") {
    const safe = await allowedPath(path, folder);
    if ((await stat(safe)).size > 256_000) throw new Error("File exceeds the 256 KB tool limit.");
    const lines = (await readFile(safe, "utf8")).split("\n");
    return { name, content: lines.slice(Math.max(0, Number(args.start_line || 1) - 1), Math.min(lines.length, Number(args.end_line || lines.length))).join("\n") };
  }
  if (name === "write_file") {
    const safe = await allowedPath(path, folder, true);
    const content = String(args.content || "");
    if (content.length > 256_000) throw new Error("Write exceeds the 256 KB tool limit.");
    await mkdir(dirname(safe), { recursive: true });
    await writeFile(`${safe}.desktopllm-tmp`, content, "utf8");
    await writeFile(safe, content, "utf8");
    return { name, content: `Wrote ${content.length} bytes to ${safe}` };
  }
  if (name === "run_command") {
    const command = String(args.command || "");
    return { name, content: await runCommand(command, folder) };
  }
  throw new Error(`Unknown tool: ${name}`);
}
