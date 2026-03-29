import type { LlmJsonClient } from "./llm/index.js";

const SYSTEM_PROMPT = `You are a senior product manager.

Your job is to identify missing or ambiguous details in a feature request.

Ask 3 to 5 concise, high-impact clarification questions.

Rules:
- Focus on product behavior, not implementation details
- Avoid tech stack questions
- Avoid trivial questions
- Prefer questions that affect UX, data flow, or behavior
- Keep questions short and clear
- Output JSON: {"questions": ["...", "..."]}`;

export const generateClarifyingQuestions = async (
  client: LlmJsonClient,
  model: string,
  input: string,
): Promise<string[]> => {
  const parsed = (await client.completeJsonObject(model, [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: input },
  ])) as { questions?: string[] };

  return parsed.questions ?? [];
};
