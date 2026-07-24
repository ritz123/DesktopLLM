export type OpenRouterModel = { id: string; name?: string };

export function isFreeOpenRouterModel({ id, name }: OpenRouterModel) {
  return /free/i.test(id) || /free/i.test(name ?? "");
}
