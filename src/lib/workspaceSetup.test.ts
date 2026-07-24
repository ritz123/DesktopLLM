import { describe, expect, it } from "vitest";
import { needsWorkspaceSetup } from "./workspaceSetup";

describe("needsWorkspaceSetup", () => {
  it("requires setup only when neither workspace is configured", () => {
    expect(needsWorkspaceSetup()).toBe(true);
    expect(needsWorkspaceSetup("/chat")).toBe(false);
    expect(needsWorkspaceSetup(undefined, "/code")).toBe(false);
  });
});
