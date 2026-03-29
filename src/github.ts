import { Octokit } from "octokit";

export const createOctokit = (token: string): Octokit =>
  new Octokit({ auth: token });
