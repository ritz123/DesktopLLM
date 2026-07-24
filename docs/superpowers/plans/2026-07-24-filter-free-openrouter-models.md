# Filter Free OpenRouter Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exclude OpenRouter models whose ID or display name contains `free`, case-insensitively, from all model selectors.

**Architecture:** Add a small, pure Electron-side predicate module that identifies free OpenRouter model records. `listModels` applies it to OpenRouter's API response before returning descriptors over the existing IPC boundary, so Chat and Code share the same filtered list.

**Tech Stack:** TypeScript 5.7, Electron 35, Vitest 3.

## Global Constraints

- Only OpenRouter discovery is filtered; Ollama discovery remains unchanged.
- A model is free when its ID or optional display name contains `free`, case-insensitively.
- Existing OpenRouter error and authentication behavior remains unchanged.

---

### Task 1: Add and use the OpenRouter free-model predicate

**Files:**
- Create: `electron/models.ts`
- Modify: `electron/main.ts:155-179`
- Create: `electron/models.test.ts`

**Interfaces:**
- Produces: `isFreeOpenRouterModel(model: { id: string; name?: string }): boolean`, exported from `electron/models.ts`.
- Consumes: OpenRouter `GET /api/v1/models` records with `id` and optional `name`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { isFreeOpenRouterModel } from "./models.js";

describe("isFreeOpenRouterModel", () => {
  it("matches free in either ID or display name without regard to case", () => {
    expect(isFreeOpenRouterModel({ id: "provider/model:FREE" })).toBe(true);
    expect(isFreeOpenRouterModel({ id: "provider/model", name: "Model (Free)" })).toBe(true);
    expect(isFreeOpenRouterModel({ id: "provider/paid-model", name: "Paid Model" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/models.test.ts`

Expected: FAIL because `./models.js` does not exist.

- [ ] **Step 3: Add the predicate and filter OpenRouter records**

```ts
export type OpenRouterModel = { id: string; name?: string };

export function isFreeOpenRouterModel({ id, name }: OpenRouterModel) {
  return /free/i.test(id) || /free/i.test(name ?? "");
}
```

Save the snippet in `electron/models.ts`. In `electron/main.ts`, import `OpenRouterModel` and `isFreeOpenRouterModel` from `./models.js`; then update the OpenRouter response handling to use `OpenRouterModel` and return:

```ts
return data.data
  .filter((model) => !isFreeOpenRouterModel(model))
  .map(({ id, name }) => ({ provider, id, label: name || id }));
```

- [ ] **Step 4: Run the targeted test to verify it passes**

Run: `npx vitest run electron/models.test.ts`

Expected: PASS with one passing test.

- [ ] **Step 5: Run full verification**

Run: `npm test -- --run && npm run build`

Expected: all Vitest tests pass and TypeScript/Vite build completes successfully.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts electron/models.ts electron/models.test.ts
git commit -m "feat: filter free OpenRouter models"
```
