#!/usr/bin/env node
import "dotenv/config";

import readline from "node:readline/promises";
import { createIssues } from "./createIssues.js";
import { createJiraIssues } from "./createJiraIssues.js";
import {
  readEnvFile,
  parseEnvValues,
  mergeEnvContent,
  writeEnvFile,
  getEnvFilePath,
} from "./envFile.js";
import type { EnvKeys } from "./envFile.js";
import { createOctokit } from "./github.js";
import { createJiraClient } from "./jira.js";
import { createLlmJsonClient } from "./llm/index.js";
import type { LlmProvider } from "./llm/index.js";
import { generateClarifyingQuestions } from "./generateQuestions.js";
import { generateTasks, resolveMainModel, resolveClarificationModel } from "./generateTasks.js";

type Target = "github" | "jira";

type ParsedRunCommand = {
  command: "run";
  prompt: string;
  dryRun: boolean;
  interactive: boolean;
  noInteractive: boolean;
  targetFlag: Target | undefined;
  llmProviderFlag: LlmProvider | undefined;
  ownerFlag: string | undefined;
  repoFlag: string | undefined;
  modelFlag: string | undefined;
};

type ParsedInitCommand = {
  command: "init";
  targetFlag: Target | undefined;
  llmProviderFlag: LlmProvider | undefined;
  openaiApiKey: string | undefined;
  anthropicApiKey: string | undefined;
  githubToken: string | undefined;
  ownerFlag: string | undefined;
  repoFlag: string | undefined;
  jiraHost: string | undefined;
  jiraEmail: string | undefined;
  jiraApiToken: string | undefined;
  jiraProjectKey: string | undefined;
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

const parseTargetValue = (raw: string | undefined): Target | undefined => {
  if (raw === undefined) return undefined;
  const v = raw.toLowerCase();
  if (v === "github" || v === "jira") return v;
  throw new Error(`Invalid --target value "${raw}". Use: github or jira.`);
};

const parseLlmProviderValue = (raw: string | undefined): LlmProvider | undefined => {
  if (raw === undefined) return undefined;
  const v = raw.toLowerCase();
  if (v === "openai" || v === "anthropic") return v;
  throw new Error(`Invalid --llm-provider value "${raw}". Use: openai or anthropic.`);
};

const parseInitArgs = (tokens: string[]): ParsedInitCommand => {
  let targetFlag: string | undefined;
  let llmProviderFlag: string | undefined;
  let openaiApiKey: string | undefined;
  let anthropicApiKey: string | undefined;
  let githubToken: string | undefined;
  let ownerFlag: string | undefined;
  let repoFlag: string | undefined;
  let jiraHost: string | undefined;
  let jiraEmail: string | undefined;
  let jiraApiToken: string | undefined;
  let jiraProjectKey: string | undefined;

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === undefined) {
      break;
    }

    for (const [prefix, setter] of [
      ["--target", (v: string | undefined) => { targetFlag = v; }],
      ["--llm-provider", (v: string | undefined) => { llmProviderFlag = v; }],
      ["--openai-api-key", (v: string | undefined) => { openaiApiKey = v; }],
      ["--anthropic-api-key", (v: string | undefined) => { anthropicApiKey = v; }],
      ["--github-token", (v: string | undefined) => { githubToken = v; }],
      ["--github-owner", (v: string | undefined) => { ownerFlag = v; }],
      ["--owner", (v: string | undefined) => { ownerFlag = v; }],
      ["--github-repo", (v: string | undefined) => { repoFlag = v; }],
      ["--repo", (v: string | undefined) => { repoFlag = v; }],
      ["--jira-host", (v: string | undefined) => { jiraHost = v; }],
      ["--jira-email", (v: string | undefined) => { jiraEmail = v; }],
      ["--jira-api-token", (v: string | undefined) => { jiraApiToken = v; }],
      ["--jira-project-key", (v: string | undefined) => { jiraProjectKey = v; }],
    ] as const) {
      const { value, skip } = parseFlag(tokens, i, prefix as string);
      if (skip >= 0) {
        (setter as (v: string | undefined) => void)(value);
        i += skip;
        break;
      }
    }
  }

  return {
    command: "init",
    targetFlag: parseTargetValue(targetFlag),
    llmProviderFlag: parseLlmProviderValue(llmProviderFlag),
    openaiApiKey,
    anthropicApiKey,
    githubToken,
    ownerFlag,
    repoFlag,
    jiraHost,
    jiraEmail,
    jiraApiToken,
    jiraProjectKey,
  };
};

const parseCliArgs = (argv: string[]): ParsedCli => {
  const tokens = argv.slice(2);

  if (tokens[0] === "init") {
    return parseInitArgs(tokens.slice(1));
  }

  let dryRun = false;
  let interactive = false;
  let noInteractive = false;
  let rawTarget: string | undefined;
  let rawLlmProvider: string | undefined;
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

    let matched = false;
    for (const [prefix, setter] of [
      ["--target", (v: string | undefined) => { rawTarget = v; }],
      ["--llm-provider", (v: string | undefined) => { rawLlmProvider = v; }],
      ["--owner", (v: string | undefined) => { ownerFlag = v; }],
      ["--repo", (v: string | undefined) => { repoFlag = v; }],
      ["--model", (v: string | undefined) => { modelFlag = v; }],
    ] as const) {
      const { value, skip } = parseFlag(tokens, i, prefix as string);
      if (skip >= 0) {
        (setter as (v: string | undefined) => void)(value);
        i += skip;
        matched = true;
        break;
      }
    }
    if (!matched) {
      positional.push(t);
    }
  }

  const prompt = positional.join(" ").trim();
  return {
    command: "run",
    prompt,
    dryRun,
    interactive,
    noInteractive,
    targetFlag: parseTargetValue(rawTarget),
    llmProviderFlag: parseLlmProviderValue(rawLlmProvider),
    ownerFlag,
    repoFlag,
    modelFlag,
  };
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

type InitPrompt = { key: keyof EnvKeys; label: string };

const OPENAI_PROMPTS: InitPrompt[] = [
  { key: "OPENAI_API_KEY", label: "OpenAI API key" },
];

const ANTHROPIC_PROMPTS: InitPrompt[] = [
  { key: "ANTHROPIC_API_KEY", label: "Anthropic (Claude) API key" },
];

const GITHUB_PROMPTS: InitPrompt[] = [
  { key: "GITHUB_TOKEN", label: "GitHub personal access token" },
  { key: "GITHUB_OWNER", label: "GitHub owner (org or username)" },
  { key: "GITHUB_REPO", label: "GitHub repository name" },
];

const JIRA_PROMPTS: InitPrompt[] = [
  { key: "JIRA_HOST", label: "Jira Cloud host (e.g. your-domain.atlassian.net)" },
  { key: "JIRA_EMAIL", label: "Jira account email" },
  { key: "JIRA_API_TOKEN", label: "Jira API token" },
  { key: "JIRA_PROJECT_KEY", label: "Jira project key (e.g. PROJ)" },
];

const getInitPrompts = (target: Target, llmProvider: LlmProvider): InitPrompt[] => [
  ...(llmProvider === "anthropic" ? ANTHROPIC_PROMPTS : OPENAI_PROMPTS),
  ...(target === "jira" ? JIRA_PROMPTS : GITHUB_PROMPTS),
];

const runInit = async (parsed: ParsedInitCommand): Promise<void> => {
  const existingContent = await readEnvFile();
  const existingValues = parseEnvValues(existingContent);

  const flagValues: Partial<EnvKeys> = {};
  if (parsed.openaiApiKey !== undefined) flagValues.OPENAI_API_KEY = parsed.openaiApiKey;
  if (parsed.anthropicApiKey !== undefined) flagValues.ANTHROPIC_API_KEY = parsed.anthropicApiKey;
  if (parsed.githubToken !== undefined) flagValues.GITHUB_TOKEN = parsed.githubToken;
  if (parsed.ownerFlag !== undefined) flagValues.GITHUB_OWNER = parsed.ownerFlag;
  if (parsed.repoFlag !== undefined) flagValues.GITHUB_REPO = parsed.repoFlag;
  if (parsed.jiraHost !== undefined) flagValues.JIRA_HOST = parsed.jiraHost;
  if (parsed.jiraEmail !== undefined) flagValues.JIRA_EMAIL = parsed.jiraEmail;
  if (parsed.jiraApiToken !== undefined) flagValues.JIRA_API_TOKEN = parsed.jiraApiToken;
  if (parsed.jiraProjectKey !== undefined) flagValues.JIRA_PROJECT_KEY = parsed.jiraProjectKey;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("pm-assistant init — configure your environment.\n");

  let target: Target | undefined = parsed.targetFlag;
  if (target === undefined) {
    const currentTarget = existingValues.TARGET;
    const defaultHint = currentTarget ? ` (current: ${currentTarget})` : " (default: github)";
    const answer = await rl.question(`Issue tracker [github / jira]${defaultHint}: `);
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === "jira") {
      target = "jira";
    } else if (trimmed === "github" || trimmed === "") {
      target = (currentTarget as Target) ?? "github";
    } else {
      rl.close();
      logError(`Invalid target "${answer.trim()}". Use: github or jira.`);
      process.exitCode = 1;
      return;
    }
  }

  let llmProvider: LlmProvider | undefined = parsed.llmProviderFlag;
  if (llmProvider === undefined) {
    const currentProvider = existingValues.LLM_PROVIDER;
    const defaultHint = currentProvider ? ` (current: ${currentProvider})` : " (default: openai)";
    const answer = await rl.question(`LLM provider [openai / anthropic]${defaultHint}: `);
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === "anthropic") {
      llmProvider = "anthropic";
    } else if (trimmed === "openai" || trimmed === "") {
      llmProvider = (currentProvider as LlmProvider) ?? "openai";
    } else {
      rl.close();
      logError(`Invalid LLM provider "${answer.trim()}". Use: openai or anthropic.`);
      process.exitCode = 1;
      return;
    }
  }

  flagValues.TARGET = target;
  flagValues.LLM_PROVIDER = llmProvider;

  const prompts = getInitPrompts(target, llmProvider);
  const allProvidedByFlags = prompts.every(({ key }) => key in flagValues);
  const updates: Partial<EnvKeys> = { ...flagValues };

  if (!allProvidedByFlags) {
    for (const { key, label } of prompts) {
      if (key in flagValues) continue;
      const current = existingValues[key];
      const hint = current ? ` (current: ${mask(current)})` : "";
      const answer = await rl.question(`${label}${hint}: `);
      const trimmed = answer.trim();
      if (trimmed.length > 0) {
        updates[key] = trimmed;
      }
    }
  }

  rl.close();

  if (Object.keys(updates).length === 0) {
    console.log("No changes — .env is unchanged.");
    return;
  }

  const merged = mergeEnvContent(existingContent, updates);
  await writeEnvFile(merged);
  console.log(`\nConfiguration saved to ${getEnvFilePath()}`);

  const finalValues = { ...existingValues, ...updates };
  const missing = prompts.filter(({ key }) => !finalValues[key]).map(({ label }) => label);
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

const resolveTarget = (flag: Target | undefined): Target => {
  if (flag !== undefined) return flag;
  const env = envTrim("TARGET")?.toLowerCase();
  if (env === "jira") return "jira";
  return "github";
};

type ResolvedJiraTarget = {
  host: string;
  email: string;
  apiToken: string;
  projectKey: string;
};

const resolveJiraTarget = (): ResolvedJiraTarget => {
  const host = envTrim("JIRA_HOST") ?? "";
  const email = envTrim("JIRA_EMAIL") ?? "";
  const apiToken = envTrim("JIRA_API_TOKEN") ?? "";
  const projectKey = envTrim("JIRA_PROJECT_KEY") ?? "";
  const missing: string[] = [];
  if (host === "") missing.push("JIRA_HOST");
  if (email === "") missing.push("JIRA_EMAIL");
  if (apiToken === "") missing.push("JIRA_API_TOKEN");
  if (projectKey === "") missing.push("JIRA_PROJECT_KEY");
  if (missing.length > 0) {
    throw new Error(
      `Missing Jira configuration: ${missing.join(", ")}. Run "pm-assistant init --target=jira" to set them up.`,
    );
  }
  return { host, email, apiToken, projectKey };
};

const resolveLlmProvider = (flag: LlmProvider | undefined): LlmProvider => {
  if (flag !== undefined) return flag;
  const env = envTrim("LLM_PROVIDER")?.toLowerCase();
  if (env === "anthropic") return "anthropic";
  return "openai";
};

const resolveLlmApiKey = (provider: LlmProvider): string => {
  const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  return requireEnv(keyName);
};

const runMain = async (parsed: ParsedRunCommand): Promise<void> => {
  const { prompt, dryRun, interactive, noInteractive, targetFlag, llmProviderFlag, ownerFlag, repoFlag, modelFlag } = parsed;

  if (prompt.length === 0) {
    logError(
      'Usage: pm-assistant [--dry-run] [--target=github|jira] [--llm-provider=openai|anthropic] [--model=fast|smart] "<request>"',
    );
    logError("       pm-assistant init [--target=...] [--llm-provider=...] [--openai-api-key=...] [--anthropic-api-key=...]");
    logError("");
    logError('Example: pm-assistant "create onboarding system with auth and dashboard"');
    logError('Example: pm-assistant --llm-provider=anthropic "create onboarding system"');
    logError("Example: pm-assistant init");
    process.exitCode = 1;
    return;
  }

  const target = resolveTarget(targetFlag);
  const llmProvider = resolveLlmProvider(llmProviderFlag);

  let llmApiKey: string;
  try {
    llmApiKey = resolveLlmApiKey(llmProvider);
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    logError('Tip: run "pm-assistant init" to configure your environment.');
    process.exitCode = 1;
    return;
  }

  if (!dryRun) {
    try {
      if (target === "jira") {
        resolveJiraTarget();
      } else {
        requireEnv("GITHUB_TOKEN");
        resolveGithubTarget(ownerFlag, repoFlag);
      }
    } catch (e) {
      logError(e instanceof Error ? e.message : String(e));
      logError(`Tip: use --dry-run to preview tasks without creating ${target === "jira" ? "Jira" : "GitHub"} issues.`);
      process.exitCode = 1;
      return;
    }
  }

  const llmClient = createLlmJsonClient(llmProvider, llmApiKey);

  let chatModelId: string;
  try {
    chatModelId = resolveMainModel(llmProvider, modelFlag);
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
    return;
  }

  const clarificationModelId = resolveClarificationModel(llmProvider);

  console.log(`Step 1/3: Reading request from CLI — done. (target: ${target}, llm: ${llmProvider})`);

  let enrichedPrompt = prompt;

  const autoInteractive = shouldAskClarifyingQuestions(prompt);
  const shouldAsk = interactive || (!noInteractive && autoInteractive);

  if (shouldAsk) {
    console.log("Step 1.5/3: Clarifying your request...");

    try {
      const questions = await generateClarifyingQuestions(llmClient, clarificationModelId, prompt);

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

  console.log("Step 2/3: Generating tasks...");

  let tasks;
  try {
    tasks = await generateTasks(llmClient, enrichedPrompt, chatModelId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError(`Failed to generate tasks: ${msg}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Step 2/3: Generated ${tasks.length} task(s).`);

  try {
    if (target === "jira") {
      if (dryRun) {
        console.log("Step 3/3: Dry run — logging tasks (no Jira API calls).");
        const hostPreview = envTrim("JIRA_HOST");
        const projectPreview = envTrim("JIRA_PROJECT_KEY");
        await createJiraIssues({
          dryRun: true,
          tasks,
          ...(hostPreview !== undefined && projectPreview !== undefined
            ? { host: hostPreview, projectKey: projectPreview }
            : {}),
        });
      } else {
        console.log("Step 3/3: Creating Jira issues...");
        const { host, email, apiToken, projectKey } = resolveJiraTarget();
        const jira = createJiraClient(host, email, apiToken);
        await createJiraIssues({ dryRun: false, tasks, jira, projectKey, host });
      }
    } else {
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
