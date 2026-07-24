export type OpenRouterModel = {
  id: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
};

export function isFreeOpenRouterModel({ pricing, supported_parameters }: OpenRouterModel) {
  return Number(pricing?.prompt) === 0 &&
    Number(pricing?.completion) === 0 &&
    supported_parameters?.includes("tools") === true;
}
