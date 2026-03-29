import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { Task } from "./types.js";
import { assertTasksShape } from "./types.js";

/** Default OpenAI chat model when --model is omitted. */
export const DEFAULT_CHAT_MODEL_ID = "gpt-4o";

export const resolveChatModelId = (raw: string | undefined): string => {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_CHAT_MODEL_ID;
  }
  const key = raw.trim().toLowerCase();
  if (key === "fast") {
    return "gpt-4o-mini";
  }
  if (key === "smart") {
    return "gpt-4o";
  }
  if (key === "gpt-4o") {
    return "gpt-4o";
  }
  if (key === "gpt-4o-mini") {
    return "gpt-4o-mini";
  }
  throw new Error(
    `Invalid --model value "${raw.trim()}". Use: fast (gpt-4o-mini), smart (gpt-4o), gpt-4o, or gpt-4o-mini.`,
  );
};

const PRIMARY_LABELS = ["frontend", "backend", "infra", "tech-debt"] as const;
type PrimaryLabel = (typeof PRIMARY_LABELS)[number];

const PRIMARY_LABEL_SET: ReadonlySet<string> = new Set(PRIMARY_LABELS);

const canonicalizePrimaryLabel = (raw: string): PrimaryLabel => {
  const key = raw.trim().toLowerCase();
  if (key === "frontend" || key === "backend" || key === "infra" || key === "tech-debt") {
    return key;
  }
  throw new Error(`Invalid primary label: ${raw}`);
};

const stripAcceptanceCriteriaSection = (markdown: string): string => {
  const lines = markdown.split(/\r?\n/);
  const acIndex = lines.findIndex((line) => /^##\s+Acceptance Criteria/i.test(line.trim()));
  if (acIndex === -1) {
    return markdown;
  }
  return lines.slice(0, acIndex).join("\n").trimEnd();
};

const extractAcceptanceCriteriaContent = (markdown: string): string | null => {
  const lines = markdown.split(/\r?\n/);
  const acIndex = lines.findIndex((line) => /^##\s+Acceptance Criteria/i.test(line.trim()));
  if (acIndex === -1) {
    return null;
  }
  const body: string[] = [];
  for (let i = acIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) {
      break;
    }
    if (/^##\s+/.test(line.trim())) {
      break;
    }
    body.push(line);
  }
  const joined = body.join("\n").trim();
  return joined.length > 0 ? joined : null;
};

const GENERIC_AC_PATTERN =
  /(fully implemented|works as expected|functional|behaves correctly|handles.*gracefully|returns expected response|renders correctly|triggers expected behavior|appropriate error)/i;

const hasGenericAcceptanceCriteria = (description: string): boolean => {
  const ac = extractAcceptanceCriteriaContent(description);
  if (ac === null) {
    return false;
  }
  return GENERIC_AC_PATTERN.test(ac);
};

const buildFallbackAcceptanceCriteria = (task: Task): string[] => {
  const primary = task.labels[0]?.trim().toLowerCase() ?? "";

  if (primary === "backend") {
    return [
      "POST endpoint returns 200 for valid input",
      "Returns 400 for invalid input",
    ];
  }

  if (primary === "frontend") {
    return [
      "Form shows validation error for invalid input",
      "User is redirected after successful submission",
    ];
  }

  const titleT = task.title.trim();
  const subject = titleT.length > 0 ? titleT : "Feature";
  return [
    `${subject} produces the correct output for valid input`,
    `${subject} returns a clear error for invalid input`,
  ];
};

const applyWordSubstitutions = (text: string): string =>
  text
    .replace(/\bdesign\b/gi, "implement")
    .replace(/\bwireframe\b/gi, "UI")
    .replace(/\bdiagram\b/gi, "")
    .replace(/\buser flow\b/gi, "flow logic");

const normalizeTask = (task: Task): Task => {
  const title = task.title.trim();

  const cleanedTitle = title
    .replace(/^\s*(design|define|plan|research|explore)\s+/i, "Implement ")
    .replace(/\bwireframes?\b/gi, "UI")
    .replace(/\bdiagrams?\b/gi, "")
    .replace(/\buser flows?\b/gi, "flow logic");

  const baseDescription = applyWordSubstitutions(
    stripAcceptanceCriteriaSection(task.description),
  ).trim();

  const existingAc = extractAcceptanceCriteriaContent(task.description);

  let acceptanceCriteriaBlock: string;
  if (existingAc !== null) {
    acceptanceCriteriaBlock = applyWordSubstitutions(existingAc);
  } else {
    acceptanceCriteriaBlock = buildFallbackAcceptanceCriteria(task)
      .map((c) => `* [ ] ${c}`)
      .join("\n");
  }

  return {
    ...task,
    title: cleanedTitle,
    description: `${baseDescription}

## Acceptance Criteria

${acceptanceCriteriaBlock}`,
  };
};

const validateGeneratedTaskQuality = (task: Task, index: number): string | null => {
  const { title, labels } = task;
  const prefix = `[task ${index + 1}]`;

  if (labels.length !== 1) {
    return `${prefix} Use exactly one primary label (frontend, backend, infra, or tech-debt). Found ${labels.length}.`;
  }

  const rawLabel = labels[0];
  if (rawLabel === undefined || !PRIMARY_LABEL_SET.has(rawLabel.trim().toLowerCase())) {
    return `${prefix} Label must be exactly one of: frontend, backend, infra, tech-debt.`;
  }

  if (title.trim().length === 0) {
    return `${prefix} Title must not be empty.`;
  }

  if (hasGenericAcceptanceCriteria(task.description)) {
    return `${prefix} Acceptance Criteria is too generic. Use concrete, testable outcomes.`;
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

type RefineTasksOutcome =
  | { readonly success: true; readonly tasks: Task[] }
  | { readonly success: false; readonly validationErrorMessage: string };

const tryRefineTasks = (tasks: Task[]): RefineTasksOutcome => {
  try {
    return { success: true, tasks: refineTasksOrThrow(tasks) };
  } catch (e) {
    const validationErrorMessage = e instanceof Error ? e.message : String(e);
    return { success: false, validationErrorMessage };
  }
};

const AC_REPAIR_SYSTEM_PROMPT = `You are a senior QA engineer. Your job is to rewrite vague Acceptance Criteria into concrete, testable outcomes.

Rewrite ONLY the Acceptance Criteria of these tasks.
Make them concrete and testable.
Avoid generic phrases like "works as expected", "fully implemented", "behaves correctly", "handles errors gracefully", "returns expected response", "renders correctly", "triggers expected behavior", "appropriate error".
Use specific API responses, UI behavior, or state transitions.

Output JSON: {"tasks":[{"title":"string","description":"string","labels":["string"]}]}

Do NOT modify task titles, labels, or the non-AC parts of descriptions. Only rewrite the ## Acceptance Criteria section.`;

const repairAcceptanceCriteria = async (
  client: OpenAI,
  model: string,
  tasks: Task[],
): Promise<Task[]> => {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: AC_REPAIR_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify({ tasks }, null, 2) },
  ];
  const parsed = await fetchJsonObjectCompletion(client, model, messages);
  const payload = assertTasksShape(parsed);
  return payload.tasks;
};

const injectFallbackAcIfGeneric = (task: Task): Task => {
  if (!hasGenericAcceptanceCriteria(task.description)) {
    return task;
  }
  const base = stripAcceptanceCriteriaSection(task.description).trim();
  const acBlock = buildFallbackAcceptanceCriteria(task)
    .map((c) => `* [ ] ${c}`)
    .join("\n");

  return {
    ...task,
    description: `${base}\n\n## Acceptance Criteria\n\n${acBlock}`,
  };
};

const REPAIR_SYSTEM_SUFFIX = `

---
Repair pass: You must fix the tasks so they pass strict validation rules. Keep all tasks, but correct labels, scope, titles, and description content where needed. Respond with JSON only in the same shape: {"tasks":[{"title":"string","description":"string","labels":["string"]}]}. Do not change task meaning or structure unnecessarily.`;

const parseCompletionContentToJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse OpenAI JSON: ${cause}. Raw snippet: ${raw.slice(0, 200)}`);
  }
};

const fetchJsonObjectCompletion = async (
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
): Promise<unknown> => {
  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages,
  });
  const raw = completion.choices[0]?.message?.content;
  if (raw === undefined || raw === null || raw.trim().length === 0) {
    throw new Error("OpenAI returned an empty response");
  }
  return parseCompletionContentToJson(raw);
};

const SYSTEM_PROMPT = `You are a product manager assistant. Turn the user's request into GitHub issues that engineers can ship quickly.

Output a single JSON object only (no markdown fences, no commentary):
{"tasks":[{"title":"string","description":"string","labels":["string"]}]}

End-to-end completeness:
- Together, the tasks must implement what the user asked for in a realistic, product-ready way—no skipping persistence, contracts, or cross-layer wiring where they matter.
- Stay concrete; avoid toy breakdowns.

Coverage enforcement:
- Identify all major feature areas mentioned in the user request
- Ensure each feature area is represented by at least one task
- Do NOT omit any core part of the request

Example:

User request: "onboarding with login and dashboard"

Must include tasks for:
- onboarding
- login/authentication
- dashboard

If any area is missing, the output is invalid.

Layer-aware planning (include only what applies): client surface; application/service contracts and rules; durable state; integration between layers.

Ordering and execution realism:
- Prefer system-first: do not prioritize UI-only work before the data and server capabilities that surface needs exist—schedule backend or data tasks before or alongside dependent UI, not after by default.
- Backend granularity: avoid one ticket that bundles unrelated server concerns; split when it clarifies work (e.g. distinct rules vs pipeline or cross-cutting hooks vs schema or persistence changes). Do not over-split for ceremony.
- Integration: when UI depends on services, include explicit integration tasks (calling contracts, handling success and failure paths, reflecting results in client state or cache) as separate issues when that keeps each task single-purpose—without fragmenting needlessly.

Coverage: if multiple layers matter, cover them all; do not emit only one layer when others are clearly required. Sequence so dependencies make sense.

Decomposition: one primary responsibility per issue, independently readable and implementable in part of a day; verifiable acceptance criteria; no umbrella tickets; merge or split for meaningful units, not noise.

Non-overlapping responsibilities (strict):
- Each task must own a distinct concern (e.g. registration, login, session, data retrieval).
- Do NOT create separate tasks that would share implementation logic — merge them instead.
- Token generation belongs inside login/authentication tasks, not as a standalone generic task.
- If two tasks would touch the same endpoint, service method, or component, combine them into one.

Non-executable tasks are strictly forbidden.

Do NOT generate tasks that:
- involve only design, planning, or documentation
- include words like "design", "define", "plan", "research", "explore"
- produce artifacts like wireframes, diagrams, or UX flows without implementation

If such a task would normally be generated, replace it with an equivalent executable task.

Examples:
- Instead of "Design onboarding flow" → generate "Implement onboarding UI flow"
- Instead of "Create wireframes" → generate "Build onboarding UI components"

Task count: adaptive minimum for coverage—do not pad. Typical bands: small 1–3, medium 3–6, large 5–10 (bias toward fewer unless separation truly helps).

Layer separation (non-negotiable): never mix client presentation with server or data implementation in one issue. Name technologies only if the user did or clarity requires it.

Description template (GitHub Markdown; concise; generic unless the user specified a domain). Omit "## Out of Scope" unless it prevents real duplication or confusion—do not use it to artificially fence related work.

Acceptance Criteria — include the "## Acceptance Criteria" section in every description, with 2–4 task-specific outcomes:
- Each outcome must be on its own line, starting with "- " (plain dash, no brackets)
- Each outcome must be specific to THIS task's title and scope — not generic
- Define exact inputs, exact outputs, and visible behavior
- Do NOT write generic lines. The following are strictly forbidden:
  - "API returns expected response"
  - "UI renders correctly"
  - "works as described"
  - "handles edge cases"
  - "returns appropriate error response"
  - "behaves correctly"
  - "triggers expected behavior"
- Keep outcomes short and verifiable

BAD acceptance criteria (never write these):
- API returns expected response for valid input
- Invalid input returns appropriate error response
- UI renders correctly based on requirements
- User interactions trigger expected behavior

GOOD acceptance criteria (always write like these):

Example for a backend task titled "Implement User Login API":
## Acceptance Criteria
- POST /auth/login returns a JWT token when credentials are valid
- POST /auth/login returns 401 when email or password is incorrect
- Missing email or password field returns 400 with a validation error

Example for a frontend task titled "Implement Login Page UI":
## Acceptance Criteria
- Login form renders email and password fields with a submit button
- Submitting with empty fields shows inline validation errors per field
- Successful login redirects user to the dashboard

## Context

<short: why this exists>

## Goal

<one clear outcome>

## Scope

<single layer: client OR server/data OR infra OR refactor>

## Technical Notes

<brief hints only>

## Acceptance Criteria

- <specific, testable outcome derived from this task's title and scope>
- <specific, testable outcome derived from this task's title and scope>

Labels — exactly ONE per task:

- frontend — UI, components, pages, styling, client state
- backend — APIs, server-side logic, persistence, integration with data stores
- infra — setup, configuration, CI/CD
- tech-debt — refactoring or improvements without new product behavior

Never frontend and backend on the same task.`;

const buildInitialUserContent = (userRequest: string): string =>
  `Break the following into GitHub issues as JSON. Cover required layers end-to-end; put foundational server and data work before or with dependent UI; add integration tasks where the client relies on services; keep each issue single-layer, sized for part of a day, and shippable—without pointless splitting.

User request:

${userRequest}`;

const buildRepairUserContent = (tasks: Task[], validationErrorMessage: string): string => {
  const tasksJson = JSON.stringify({ tasks }, null, 2);
  return `The following tasks JSON failed strict validation. Fix the tasks so they pass validation. Do NOT change task meaning or structure unnecessarily—only fix labels (exactly one of frontend, backend, infra, tech-debt per task), scope/front-back separation, title issues, description content, and clarity of acceptance outcomes (plain text, not checklist syntax). Keep all tasks in the same order unless a correction requires otherwise.

You must fix the tasks so they pass strict validation rules. Keep all tasks, but correct what the errors indicate.

Validation errors:
${validationErrorMessage}

Original tasks JSON:
${tasksJson}`;
};

export const generateTasks = async (
  client: OpenAI,
  userRequest: string,
  model: string = DEFAULT_CHAT_MODEL_ID,
): Promise<Task[]> => {
  const initialMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildInitialUserContent(userRequest) },
  ];

  const parsedInitial = await fetchJsonObjectCompletion(client, model, initialMessages);
  const initialPayload = assertTasksShape(parsedInitial);
  const normalizedTasks = initialPayload.tasks.map(normalizeTask);
  const firstRefine = tryRefineTasks(normalizedTasks);
  if (firstRefine.success) {
    return firstRefine.tasks;
  }

  const repairMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT + REPAIR_SYSTEM_SUFFIX },
    {
      role: "user",
      content: buildRepairUserContent(normalizedTasks, firstRefine.validationErrorMessage),
    },
  ];

  const parsedRepair = await fetchJsonObjectCompletion(client, model, repairMessages);
  const repairedPayload = assertTasksShape(parsedRepair);
  const normalizedRepaired = repairedPayload.tasks.map(normalizeTask);
  const secondRefine = tryRefineTasks(normalizedRepaired);
  if (secondRefine.success) {
    return secondRefine.tasks;
  }

  if (normalizedRepaired.some((t) => hasGenericAcceptanceCriteria(t.description))) {
    const acRepaired = await repairAcceptanceCriteria(client, model, normalizedRepaired);
    const acRepairedNormalized = acRepaired.map(normalizeTask);
    const thirdRefine = tryRefineTasks(acRepairedNormalized);
    if (thirdRefine.success) {
      return thirdRefine.tasks;
    }

    const withFallbackAc = acRepairedNormalized.map(injectFallbackAcIfGeneric);
    const fallbackRefine = tryRefineTasks(withFallbackAc);
    if (fallbackRefine.success) {
      return fallbackRefine.tasks;
    }
  }

  throw new Error(
    `Task generation failed validation and repair did not pass. First pass: ${firstRefine.validationErrorMessage} Repair pass: ${secondRefine.validationErrorMessage}`,
  );
};
