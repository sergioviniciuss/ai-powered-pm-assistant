import type { Octokit } from "octokit";
import type { Task } from "./types.js";
import { validateTask } from "./types.js";

export type CreateIssuesOptionsDryRun = {
  dryRun: true;
  tasks: Task[];
  /** When both set, logged once so dry-run output shows the intended repository. */
  owner?: string;
  repo?: string;
};

export type CreateIssuesOptionsLive = {
  dryRun: false;
  tasks: Task[];
  octokit: Octokit;
  owner: string;
  repo: string;
};

export type CreateIssuesOptions = CreateIssuesOptionsDryRun | CreateIssuesOptionsLive;

const logTaskPreview = (task: Task, index: number): void => {
  console.log(`\n--- Task ${index + 1}: ${task.title} ---`);
  console.log(`Labels: ${task.labels.length ? task.labels.join(", ") : "(none)"}`);
  console.log("Description:\n" + task.description);
};

export const createIssues = async (options: CreateIssuesOptions): Promise<void> => {
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
      if (i === 0 && options.owner !== undefined && options.repo !== undefined) {
        console.log(`[dry-run] Target repository: ${options.owner}/${options.repo}`);
      }
      console.log(`[dry-run] Would create issue: ${task.title}`);
      logTaskPreview(task, i);
      continue;
    }

    const { octokit, owner, repo } = options;
    const response = await octokit.rest.issues.create({
      owner,
      repo,
      title: task.title,
      body: task.description,
      labels: task.labels,
    });

    const issue = response.data;
    const url = issue.html_url ?? "(no URL)";
    console.log(`Created issue #${issue.number}: ${issue.title}`);
    console.log(`  ${url}`);
  }
};
