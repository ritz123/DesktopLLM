import { describe, expect, it } from "vitest";
import { isFreeOpenRouterModel } from "./models.js";

describe("isFreeOpenRouterModel", () => {
  it("requires both prompt and completion prices to be zero", () => {
    expect(isFreeOpenRouterModel({ id: "provider/model", pricing: { prompt: "0", completion: "0" } })).toBe(true);
    expect(isFreeOpenRouterModel({ id: "provider/model:free", pricing: { prompt: "0.000001", completion: "0" } })).toBe(false);
    expect(isFreeOpenRouterModel({ id: "provider/model", pricing: { prompt: "0", completion: "0.000001" } })).toBe(false);
    expect(isFreeOpenRouterModel({ id: "provider/model" })).toBe(false);
  });
});
