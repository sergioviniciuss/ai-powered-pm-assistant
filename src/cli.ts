#!/usr/bin/env node
import "dotenv/config";

import readline from "node:readline/promises";
import { createIssues } from "./createIssues.js";
import {
  readEnvFile,
  parseEnvValues,
  mergeEnvContent,
  writeEnvFile,
  getEnvFilePath,
} from "./envFile.js";
import type { EnvKeys } from "./envFile.js";
import { createOctokit } from "./github.js";
import { generateClarifyingQuestions } from "./generateQuestions.js";
import { generateTasks, resolveChatModelId } from "./generateTasks.js";
import { createOpenAIClient } from "./openai.js";

type ParsedRunCommand = {
  command: "run";
  prompt: string;
  dryRun: boolean;
  interactive: boolean;
  noInteractive: boolean;
  ownerFlag: string | undefined;
  repoFlag: string | undefined;
  modelFlag: string | undefined;
};

type ParsedInitCommand = {
  command: "init";
  openaiApiKey: string | undefined;
  githubToken: string | undefined;
  ownerFlag: string | undefined;
  repoFlag: string | undefined;
};

type ParsedCli = ParsedRunCommand | ParsedInitCommand;

const parseFlag = (
  tokens: string[],
  i: number,
  prefix: string,
): { value: string | undefined; skip: number } => {
  const t = tokens[i]!;
  if (t.startsWith(`${prefix}=`)) {
    const v = t.slice(prefix.length + 1).trim();
    return { value: v.length > 0 ? v : undefined, skip: 0 };
  }
  if (t === prefix) {
    const next = tokens[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      const v = next.trim();
      return { value: v.length > 0 ? v : undefined, skip: 1 };
    }
    return { value: undefined, skip: 0 };
  }
  return { value: undefined, skip: -1 };
};

const parseInitArgs = (tokens: string[]): ParsedInitCommand => {
  let openaiApiKey: string | undefined;
  let githubToken: string | undefined;
  let ownerFlag: string | undefined;
  let repoFlag: string | undefined;

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === undefined) {
      break;
    }

    for (const [prefix, setter] of [
      ["--openai-api-key", (v: string | undefined) => { openaiApiKey = v; }],
      ["--github-token", (v: string | undefined) => { githubToken = v; }],
      ["--github-owner", (v: string | undefined) => { ownerFlag = v; }],
      ["--owner", (v: string | undefined) => { ownerFlag = v; }],
      ["--github-repo", (v: string | undefined) => { repoFlag = v; }],
      ["--repo", (v: string | undefined) => { repoFlag = v; }],
    ] as const) {
      const { value, skip } = parseFlag(tokens, i, prefix as string);
      if (skip >= 0) {
        (setter as (v: string | undefined) => void)(value);
        i += skip;
        break;
      }
    }
  }

  return { command: "init", openaiApiKey, githubToken, ownerFlag, repoFlag };
};

const parseCliArgs = (argv: string[]): ParsedCli => {
  const tokens = argv.slice(2);

  if (tokens[0] === "init") {
    return parseInitArgs(tokens.slice(1));
  }

  let dryRun = false;
  let interactive = false;
  let noInteractive = false;
  let ownerFlag: string | undefined;
  let repoFlag: string | undefined;
  let modelFlag: string | undefined;
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

    if (t === "--interactive") {
      interactive = true;
      continue;
    }

    if (t === "--no-interactive") {
      noInteractive = true;
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

    if (t.startsWith("--model=")) {
      const v = t.slice("--model=".length).trim();
      modelFlag = v.length > 0 ? v : undefined;
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

    if (t === "--model") {
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        const v = next.trim();
        modelFlag = v.length > 0 ? v : undefined;
        i += 1;
      }
      continue;
    }

    positional.push(t);
  }

  const prompt = positional.join(" ").trim();
  return { command: "run", prompt, dryRun, interactive, noInteractive, ownerFlag, repoFlag, modelFlag };
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

const shouldAskClarifyingQuestions = (input: string): boolean => {
  const lower = input.toLowerCase();

  const hasStructure =
    lower.includes("context:") ||
    lower.includes("requirements:") ||
    lower.includes("user flow:") ||
    lower.includes("constraints:");

  const isShort = input.trim().length < 120;

  return isShort || !hasStructure;
};

const INIT_PROMPTS: { key: keyof EnvKeys; label: string }[] = [
  { key: "OPENAI_API_KEY", label: "OpenAI API key" },
  { key: "GITHUB_TOKEN", label: "GitHub personal access token" },
  { key: "GITHUB_OWNER", label: "GitHub owner (org or username)" },
  { key: "GITHUB_REPO", label: "GitHub repository name" },
];

const runInit = async (parsed: ParsedInitCommand): Promise<void> => {
  const flagValues: Partial<EnvKeys> = {};
  if (parsed.openaiApiKey !== undefined) {
    flagValues.OPENAI_API_KEY = parsed.openaiApiKey;
  }
  if (parsed.githubToken !== undefined) {
    flagValues.GITHUB_TOKEN = parsed.githubToken;
  }
  if (parsed.ownerFlag !== undefined) {
    flagValues.GITHUB_OWNER = parsed.ownerFlag;
  }
  if (parsed.repoFlag !== undefined) {
    flagValues.GITHUB_REPO = parsed.repoFlag;
  }

  const existingContent = await readEnvFile();
  const existingValues = parseEnvValues(existingContent);

  const allProvidedByFlags = INIT_PROMPTS.every(({ key }) => key in flagValues);

  const updates: Partial<EnvKeys> = { ...flagValues };

  if (!allProvidedByFlags) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log("pm-assistant init — configure your environment.\n");

    for (const { key, label } of INIT_PROMPTS) {
      if (key in flagValues) {
        continue;
      }

      const current = existingValues[key];
      const hint = current ? ` (current: ${mask(current)})` : "";
      const answer = await rl.question(`${label}${hint}: `);
      const trimmed = answer.trim();
      if (trimmed.length > 0) {
        updates[key] = trimmed;
      }
    }

    rl.close();
  }

  if (Object.keys(updates).length === 0) {
    console.log("No changes — .env is unchanged.");
    return;
  }

  const merged = mergeEnvContent(existingContent, updates);
  await writeEnvFile(merged);
  console.log(`\nConfiguration saved to ${getEnvFilePath()}`);

  const finalValues = { ...existingValues, ...updates };
  const missing = INIT_PROMPTS.filter(({ key }) => !finalValues[key]).map(({ label }) => label);
  if (missing.length > 0) {
    console.warn(`\nWarning: the following are still missing and must be set before running: ${missing.join(", ")}`);
  }
};

const mask = (value: string): string => {
  if (value.length <= 8) {
    return "****";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
};

const runMain = async (parsed: ParsedRunCommand): Promise<void> => {
  const { prompt, dryRun, interactive, noInteractive, ownerFlag, repoFlag, modelFlag } = parsed;

  if (prompt.length === 0) {
    logError(
      'Usage: pm-assistant [--dry-run] [--model=fast|smart] [--owner=<name>] [--repo=<name>] "<request>"',
    );
    logError("       pm-assistant init [--openai-api-key=...] [--github-token=...] [--owner=...] [--repo=...]");
    logError("");
    logError('Example: pm-assistant "create onboarding system with auth and dashboard"');
    logError("Example: pm-assistant init");
    process.exitCode = 1;
    return;
  }

  let openaiApiKey: string;
  try {
    openaiApiKey = requireEnv("OPENAI_API_KEY");
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    logError('Tip: run "pm-assistant init" to configure your environment.');
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

  let chatModelId: string;
  try {
    chatModelId = resolveChatModelId(modelFlag);
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
    return;
  }

  console.log("Step 1/3: Reading request from CLI — done.");

  let enrichedPrompt = prompt;

  const autoInteractive = shouldAskClarifyingQuestions(prompt);
  const shouldAsk = interactive || (!noInteractive && autoInteractive);

  if (shouldAsk) {
    console.log("Step 1.5/3: Clarifying your request...");

    try {
      const questions = await generateClarifyingQuestions(openai, prompt);

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      let answersBlock = "";

      for (const question of questions) {
        const answer = await rl.question(`${question}\n> `);
        if (answer.trim().length > 0) {
          answersBlock += `- ${question} ${answer}\n`;
        }
      }

      rl.close();

      if (answersBlock.length > 0) {
        enrichedPrompt = `${prompt}\n\nClarifications:\n${answersBlock}`;
      }

      console.log("Step 1.5/3: Clarifications collected.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(`Failed to generate clarification questions: ${msg}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log("Step 2/3: Generating tasks with OpenAI...");

  let tasks;
  try {
    tasks = await generateTasks(openai, enrichedPrompt, chatModelId);
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

const main = async (): Promise<void> => {
  const parsed = parseCliArgs(process.argv);

  if (parsed.command === "init") {
    await runInit(parsed);
    return;
  }

  await runMain(parsed);
};

main().catch((e) => {
  logError(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
