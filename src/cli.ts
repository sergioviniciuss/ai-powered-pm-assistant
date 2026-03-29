#!/usr/bin/env node
import "dotenv/config";

import { createIssues } from "./createIssues.js";
import { createOctokit } from "./github.js";
import { generateTasks } from "./generateTasks.js";
import { createOpenAIClient } from "./openai.js";

type ParsedCli = {
  prompt: string;
  dryRun: boolean;
  ownerFlag: string | undefined;
  repoFlag: string | undefined;
};

const parseCliArgs = (argv: string[]): ParsedCli => {
  const tokens = argv.slice(2);
  let dryRun = false;
  let ownerFlag: string | undefined;
  let repoFlag: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === undefined) {
      break;
    }

    if (t === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (t.startsWith("--owner=")) {
      const v = t.slice("--owner=".length).trim();
      ownerFlag = v.length > 0 ? v : undefined;
      continue;
    }

    if (t.startsWith("--repo=")) {
      const v = t.slice("--repo=".length).trim();
      repoFlag = v.length > 0 ? v : undefined;
      continue;
    }

    if (t === "--owner") {
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        const v = next.trim();
        ownerFlag = v.length > 0 ? v : undefined;
        i += 1;
      }
      continue;
    }

    if (t === "--repo") {
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        const v = next.trim();
        repoFlag = v.length > 0 ? v : undefined;
        i += 1;
      }
      continue;
    }

    positional.push(t);
  }

  const prompt = positional.join(" ").trim();
  return { prompt, dryRun, ownerFlag, repoFlag };
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
};

const envTrim = (name: string): string | undefined => {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  const t = value.trim();
  return t.length > 0 ? t : undefined;
};

type ResolvedGithubTarget = {
  owner: string;
  repo: string;
};

const resolveGithubTarget = (
  ownerFlag: string | undefined,
  repoFlag: string | undefined,
): ResolvedGithubTarget => {
  const owner = ownerFlag ?? envTrim("GITHUB_OWNER") ?? "";
  const repo = repoFlag ?? envTrim("GITHUB_REPO") ?? "";
  const missing: string[] = [];
  if (owner === "") {
    missing.push("owner");
  }
  if (repo === "") {
    missing.push("repo");
  }
  if (missing.length > 0) {
    throw new Error(
      `GitHub ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} required: pass --owner and --repo, or set GITHUB_OWNER and GITHUB_REPO in the environment.`,
    );
  }
  return { owner, repo };
};

const logError = (message: string): void => {
  console.error(message);
};

const main = async (): Promise<void> => {
  const { prompt, dryRun, ownerFlag, repoFlag } = parseCliArgs(process.argv);

  if (prompt.length === 0) {
    logError('Usage: pm-cli [--dry-run] [--owner=<name>] [--repo=<name>] "<natural language request>"');
    logError('Example: yarn pm "create onboarding system with auth and dashboard"');
    logError('Example: yarn pm --repo=my-repo --owner=my-org "create onboarding"');
    process.exitCode = 1;
    return;
  }

  let openaiApiKey: string;
  try {
    openaiApiKey = requireEnv("OPENAI_API_KEY");
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
    return;
  }

  if (!dryRun) {
    try {
      requireEnv("GITHUB_TOKEN");
      resolveGithubTarget(ownerFlag, repoFlag);
    } catch (e) {
      logError(e instanceof Error ? e.message : String(e));
      logError("Tip: use --dry-run to preview tasks without creating GitHub issues.");
      process.exitCode = 1;
      return;
    }
  }

  const openai = createOpenAIClient(openaiApiKey);

  console.log("Step 1/3: Reading request from CLI — done.");
  console.log("Step 2/3: Generating tasks with OpenAI...");

  let tasks;
  try {
    tasks = await generateTasks(openai, prompt);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError(`Failed to generate tasks: ${msg}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Step 2/3: Generated ${tasks.length} task(s).`);

  try {
    if (dryRun) {
      console.log("Step 3/3: Dry run — logging tasks (no GitHub API calls).");
      const ownerPreview = ownerFlag ?? envTrim("GITHUB_OWNER");
      const repoPreview = repoFlag ?? envTrim("GITHUB_REPO");
      const previewTarget =
        ownerPreview !== undefined && repoPreview !== undefined
          ? { owner: ownerPreview, repo: repoPreview }
          : {};
      await createIssues({ dryRun: true, tasks, ...previewTarget });
    } else {
      console.log("Step 3/3: Creating GitHub issues...");
      const token = requireEnv("GITHUB_TOKEN");
      const { owner, repo } = resolveGithubTarget(ownerFlag, repoFlag);
      const octokit = createOctokit(token);
      await createIssues({ dryRun: false, tasks, octokit, owner, repo });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError(`Error: ${msg}`);
    process.exitCode = 1;
    return;
  }

  console.log("\nDone.");
};

main().catch((e) => {
  logError(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
