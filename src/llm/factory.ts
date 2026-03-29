import type { LlmProvider, LlmJsonClient } from "./types.js";
import { createOpenAIJsonClient } from "./openaiAdapter.js";
import { createAnthropicJsonClient } from "./anthropicAdapter.js";

export const createLlmJsonClient = (
  provider: LlmProvider,
  apiKey: string,
): LlmJsonClient => {
  if (provider === "anthropic") {
    return createAnthropicJsonClient(apiKey);
  }
  return createOpenAIJsonClient(apiKey);
};
