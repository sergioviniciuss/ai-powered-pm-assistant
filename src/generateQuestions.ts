import type OpenAI from "openai";

export const generateClarifyingQuestions = async (
  client: OpenAI,
  input: string,
): Promise<string[]> => {
  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a senior product manager.

Your job is to identify missing or ambiguous details in a feature request.

Ask 3 to 5 concise, high-impact clarification questions.

Rules:
- Focus on product behavior, not implementation details
- Avoid tech stack questions
- Avoid trivial questions
- Prefer questions that affect UX, data flow, or behavior
- Keep questions short and clear
- Output JSON: {"questions": ["...", "..."]}`,
      },
      {
        role: "user",
        content: input,
      },
    ],
  });

  const raw = res.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("Failed to generate clarification questions");
  }

  const parsed = JSON.parse(raw) as { questions?: string[] };
  return parsed.questions ?? [];
};
