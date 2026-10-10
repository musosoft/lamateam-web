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

## Runtime image optimization

SSR images use Astro's `cloudflare-binding` service and the Worker `IMAGES`
binding declared in Wrangler. Map thumbnails retain bounded responsive WebP
variants (up to 640px); the source assets are served through `ASSETS`.
Original map files also remain available at `/assets/map-cache/` for existing
links. The cache script preserves supplied public images and mirrors them into
`src/assets/map-cache/` for Astro imports; page thumbnails still use `/_image`,
not direct originals. Files absent from the current catalog are not pruned.
Do not replace this with `cloudflare` (requires the zone's `/cdn-cgi/image`
service) or `compile` alone (passes originals through on on-demand pages).

After building, start `pnpm exec wrangler dev --config dist/server/wrangler.json
--ip 127.0.0.1 --port 8796`, then run:

```sh
MAP_IMAGE_PREVIEW_URL=http://127.0.0.1:8796 node --test tests/map-image-runtime.test.mjs
```

The test checks real rendered image URLs, HTTP responses, WebP bytes and decoded
widths. Local Images emulation does not prove production account entitlement or
quota: repeat the smoke test against the deployed domain as a release gate.
Cloudflare Images Free includes 5,000 unique transformations per month; exhausted
quota can reject new variants. If the binding cannot be used in production,
pre-generate bounded WebP variants and serve them as static assets rather than
falling back to oversized originals.

References: [Astro image services](https://docs.astro.build/en/guides/integrations-guide/cloudflare/#imageservice),
[Images binding](https://developers.cloudflare.com/images/optimization/binding/),
[Images quotas](https://developers.cloudflare.com/images/pricing/).

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
