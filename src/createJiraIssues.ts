import type { JiraClient } from "./jira.js";
import type { Task } from "./types.js";
import { validateTask } from "./types.js";

export type CreateJiraIssuesOptionsDryRun = {
  dryRun: true;
  tasks: Task[];
  projectKey?: string;
  host?: string;
};

export type CreateJiraIssuesOptionsLive = {
  dryRun: false;
  tasks: Task[];
  jira: JiraClient;
  projectKey: string;
  host: string;
};

export type CreateJiraIssuesOptions =
  | CreateJiraIssuesOptionsDryRun
  | CreateJiraIssuesOptionsLive;

const logTaskPreview = (task: Task, index: number): void => {
  console.log(`\n--- Task ${index + 1}: ${task.title} ---`);
  console.log(`Labels: ${task.labels.length ? task.labels.join(", ") : "(none)"}`);
  console.log("Description:\n" + task.description);
};

export const createJiraIssues = async (
  options: CreateJiraIssuesOptions,
): Promise<void> => {
  const { tasks } = options;

  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i];
    const validationError = validateTask(task as unknown, i);
    if (validationError !== null) {
      throw new Error(
        validationError.index !== undefined
          ? `[${validationError.index}] ${validationError.message}`
          : validationError.message,
      );
    }

    if (options.dryRun) {
      if (i === 0 && options.projectKey !== undefined && options.host !== undefined) {
        console.log(`[dry-run] Target: ${options.host} / ${options.projectKey}`);
      }
      console.log(`[dry-run] Would create Jira issue: ${task.title}`);
      logTaskPreview(task, i);
      continue;
    }

    const { jira, projectKey, host } = options;
    const created = await jira.createIssue(
      projectKey,
      task.title,
      task.description,
      task.labels,
    );

    const url = `https://${host.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/browse/${created.key}`;
    console.log(`Created ${created.key}: ${task.title}`);
    console.log(`  ${url}`);
  }
};
