import type { ToolCall } from "./tools.js";

export type OpenRouterToolCall = {
  id: string;
  function: { name: string; arguments: string };
};

export function normalizeOpenRouterToolCall(call: OpenRouterToolCall): { id: string; call: ToolCall } {
  let argumentsValue: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(call.function.arguments);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) argumentsValue = parsed;
  } catch { /* tool execution returns a recoverable error below */ }
  return { id: call.id, call: { function: { name: call.function.name, arguments: argumentsValue } } };
}
