# lamateam.eu Web

Astro site deployed to Cloudflare Workers.

## Quickstart

```sh
pnpm install
pnpm run dev
```

Key commands:

- `pnpm run build`: production build
- `pnpm run typecheck`: TypeScript check
- `pnpm run check`: astro check + build + typecheck + wrangler dry-run deploy
- `pnpm run deploy`: build + typecheck + `wrangler deploy`

## Agent Guide

This section is for agentic LLM/code agents working in this repo.

1. Use `pnpm` only. The source of truth is `package.json#packageManager`.
2. Before proposing merge-ready changes, run:
   - `pnpm audit --prod --audit-level=moderate`
   - `pnpm astro check`
   - `pnpm build`
   - `pnpm typecheck`
3. Do not pin a pnpm version in GitHub workflows. `pnpm/action-setup` must read from `packageManager` to avoid `ERR_PNPM_BAD_PM_VERSION`.
4. `pnpm run build` does not require Cloudflare auth. Deploy (`wrangler deploy`) requires GitHub secrets.
5. Runtime Worker secrets are managed in Cloudflare, not in GitHub.

## CI/CD and Dependency Automation

Configured automation:

- `.github/dependabot.yml`
  - Daily dependency updates for npm/pnpm ecosystem and GitHub Actions.
  - Astro and Tailwind packages are intentionally ignored here to avoid conflicting upgrade strategies.
- `.github/workflows/dependabot-automerge.yml`
  - Attempts to enable auto-merge for Dependabot PRs without failing if repo auto-merge settings are unavailable.
- `.github/workflows/ci-deploy.yml`
  - PR verification: audit + astro check + build + typecheck.
  - Main deploy: `pnpm run deploy` to Cloudflare Workers.
- `.github/workflows/security-sweep.yml`
  - Daily lockfile refresh + `pnpm audit --fix` + validation + automated PR.
- `.github/workflows/astro-upgrade.yml`
  - Weekly framework migration flow with non-interactive:
    - `pnpm dlx @astrojs/upgrade beta`
    - `pnpm dlx @tailwindcss/upgrade --force`
  - Creates a PR only after audit/check/build/typecheck pass.

## Astro Upgrade Policy

Astro beta and official integrations are upgraded together by automation using:

```sh
yes | pnpm dlx @astrojs/upgrade beta
yes | pnpm dlx @tailwindcss/upgrade --force
```

`yes |` is required so the workflow never waits for interactive confirmation.

## Required Secrets

GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `AUTOMATION_GITHUB_TOKEN` (recommended for bot PRs that should trigger normal PR workflows)

Cloudflare Worker runtime secrets:

- `STEAM_API_KEY`
- `TURSO_AUTH_TOKEN`

## Recommended GitHub Settings

- Enable `Allow auto-merge`.
- Protect `main` and require `CI and Deploy / Verify`.
- Enable Dependabot security updates.
