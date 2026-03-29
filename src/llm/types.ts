export type LlmProvider = "openai" | "anthropic";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmJsonClient = {
  completeJsonObject: (model: string, messages: ChatMessage[]) => Promise<unknown>;
};
