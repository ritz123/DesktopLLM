import { describe, expect, it } from "vitest";
import { clampPaneSize } from "./panes";

describe("clampPaneSize", () => {
  it("keeps a pane size within its configured bounds", () => {
    expect(clampPaneSize(120, 180, 420)).toBe(180);
    expect(clampPaneSize(300, 180, 420)).toBe(300);
    expect(clampPaneSize(500, 180, 420)).toBe(420);
  });
});
