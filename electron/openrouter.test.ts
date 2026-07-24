import { describe, expect, it } from "vitest";
import { normalizeOpenRouterToolCall } from "./openrouter.js";

describe("normalizeOpenRouterToolCall", () => {
  it("parses OpenAI-compatible JSON arguments", () => {
    expect(normalizeOpenRouterToolCall({
      id: "call_1",
      function: { name: "read_file", arguments: "{\"path\":\"/workspace/a.ts\"}" },
    })).toEqual({
      id: "call_1",
      call: { function: { name: "read_file", arguments: { path: "/workspace/a.ts" } } },
    });
  });
});
