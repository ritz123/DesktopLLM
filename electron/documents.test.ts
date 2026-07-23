import { describe, expect, it } from "vitest";
import { formatAttachmentContext } from "./documents.js";

describe("formatAttachmentContext", () => {
  it("labels each extracted document for the model", () => {
    expect(formatAttachmentContext([{ path: "/tmp/notes.md", text: "Hello" }]))
      .toContain("[Attached document: notes.md]\nHello");
  });
});
