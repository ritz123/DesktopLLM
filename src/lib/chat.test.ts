import { describe, expect, it } from "vitest";
import { initialChatState, parseChatMessages, reduceChat } from "./chat";

describe("reduceChat", () => {
  it("restores a valid stored transcript", () => {
    const messages = [{
      id: "u1",
      conversationId: "one",
      role: "user",
      content: "Persist me",
      createdAt: "2026-07-23T00:00:00.000Z",
      status: "complete",
    }];

    expect(parseChatMessages(JSON.stringify(messages))).toEqual(messages);
    expect(parseChatMessages("not JSON")).toEqual([]);
  });

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

  it("removes every message belonging to a deleted conversation", () => {
    const state = {
      messages: [
        { id: "u1", conversationId: "one", role: "user" as const, content: "Delete me", createdAt: "2026-07-23T00:00:00.000Z" },
        { id: "u2", conversationId: "two", role: "user" as const, content: "Keep me", createdAt: "2026-07-23T00:00:00.000Z" },
      ],
    };

    const deleted = reduceChat(state, { type: "removeConversation", conversationId: "one" } as never);

    expect(deleted.messages).toEqual([state.messages[1]]);
  });

  it("marks the active assistant message as failed", () => {
    const state = reduceChat(initialChatState, {
      type: "appendDelta",
      conversationId: "one",
      delta: "Partial reply",
    });

    const failed = reduceChat(state, { type: "failAssistant", conversationId: "one" } as never);

    expect(failed.messages[0]?.status).toBe("error");
  });

  it("adds a streaming assistant placeholder while waiting for a response", () => {
    const state = reduceChat(initialChatState, { type: "startAssistant", conversationId: "one" } as never);

    expect(state.messages[0]).toMatchObject({
      conversationId: "one",
      role: "assistant",
      content: "",
      status: "streaming",
    });
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
