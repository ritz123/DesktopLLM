import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export type ToolCall = { function: { name: string; arguments: Record<string, unknown> | string } };
export type NormalizedToolCall = { function: { name: string; arguments: Record<string, unknown> } };
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

const TOOL_NAME_ALIASES: Record<string, string> = {
  web_fetch: "fetch_page",
  web_browse: "fetch_page",
  browse_page: "fetch_page",
  search: "web_search",
  websearch: "web_search",
};

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* keep string as single-value fallback below */ }
  return {};
}

const KNOWN_TOOL_NAMES = new Set([
  ...agentTools.map((tool) => tool.function.name),
  ...Object.keys(TOOL_NAME_ALIASES),
]);

function parseOneToolPayload(raw: string): ToolCall | null {
  try {
    const obj = JSON.parse(raw.trim()) as Record<string, unknown>;
    const nested = obj.function && typeof obj.function === "object" ? obj.function as Record<string, unknown> : null;
    const name = String(obj.name || nested?.name || "").trim();
    if (!name) return null;
    const args = parseToolArguments(obj.arguments ?? obj.parameters ?? nested?.arguments ?? {});
    return { function: { name, arguments: args } };
  } catch {
    return null;
  }
}

function extractBalancedJsonObjects(text: string): string[] {
  const objects: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    const extracted = extractBalancedJsonAt(text, i);
    if (!extracted) continue;
    objects.push(extracted.json);
    i = extracted.end - 1;
  }
  return objects;
}

function extractBalancedJsonAt(text: string, start: number): { json: string; end: number } | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let j = start; j < text.length; j++) {
    const ch = text[j];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { json: text.slice(start, j + 1), end: j + 1 };
    }
  }
  return null;
}

function recoverToolCallsFromJsonBlobs(text: string): NormalizedToolCall[] {
  return extractBalancedJsonObjects(text)
    .map(parseOneToolPayload)
    .filter((call): call is ToolCall => Boolean(call))
    .map(normalizeToolCall)
    .filter((call) => KNOWN_TOOL_NAMES.has(call.function.name) || Object.values(TOOL_NAME_ALIASES).includes(call.function.name));
}

/** Models like nanbeige print `web_search\\n{"query":...}fetch_page\\n{"url":...}` without a name field inside the JSON. */
function recoverNamePrefixedToolCalls(text: string): NormalizedToolCall[] {
  const names = [...KNOWN_TOOL_NAMES].sort((a, b) => b.length - a.length);
  const nameRe = new RegExp(`\\b(${names.join("|")})\\b`, "gi");
  const calls: ToolCall[] = [];
  let match: RegExpExecArray | null;
  while ((match = nameRe.exec(text)) !== null) {
    const name = match[1];
    const afterName = text.slice(match.index + name.length);
    const braceOffset = afterName.search(/\{/);
    if (braceOffset < 0 || braceOffset > 120) continue;
    const extracted = extractBalancedJsonAt(afterName, braceOffset);
    if (!extracted) continue;
    let args: Record<string, unknown>;
    try {
      args = parseToolArguments(JSON.parse(extracted.json));
    } catch {
      continue;
    }
    if (!Object.keys(args).length) continue;
    calls.push({ function: { name, arguments: args } });
    nameRe.lastIndex = match.index + name.length + extracted.end;
  }
  return calls.map(normalizeToolCall);
}

function contentLooksLikePrintedToolCall(text: string) {
  return /<\/?tool_call\b/i.test(text) ||
    /^tool_call\b/im.test(text) ||
    text.trimStart().startsWith("{") ||
    /```(?:json)?/i.test(text) ||
    new RegExp(`(?:^|\\n)\\s*(?:${[...KNOWN_TOOL_NAMES].join("|")})\\b`, "i").test(text);
}

export { contentLooksLikePrintedToolCall };

export function isWebDeflectionAnswer(text: string) {
  const value = text.trim();
  if (!value) return false;
  return /please visit|visit (their|the|this)?\s*(website|site|page)|check (their|the) (website|site)|go to (their|the) (website|site)|for (the )?latest .+ visit/i.test(value)
    || /technical limitations?|unable to (retrieve|fetch|access|get)|could not (retrieve|fetch|access)|cannot (retrieve|fetch|access)|wasn't able to (retrieve|fetch)|real-time headlines directly|based on .{0,80}(structure|typically covered)/i.test(value)
    || (/apologize|oversight|unable to (browse|access|fetch)/i.test(value) && /https?:\/\//i.test(value) && value.length < 600)
    || (/https?:\/\/[^\s)]+/i.test(value) && value.length < 280 && !/\b(headline|reported|according to)\b/i.test(value));
}

export function latestSuccessfulToolContent(history: unknown[]) {
  for (let index = history.length - 1; index >= 0; index--) {
    const item = history[index] as { role?: string; content?: string };
    if (item?.role !== "tool" || typeof item.content !== "string" || !item.content.trim()) continue;
    if (/failed:/i.test(item.content)) continue;
    return item.content.trim();
  }
  return null;
}

/** Recover tool calls that weak models print as assistant text instead of native tool_calls. */
export function parseToolCallsFromText(content: string): NormalizedToolCall[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  const fromTags = [...trimmed.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/\s*tool_call>/gi)]
    .map((match) => parseOneToolPayload(match[1] || ""))
    .filter((call): call is ToolCall => Boolean(call));
  if (fromTags.length) return fromTags.map(normalizeToolCall);

  const prefixed = recoverNamePrefixedToolCalls(trimmed);
  if (prefixed.length) return prefixed;

  if (!contentLooksLikePrintedToolCall(trimmed)) return [];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const fromFence = recoverToolCallsFromJsonBlobs(fenced);
    if (fromFence.length) return fromFence;
  }

  return recoverToolCallsFromJsonBlobs(trimmed);
}

export function normalizeToolCall(call: ToolCall): NormalizedToolCall {
  const nameMatch = call.function.name.match(/^([a-z_]+)/i);
  const rawName = (nameMatch?.[1] || call.function.name).toLowerCase();
  const name = TOOL_NAME_ALIASES[rawName] || rawName;
  const key = call.function.name.match(/<?arg_key>([^<]+)<\/arg_key>/i)?.[1];
  const value = call.function.name.match(/<?arg_value>([^<]+)<\/arg_value>/i)?.[1];
  const arguments_ = parseToolArguments(call.function.arguments);
  return {
    function: {
      name,
      arguments: key && value ? { ...arguments_, [key]: value } : arguments_,
    },
  };
}

export function isAllowedCommand(command: string) {
  const trimmed = command.trim();
  return trimmed.length > 0 && !/\b(sudo|pkexec|doas)\b/i.test(trimmed);
}

export function extractPublicUrl(value: string) {
  return value.match(/https?:\/\/[^\s<>"']+/i)?.[0] || value.trim();
}

export function formatToolError(name: string, error: unknown) {
  const detail = error instanceof Error ? error.message : "Unknown tool error.";
  return `${name} failed: ${detail} Try another source or approach.`;
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
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\.[a-zA-Z_-][\w-]*(?:\s*,\s*\.[a-zA-Z_-][\w-]*)*\s*\{[^}]*\}/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24_000);
}

function cleanHeadlineText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(?:x27|39);/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulHeadline(text: string) {
  return text.length >= 28 &&
    text.length <= 180 &&
    !/[{};]|fill:|padding:|margin:|font-|\.mrth|advertisement|arrow-|facebook|whatsapp|vjl-|order-\d|flex-basis|max-width/i.test(text);
}

/** Prefer heading text so models get usable page content instead of a noisy HTML blob. */
export function extractReadablePageText(html: string) {
  const trimmed = html.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return `fetch_page succeeded. JSON response:\n${trimmed.slice(0, 8_000)}`;
  }

  const fromHeadings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => cleanHeadlineText(match[1]))
    .filter(isUsefulHeadline);

  // Page body often starts late (after huge CSS/nav). Scan anchors from the latter half if needed.
  const anchorSource = fromHeadings.length >= 5 ? "" : html.slice(Math.floor(html.length * 0.45));
  const fromAnchors = anchorSource
    ? [...anchorSource.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match) => cleanHeadlineText(match[1]))
      .filter(isUsefulHeadline)
    : [];

  const headlines = [...fromHeadings, ...fromAnchors]
    .filter((text, index, all) => all.indexOf(text) === index)
    .slice(0, 30);

  if (headlines.length >= 5) {
    return `fetch_page succeeded. Concrete page headlines:\n${headlines.map((line) => `- ${line}`).join("\n")}`.slice(0, 12_000);
  }

  const bodyStart = html.search(/<h[1-3]\b/i);
  const body = bodyStart >= 0 ? html.slice(bodyStart) : html.slice(Math.floor(html.length * 0.5));
  return `fetch_page succeeded. Page text:\n${sanitizeText(body).slice(0, 8_000)}`;
}

function decodeDuckDuckGoUrl(href: string) {
  try {
    const absolute = href.startsWith("//") ? `https:${href}` : href;
    const uddg = new URL(absolute, "https://duckduckgo.com").searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : absolute;
  } catch {
    return href;
  }
}

/** Extract title/url/snippet rows from DuckDuckGo HTML instead of dumping page chrome. */
export function extractSearchResults(html: string) {
  const titles = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => cleanHeadlineText(match[1]));
  const lines: string[] = [];
  for (let index = 0; index < Math.min(titles.length, 8); index++) {
    const href = titles[index][1];
    const title = cleanHeadlineText(titles[index][2]);
    if (!title || title.length < 8) continue;
    const url = decodeDuckDuckGoUrl(href);
    const snippet = snippets[index] || "";
    lines.push(`- ${title}${snippet ? `\n  ${snippet}` : ""}\n  ${url}`);
  }
  if (!lines.length) {
    return `web_search succeeded. Search results:\n${sanitizeText(html).slice(0, 2_000)}`;
  }
  return `web_search succeeded. Search results:\n${lines.join("\n")}`.slice(0, 6_000);
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
  const { name, arguments: args } = normalizeToolCall(call).function;
  if (name === "web_search" || name === "fetch_page") {
    if (!webAccess) throw new Error("Web tools are disabled in Settings.");
  }
  if (name === "web_search") {
    const query = String(args.query || "").slice(0, 400);
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": "DesktopLLM/0.1" },
    });
    if (!response.ok) throw new Error("Web search failed.");
    return { name, content: extractSearchResults(await response.text()) };
  }
  if (name === "fetch_page") {
    const url = extractPublicUrl(String(args.url || ""));
    if (!isSafePublicUrl(url)) throw new Error("Only public HTTP(S) URLs are allowed.");
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "DesktopLLM/0.1" } });
    if (!response.ok || !isSafePublicUrl(response.url)) throw new Error("Page fetch was rejected.");
    return { name, content: extractReadablePageText(await response.text()) };
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
