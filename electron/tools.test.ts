import { describe, expect, it } from "vitest";
import { isAllowedCommand, isSafePublicUrl, sanitizeText } from "./tools.js";

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
});
