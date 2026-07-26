import { describe, expect, it } from "vitest";
import { defaultWebLookupCalls, extractPublicUrl, extractReadablePageText, formatToolError, headlinesFromToolHistory, isAllowedCommand, isSafePublicUrl, isWebDeflectionAnswer, looksLikeCurrentInfoRequest, normalizeToolCall, parseToolCallsFromText, sanitizeText } from "./tools.js";

describe("agent tool safeguards", () => {
  it("rejects privileged commands", () => {
    expect(isAllowedCommand("npm test")).toBe(true);
    expect(isAllowedCommand("sudo apt install git")).toBe(false);
    expect(isAllowedCommand("pkexec whoami")).toBe(false);
  });

  it("rejects private and local URLs", () => {
    expect(isSafePublicUrl("http://127.0.0.1:11434")).toBe(false);
    expect(isSafePublicUrl("http://localhost/secrets")).toBe(false);
    expect(isSafePublicUrl("https://example.com")).toBe(true);
  });

  it("removes scripts from fetched page text", () => {
    expect(sanitizeText("<h1>Hello</h1><script>steal()</script>")).toBe("Hello");
  });

  it("normalizes XML-style tool arguments emitted in a tool name", () => {
    expect(normalizeToolCall({
      function: {
        name: "fetch_page <arg_key>url</arg_key><arg_value>https://example.com/news</arg_value>",
        arguments: {},
      },
    })).toEqual({
      function: {
        name: "fetch_page",
        arguments: { url: "https://example.com/news" },
      },
    });
  });

  it("extracts a public URL from malformed tool argument text", () => {
    expect(extractPublicUrl("<arg_value>https://www.timesofindia.indiatimes.com/city/delhi/news</arg_value>"))
      .toBe("https://www.timesofindia.indiatimes.com/city/delhi/news");
  });

  it("returns a recoverable tool failure for the agent", () => {
    expect(formatToolError("fetch_page", new Error("Page fetch was rejected.")))
      .toBe("fetch_page failed: Page fetch was rejected. Try another source or approach.");
  });

  it("aliases web_fetch to fetch_page", () => {
    expect(normalizeToolCall({
      function: { name: "web_fetch", arguments: { url: "https://www.ndtv.in/latest-news" } },
    })).toEqual({
      function: { name: "fetch_page", arguments: { url: "https://www.ndtv.in/latest-news" } },
    });
  });

  it("parses JSON string arguments", () => {
    expect(normalizeToolCall({
      function: { name: "fetch_page", arguments: "{\"url\":\"https://example.com\"}" },
    })).toEqual({
      function: { name: "fetch_page", arguments: { url: "https://example.com" } },
    });
  });

  it("recovers tool calls printed as assistant text by weak models", () => {
    expect(parseToolCallsFromText(`
<tool_call>
{"name": "web_fetch", "arguments": {"url": "https://www.ndtv.in/latest-news"}}
</tool_call>
`)).toEqual([{
      function: { name: "fetch_page", arguments: { url: "https://www.ndtv.in/latest-news" } },
    }]);
  });

  it("recovers unclosed web_search tool markup from weak models", () => {
    expect(parseToolCallsFromText(`
<tool_call>
{"name": "web_search", "arguments": {"query":"LinkedIn jobs remote anywhere work location filter"}}
`)).toEqual([{
      function: {
        name: "web_search",
        arguments: { query: "LinkedIn jobs remote anywhere work location filter" },
      },
    }]);
  });

  it("recovers tool JSON after a broken closing tag", () => {
    expect(parseToolCallsFromText(`
<tool_call>
{"name": "web_search", "arguments": {"query":"remote anywhere LinkedIn"}}
</ tool_call>
`)).toEqual([{
      function: { name: "web_search", arguments: { query: "remote anywhere LinkedIn" } },
    }]);
  });

  it("recovers name-prefixed tool calls concatenated with placeholder prose", () => {
    expect(parseToolCallsFromText(`web_search
{"query": "latest news update from Bangalore"}fetch_page
{"url": "https://timesofindia.indiatimes.com/city/bangalore"}
The latest news updates from Bangalore are as follows:

Headline 1 - Brief summary of the news item.
`)).toEqual([
      { function: { name: "web_search", arguments: { query: "latest news update from Bangalore" } } },
      { function: { name: "fetch_page", arguments: { url: "https://timesofindia.indiatimes.com/city/bangalore" } } },
    ]);
  });

  it("ignores ordinary assistant prose without tool markup", () => {
    expect(parseToolCallsFromText("Here is a summary of the news.")).toEqual([]);
  });

  it("detects website-deflection answers", () => {
    expect(isWebDeflectionAnswer("I apologize for the oversight. For the latest news from NDTV, please visit their website at [NDTV News](https://www.ndtv.com/).")).toBe(true);
    expect(isWebDeflectionAnswer("Due to technical limitations in the current tool environment, I was unable to retrieve real-time headlines directly.")).toBe(true);
    expect(isWebDeflectionAnswer("Here are three concrete NDTV headlines about Bengaluru traffic and weather.")).toBe(false);
  });

  it("detects current-info requests and builds a default NDTV lookup", () => {
    expect(looksLikeCurrentInfoRequest("get me the latest news from ndtv")).toBe(true);
    expect(defaultWebLookupCalls("get me the latest news from ndtv")).toEqual([
      { function: { name: "fetch_page", arguments: { url: "https://www.ndtv.com/latest" } } },
    ]);
  });

  it("extracts concrete headlines from news page HTML", () => {
    const html = `
      <h2>PM Modi Announces Task Force On Exam Reforms Under Infosys Co-Founder</h2>
      <a href="/1">Body Parts Scattered: 4 Killed As Molten Metal Explodes In Assam Factory</a>
      <a href="/2">Man Hacks 8-Month Pregnant Wife To Death. Children, 5 And 2, Bear Witness</a>
      <a href="/3">Won't Delete: BJP MP's Daughter's Viral Post On Dharmendra Pradhan</a>
      <a href="/4">NEP Architect, NEET Row: Dharmendra Pradhan's 4 Years As Education Minister</a>
      <a href="/5">Tamil Nadu Supplementary Result 2026: Classes 10, 12 Marksheet Soon</a>
    `;
    const text = extractReadablePageText(html);
    expect(text).toContain("fetch_page succeeded");
    expect(text).toContain("PM Modi Announces Task Force On Exam Reforms Under Infosys Co-Founder");
    expect(text).toContain("Tamil Nadu Supplementary Result 2026: Classes 10, 12 Marksheet Soon");
  });

  it("recovers headlines from prior tool history when the model fails", () => {
    expect(headlinesFromToolHistory([
      { role: "tool", tool_name: "fetch_page", content: "fetch_page succeeded. Concrete page headlines:\n- One\n- Two" },
    ])).toContain("- One");
  });
});
