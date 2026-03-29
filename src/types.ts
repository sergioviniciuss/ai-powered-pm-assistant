/** Single GitHub issue payload produced from OpenAI and validated before create. */
export type Task = {
  title: string;
  description: string;
  labels: string[];
};

/** OpenAI JSON object mode wrapper (must be an object, not a bare array). */
export type TasksPayload = {
  tasks: Task[];
};

const MAX_TITLE_LENGTH = 256;
const MAX_LABELS = 20;
const MAX_DESCRIPTION_LENGTH = 65536;

export type TaskValidationError = {
  readonly message: string;
  readonly index?: number;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const validateTask = (task: unknown, index: number): TaskValidationError | null => {
  if (task === null || typeof task !== "object") {
    return { message: "Task must be a non-null object", index };
  }
  const record = task as Record<string, unknown>;
  const title = record.title;
  const description = record.description;
  const labels = record.labels;

  if (!isNonEmptyString(title)) {
    return { message: "Task.title must be a non-empty string", index };
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return {
      message: `Task.title must be at most ${MAX_TITLE_LENGTH} characters`,
      index,
    };
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    return { message: "Task.description must be a non-empty string", index };
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return {
      message: `Task.description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
      index,
    };
  }
  if (!isStringArray(labels)) {
    return { message: "Task.labels must be an array of strings", index };
  }
  if (labels.length > MAX_LABELS) {
    return {
      message: `Task.labels must have at most ${MAX_LABELS} entries`,
      index,
    };
  }
  return null;
};

export const assertTasksShape = (data: unknown): TasksPayload => {
  if (data === null || typeof data !== "object") {
    throw new Error("Parsed JSON must be a non-null object");
  }
  const record = data as Record<string, unknown>;
  const tasks = record.tasks;
  if (!Array.isArray(tasks)) {
    throw new Error('JSON must contain a "tasks" array');
  }
  const errors: TaskValidationError[] = [];
  const normalized: Task[] = [];
  tasks.forEach((item, index) => {
    const err = validateTask(item, index);
    if (err !== null) {
      errors.push(err);
      return;
    }
    const t = item as Record<string, unknown>;
    normalized.push({
      title: (t.title as string).trim(),
      description: (t.description as string).trim(),
      labels: (t.labels as string[]).map((l) => l.trim()).filter((l) => l.length > 0),
    });
  });
  if (errors.length > 0) {
    const detail = errors.map((e) => (e.index !== undefined ? `[${e.index}] ${e.message}` : e.message)).join("; ");
    throw new Error(`Invalid tasks: ${detail}`);
  }
  if (normalized.length === 0) {
    throw new Error("tasks array must contain at least one valid task");
  }
  return { tasks: normalized };
};
