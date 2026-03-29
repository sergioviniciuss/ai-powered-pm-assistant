import type OpenAI from "openai";
import type { Task } from "./types.js";
import { assertTasksShape } from "./types.js";

const DEFAULT_MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `You are a product manager assistant. The user describes work to be done. You break it into separate GitHub issues.

Respond with a single JSON object only (no markdown fences, no commentary) with this exact shape:
{"tasks":[{"title":"string","description":"string","labels":["string"]}]}

Each task's description MUST be GitHub-flavored Markdown and MUST follow this template exactly (replace angle-bracket placeholders with real content):

## Context

<what this task is about>

## Goal

<clear objective>

## Scope

<what is included>

## Technical Notes

<any implementation hints>

## Acceptance Criteria

* [ ] criteria 1
* [ ] criteria 2

## Out of Scope

<what should not be done>

Label rules — assign one or more of these labels to each task based on content (use exact spellings):
- frontend — UI, components, styling, client-side work
- backend — API, database, server, business logic
- infra — config, CI/CD, deployment, environment setup
- tech-debt — refactoring, cleanup, deprecation without new features

If multiple apply, include multiple labels. Prefer the most specific labels.`;

export const generateTasks = async (
  client: OpenAI,
  userRequest: string,
  model: string = DEFAULT_MODEL,
): Promise<Task[]> => {
  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Break the following into GitHub issues as JSON:\n\n${userRequest}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (raw === undefined || raw === null || raw.trim().length === 0) {
    throw new Error("OpenAI returned an empty response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse OpenAI JSON: ${cause}. Raw snippet: ${raw.slice(0, 200)}`);
  }

  const payload = assertTasksShape(parsed);
  return payload.tasks;
};
