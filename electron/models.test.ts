import { describe, expect, it } from "vitest";
import { isFreeOpenRouterModel } from "./models.js";

describe("isFreeOpenRouterModel", () => {
  it("matches free in either ID or display name without regard to case", () => {
    expect(isFreeOpenRouterModel({ id: "provider/model:FREE" })).toBe(true);
    expect(isFreeOpenRouterModel({ id: "provider/model", name: "Model (Free)" })).toBe(true);
    expect(isFreeOpenRouterModel({ id: "provider/paid-model", name: "Paid Model" })).toBe(false);
  });
});
