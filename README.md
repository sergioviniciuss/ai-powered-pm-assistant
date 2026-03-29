# pm-cli

A small **PM assistant** CLI: you describe work in natural language, OpenAI turns it into structured tasks, and the tool creates **GitHub Issues** (or previews them with `--dry-run`).

## Requirements

- **Node.js 22 or later** (install the [current Active LTS](https://nodejs.org/en/about/releases/) — **Node.js 24** as of early 2026)
- [Yarn](https://yarnpkg.com/) (Classic v1 is fine)
- OpenAI API key
- GitHub personal access token with `repo` scope (only when not using `--dry-run`)

## Setup

1. Clone or copy this project and install dependencies:

   ```bash
   cd pm-cli
   yarn install
   ```

2. Build TypeScript:

   ```bash
   yarn build
   ```

3. Configure your environment interactively:

   ```bash
   yarn pm init
   ```

   This prompts for your OpenAI API key, GitHub token, owner, and repo, then writes a `.env` file in the current directory. If a `.env` already exists, only the values you provide are updated — other entries are preserved.

   You can also pass everything as flags to skip prompts:

   ```bash
   yarn pm init --openai-api-key=sk-... --github-token=ghp_... --owner=acme --repo=app
   ```

   Or provide some flags and answer prompts for the rest (hybrid mode).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Always | OpenAI API key |
| `GITHUB_TOKEN` | Unless `--dry-run` | GitHub PAT with access to the repo |
| `GITHUB_OWNER` | Unless `--dry-run`* | Default owner when `--owner` is not passed |
| `GITHUB_REPO` | Unless `--dry-run`* | Default repo name when `--repo` is not passed |

\*For each of owner and repo, you may pass **`--owner=<name>`** / **`--repo=<name>`** on the command line instead of (or to override) the matching env var. Both values must be resolved before creating issues: if either is missing from flags and env, the CLI exits with a clear error.

With `--dry-run`, only `OPENAI_API_KEY` is required.

## How to run

After `yarn build`, use the `pm` script:

```bash
yarn pm "create onboarding system with auth and dashboard"
```

Use a specific repository (overrides `GITHUB_OWNER` / `GITHUB_REPO` for this run):

```bash
yarn pm --owner=my-org --repo=my-repo "create onboarding"
# or
yarn pm --repo=my-repo --owner=my-org "create onboarding"
```

You can mix flags and env: e.g. set `GITHUB_OWNER` in `.env` and pass only `--repo=other-repo`.

**Model selection** (default: `gpt-4o`):

- `--model=smart` → `gpt-4o`
- `--model=fast` → `gpt-4o-mini`
- `--model=gpt-4o` or `--model=gpt-4o-mini` → use that model ID directly

Preview generated tasks **without** creating issues:

```bash
yarn pm --dry-run "add password reset flow and email templates"
```

With `--dry-run`, if both owner and repo are available (from flags or env), the log includes the target repository for context.

### Global CLI (`pm-assistant` / `pm-cli`)

After building, link the package so the `pm-assistant` binary is on your `PATH`:

```bash
yarn build
yarn link
pm-assistant init
pm-assistant "your feature description here"
pm-assistant --owner=acme --repo=product "your feature description here"
pm-assistant --dry-run "your feature description here"
```

The legacy `pm-cli` binary also works. Alternatively use `npm link` from the project root.

### Development (no build)

`yarn dev` runs the CLI with **tsx** (TypeScript execute) so you do not need `yarn build` first. This matches Node’s ESM rules, including `.js` extensions in imports that resolve to `.ts` sources.

```bash
yarn dev -- --dry-run "describe the work"
```

Pass `--` so Yarn forwards flags and the prompt to the script.

## What it does

1. Reads your request from the CLI.
2. Calls OpenAI (JSON mode) to produce a `tasks` array: `title`, `description` (Markdown: Context, Goal, Scope, Technical Notes, Acceptance Criteria; optional Out of Scope only when useful), and `labels`.
3. Validates structure, then applies quality rules (single primary label, no FE/BE mix in scope, concrete acceptance criteria, sane scope/size).
4. Creates one GitHub issue per task, or logs them when `--dry-run` is set.

### Labels

Each issue gets **exactly one** primary label (never `frontend` and `backend` together):

- `frontend` — UI, components, pages, styling, client state
- `backend` — APIs, server-side logic, persistence, data stores
- `infra` — setup, configuration, CI/CD
- `tech-debt` — refactoring or improvements

Ensure these labels exist in your GitHub repository, or the Issues API may reject unknown labels (depending on repo settings).

## Project layout

- `src/cli.ts` — Entrypoint, subcommand routing (`init` / run), env checks, orchestration
- `src/envFile.ts` — `.env` file read/merge/write helpers for `init`
- `src/generateTasks.ts` — OpenAI prompt and parsing
- `src/generateQuestions.ts` — Clarifying questions via OpenAI
- `src/createIssues.ts` — Octokit issue creation / dry-run logging
- `src/github.ts` — Octokit client factory
- `src/openai.ts` — OpenAI client factory
- `src/types.ts` — Shared types and validation
