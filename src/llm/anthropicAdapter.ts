import Anthropic from "@anthropic-ai/sdk";
import type { LlmJsonClient } from "./types.js";

const JSON_SUFFIX =
  "\n\nIMPORTANT: You MUST respond with a single valid JSON object only. No markdown fences, no commentary, no text outside the JSON.";

const parseJson = (raw: string): unknown => {
  const trimmed = raw.trim();
  const cleaned = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")
    : trimmed;

  try {
    return JSON.parse(cleaned) as unknown;
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse LLM JSON: ${cause}. Raw snippet: ${raw.slice(0, 200)}`);
  }
};

export const createAnthropicJsonClient = (apiKey: string): LlmJsonClient => {
  const client = new Anthropic({ apiKey });

  return {
    completeJsonObject: async (model, messages) => {
      const systemParts: string[] = [];
      const turns: { role: "user" | "assistant"; content: string }[] = [];

      for (const m of messages) {
        if (m.role === "system") {
          systemParts.push(m.content);
        } else {
          turns.push({ role: m.role, content: m.content });
        }
      }

      const system = systemParts.length > 0
        ? systemParts.join("\n\n") + JSON_SUFFIX
        : JSON_SUFFIX.trim();

      if (turns.length === 0 || turns[0].role !== "user") {
        turns.unshift({ role: "user", content: "Respond with JSON as instructed." });
      }

      const response = await client.messages.create({
        model,
        max_tokens: 8192,
        system,
        messages: turns,
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock === undefined || textBlock.type !== "text") {
        throw new Error("Anthropic returned no text content");
      }
      return parseJson(textBlock.text);
    },
  };
};
