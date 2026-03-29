import type OpenAI from "openai";
import type { Task } from "./types.js";
import { assertTasksShape } from "./types.js";

const DEFAULT_MODEL = "gpt-4o-mini";

/** Stricter than API max: keeps generated descriptions scannable. */
const MAX_GENERATED_DESCRIPTION_LENGTH = 6000;

const PRIMARY_LABELS = ["frontend", "backend", "infra", "tech-debt"] as const;
type PrimaryLabel = (typeof PRIMARY_LABELS)[number];

const PRIMARY_LABEL_SET: ReadonlySet<string> = new Set(PRIMARY_LABELS);

const BROAD_TITLE_PATTERNS: readonly RegExp[] = [
  /\bimplement\s+(the\s+)?(full|entire|complete|whole)\b/i,
  /\bbuild\s+(the\s+)?(full|entire|complete|whole)\b/i,
  /\bcreate\s+(the\s+)?(full|entire|complete|whole)\b/i,
  /\b(full|entire|complete)\s+(feature|system|application|app|product|platform)\b/i,
  /\bbuild\s+system\b/i,
  /\bumbrella\b/i,
  /^do\s+everything\b/i,
  /\ball\s+features\b/i,
];

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractSectionBody = (markdown: string, sectionTitle: string): string | null => {
  const lines = markdown.split(/\r?\n/);
  const headerRe = new RegExp(`^##\\s+${escapeRegex(sectionTitle)}\\s*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line !== undefined && headerRe.test(line)) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) {
    return null;
  }
  const body: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) {
      break;
    }
    if (/^##\s+/.test(line)) {
      break;
    }
    body.push(line);
  }
  const joined = body.join("\n").trim();
  return joined.length > 0 ? joined : null;
};

const scopeImpliesFrontend = (scope: string): boolean =>
  /\b(page|pages|component|components|ui|layout|modal|form|forms|css|styling|tailwind|client state|react|vue|svelte|browser)\b/i.test(
    scope,
  );

const scopeImpliesBackend = (scope: string): boolean =>
  /\b(api|apis|endpoint|endpoints|rest|graphql|database|db|migration|postgres|mysql|auth(n|orization)?|server|service layer|business logic)\b/i.test(
    scope,
  );

const canonicalizePrimaryLabel = (raw: string): PrimaryLabel => {
  const key = raw.trim().toLowerCase();
  if (key === "frontend" || key === "backend" || key === "infra" || key === "tech-debt") {
    return key;
  }
  throw new Error(`Invalid primary label: ${raw}`);
};

const validateGeneratedTaskQuality = (task: Task, index: number): string | null => {
  const { title, description, labels } = task;
  const prefix = `[task ${index + 1}]`;

  if (labels.length !== 1) {
    return `${prefix} Use exactly one primary label (frontend, backend, infra, or tech-debt). Found ${labels.length}.`;
  }

  const rawLabel = labels[0];
  if (rawLabel === undefined || !PRIMARY_LABEL_SET.has(rawLabel.trim().toLowerCase())) {
    return `${prefix} Label must be exactly one of: frontend, backend, infra, tech-debt.`;
  }

  if (description.length > MAX_GENERATED_DESCRIPTION_LENGTH) {
    return `${prefix} Description is too long; keep sections tight (max ${MAX_GENERATED_DESCRIPTION_LENGTH} characters).`;
  }

  if (!description.includes("## Acceptance Criteria")) {
    return `${prefix} Missing "## Acceptance Criteria" section.`;
  }

  const checklistPattern = /^\s*[*-]\s+\[[ x]\]\s+(.+)$/gim;
  const matches = [...description.matchAll(checklistPattern)];
  const substantive = matches.filter((m) => (m[1]?.trim().length ?? 0) >= 8);
  if (substantive.length < 2) {
    return `${prefix} Need at least two concrete, testable checklist lines under Acceptance Criteria (specific outcomes, not placeholders).`;
  }

  const trimmedTitle = title.trim();
  if (trimmedTitle.length < 12) {
    return `${prefix} Title is too vague; make it specific and actionable.`;
  }

  for (const pattern of BROAD_TITLE_PATTERNS) {
    if (pattern.test(trimmedTitle)) {
      return `${prefix} Title reads like an umbrella or multi-day effort; narrow scope to something finishable in part of a day.`;
    }
  }

  const scopeBody = extractSectionBody(description, "Scope");
  if (scopeBody !== null && scopeImpliesFrontend(scopeBody) && scopeImpliesBackend(scopeBody)) {
    return `${prefix} Scope mixes client UI work and server/API or data work; split into separate tasks.`;
  }

  return null;
};

const refineTasksOrThrow = (tasks: Task[]): Task[] => {
  const errors: string[] = [];
  tasks.forEach((task, index) => {
    const message = validateGeneratedTaskQuality(task, index);
    if (message !== null) {
      errors.push(message);
    }
  });
  if (errors.length > 0) {
    throw new Error(`Generated tasks failed quality checks: ${errors.join(" | ")}`);
  }
  return tasks.map((task) => {
    const raw = task.labels[0];
    if (raw === undefined) {
      throw new Error("Internal error: missing label after quality validation");
    }
    return {
      ...task,
      labels: [canonicalizePrimaryLabel(raw)],
    };
  });
};

const SYSTEM_PROMPT = `You are a product manager assistant. Turn the user's request into GitHub issues that engineers can ship quickly.

Output a single JSON object only (no markdown fences, no commentary):
{"tasks":[{"title":"string","description":"string","labels":["string"]}]}

Quality rules (follow closely):

- Each issue stands alone: another engineer can read only that issue and know what to do without reading the others.
- Each issue delivers obvious user or system value—no filler or "misc" buckets.
- Scope each issue so a competent developer could finish it in part of a day (not a week-long epic).
- Acceptance criteria must be concrete and verifiable—no hand-wavy bullets.
- Do not create umbrella issues (e.g. "implement the full product", "build the entire system", "do everything for feature X").

Task count: use the minimum number of issues that still keeps work clear. Do not pad.
- Small, focused asks: about 1–3 issues.
- Medium scope: about 3–6 issues.
- Large, multi-part asks: about 5–10 issues (stay closer to 5 unless separation truly needs more).

Frontend vs backend: never combine client UI work (pages, components, styling, client state) with server work (APIs, auth, database, business rules) in the same issue. If both are needed, split into separate issues. Only add both sides when the request truly needs them.

Each task's description MUST be GitHub-flavored Markdown and MUST use this template (replace placeholders with concise, direct content—no essays):

## Context

<short: why this exists>

## Goal

<one clear outcome>

## Scope

<only what this issue covers—single layer (UI OR server/data OR infra OR refactor)>

## Technical Notes

<brief implementation hints only>

## Acceptance Criteria

* [ ] <specific, testable outcome>
* [ ] <specific, testable outcome>

## Out of Scope

<what someone else will handle or follow-up work>

Labels — exactly ONE label per task, spelled exactly:

- frontend — UI, components, pages, styling, client state
- backend — APIs, authentication, database, business logic
- infra — setup, configuration, CI/CD
- tech-debt — refactoring or improvements without new product behavior

Never put frontend and backend on the same task. Pick the single best-fitting label.`;

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
        content: `Break the following into GitHub issues as JSON. Match scope to size: few issues for small asks, more only when the work truly splits.

User request:

${userRequest}`,
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
  return refineTasksOrThrow(payload.tasks);
};
