import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ChatMessage, LlmJsonClient } from "./types.js";

const toOpenAIMessages = (messages: ChatMessage[]): ChatCompletionMessageParam[] =>
  messages.map((m) => ({ role: m.role, content: m.content }));

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse LLM JSON: ${cause}. Raw snippet: ${raw.slice(0, 200)}`);
  }
};

export const createOpenAIJsonClient = (apiKey: string): LlmJsonClient => {
  const client = new OpenAI({ apiKey });

  return {
    completeJsonObject: async (model, messages) => {
      const completion = await client.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: toOpenAIMessages(messages),
      });
      const raw = completion.choices[0]?.message?.content;
      if (raw === undefined || raw === null || raw.trim().length === 0) {
        throw new Error("OpenAI returned an empty response");
      }
      return parseJson(raw);
    },
  };
};
