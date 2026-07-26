import { describe, expect, it } from "vitest";
import { extractPublicUrl, formatToolError, isAllowedCommand, isSafePublicUrl, normalizeToolCall, parseToolCallsFromText, sanitizeText } from "./tools.js";

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

  it("ignores ordinary assistant prose without tool markup", () => {
    expect(parseToolCallsFromText("Here is a summary of the news.")).toEqual([]);
  });
});
