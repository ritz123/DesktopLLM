import { describe, expect, it } from "vitest";
import { initialChatState, reduceChat } from "./chat";

describe("reduceChat", () => {
  it("appends a streamed delta to the active assistant message", () => {
    const state = reduceChat(initialChatState, {
      type: "appendDelta",
      conversationId: "c1",
      delta: "Hello",
    });

    expect(state.messages[0].content).toBe("Hello");
  });
});
