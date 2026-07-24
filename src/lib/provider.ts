export type Provider = "ollama" | "openrouter";

export function shouldFallbackToOllama(provider: Provider, modelCount: number) {
  return provider === "openrouter" && modelCount === 0;
}
