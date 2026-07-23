import { describe, expect, it } from "vitest";
import { initialChatState, reduceChat } from "./chat";

describe("reduceChat", () => {
  it("adds a user message to the transcript", () => {
    const message = {
      id: "u1",
      conversationId: "coding",
      role: "user" as const,
      content: "Explain this file",
      createdAt: "2026-07-23T00:00:00.000Z",
      status: "complete" as const,
    };

    const state = reduceChat(initialChatState, { type: "addMessage", message } as never);

    expect(state.messages).toEqual([message]);
  });

  it("appends a streamed delta to the active assistant message", () => {
    const state = reduceChat(initialChatState, {
      type: "appendDelta",
      conversationId: "c1",
      delta: "Hello",
    });

    expect(state.messages[0].content).toBe("Hello");
  });
});
