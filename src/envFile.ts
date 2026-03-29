import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ENV_PATH = join(process.cwd(), ".env");

const MANAGED_KEYS = [
  "OPENAI_API_KEY",
  "GITHUB_TOKEN",
  "GITHUB_OWNER",
  "GITHUB_REPO",
] as const;

export type EnvKeys = Record<(typeof MANAGED_KEYS)[number], string>;

export const readEnvFile = async (): Promise<string> => {
  try {
    return await readFile(ENV_PATH, "utf-8");
  } catch {
    return "";
  }
};

export const parseEnvValues = (content: string): Partial<EnvKeys> => {
  const result: Partial<EnvKeys> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.*?)\s*$/);
    if (match === null) {
      continue;
    }
    const key = match[1] as string;
    const value = match[2] as string;
    if ((MANAGED_KEYS as readonly string[]).includes(key)) {
      result[key as keyof EnvKeys] = value;
    }
  }
  return result;
};

export const mergeEnvContent = (
  existingContent: string,
  updates: Partial<EnvKeys>,
): string => {
  const lines = existingContent.length > 0 ? existingContent.split(/\r?\n/) : [];
  const updatedKeys = new Set<string>();

  const merged = lines.map((line) => {
    const match = line.match(/^\s*([\w]+)\s*=/);
    if (match === null) {
      return line;
    }
    const key = match[1] as string;
    if (key in updates) {
      updatedKeys.add(key);
      return `${key}=${updates[key as keyof EnvKeys] ?? ""}`;
    }
    return line;
  });

  for (const key of MANAGED_KEYS) {
    if (key in updates && !updatedKeys.has(key)) {
      merged.push(`${key}=${updates[key] ?? ""}`);
    }
  }

  let result = merged.join("\n");
  if (!result.endsWith("\n")) {
    result += "\n";
  }
  return result;
};

export const writeEnvFile = async (content: string): Promise<void> => {
  await writeFile(ENV_PATH, content, "utf-8");
};

export const getEnvFilePath = (): string => ENV_PATH;
