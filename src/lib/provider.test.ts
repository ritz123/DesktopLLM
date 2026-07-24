import { describe, expect, it } from "vitest";
import { shouldFallbackToOllama } from "./provider";

describe("shouldFallbackToOllama", () => {
  it("falls back when OpenRouter has no usable models", () => {
    expect(shouldFallbackToOllama("openrouter", 0)).toBe(true);
  });

  it("keeps OpenRouter when free models are available", () => {
    expect(shouldFallbackToOllama("openrouter", 1)).toBe(false);
  });

  it("does not replace Ollama", () => {
    expect(shouldFallbackToOllama("ollama", 0)).toBe(false);
  });
});
