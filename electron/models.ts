export type OpenRouterModel = {
  id: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
};

export function isFreeOpenRouterModel({ pricing }: OpenRouterModel) {
  return Number(pricing?.prompt) === 0 && Number(pricing?.completion) === 0;
}
