# Default OpenRouter provider

## Goal

Prefer OpenRouter on startup when its stored API key is valid, while preserving Ollama as an automatic fallback.

## Design

The renderer starts by selecting OpenRouter. Its existing model-discovery request is the key-validity check: a successful nonempty model response retains OpenRouter and selects the first free model. A failed request—including a missing, invalid, or rejected API key—or an empty result automatically switches the provider to Ollama, which then performs its normal model discovery.

The encrypted OpenRouter key remains inaccessible to the renderer. No settings API change is needed.

## Verification

Add focused tests for provider-selection fallback behavior and run the complete test suite and production build.
