import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export type ToolCall = { function: { name: string; arguments: Record<string, unknown> } };
export type ToolResult = { name: string; content: string };

export const agentTools = [
  { type: "function", function: { name: "web_search", description: "Search the public web for current information.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "fetch_page", description: "Fetch readable text from a public web page.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
  { type: "function", function: { name: "list_directory", description: "List a permitted local directory.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "read_file", description: "Read text from a permitted local file.", parameters: { type: "object", properties: { path: { type: "string" }, start_line: { type: "number" }, end_line: { type: "number" } }, required: ["path"] } } },
  { type: "function", function: { name: "write_file", description: "Create or replace a text file in a permitted local folder.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
];

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

async function allowedPath(path: string, roots: string[], forWrite = false) {
  const target = resolve(path);
  const candidate = forWrite ? await realpath(dirname(target)) : await realpath(target);
  const canonical = forWrite ? resolve(candidate, target.slice(dirname(target).length + 1)) : candidate;
  const permitted = await Promise.all(roots.map(async (root) => {
    const base = await realpath(root);
    return relative(base, canonical) && !relative(base, canonical).startsWith("..") || canonical === base;
  }));
  if (!isAbsolute(target) || !permitted.some(Boolean)) throw new Error("Path is outside the selected folders.");
  return target;
}

export async function executeTool(call: ToolCall, roots: string[]): Promise<ToolResult> {
  const { name, arguments: args } = call.function;
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
  const path = String(args.path || "");
  if (name === "list_directory") {
    const safe = await allowedPath(path, roots);
    return { name, content: JSON.stringify((await readdir(safe, { withFileTypes: true })).slice(0, 200).map((item) => ({ name: item.name, type: item.isDirectory() ? "directory" : "file" }))) };
  }
  if (name === "read_file") {
    const safe = await allowedPath(path, roots);
    if ((await stat(safe)).size > 256_000) throw new Error("File exceeds the 256 KB tool limit.");
    const lines = (await readFile(safe, "utf8")).split("\n");
    return { name, content: lines.slice(Math.max(0, Number(args.start_line || 1) - 1), Math.min(lines.length, Number(args.end_line || lines.length))).join("\n") };
  }
  if (name === "write_file") {
    const safe = await allowedPath(path, roots, true);
    const content = String(args.content || "");
    if (content.length > 256_000) throw new Error("Write exceeds the 256 KB tool limit.");
    await mkdir(dirname(safe), { recursive: true });
    await writeFile(`${safe}.desktopllm-tmp`, content, "utf8");
    await writeFile(safe, content, "utf8");
    return { name, content: `Wrote ${content.length} bytes to ${safe}` };
  }
  throw new Error(`Unknown tool: ${name}`);
}
