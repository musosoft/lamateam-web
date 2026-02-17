# Astro Starter Kit: Basics

```sh
npm create astro@latest -- --template basics
```

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/withastro/astro/tree/latest/examples/basics)
[![Open with CodeSandbox](https://assets.codesandbox.io/github/button-edit-lime.svg)](https://codesandbox.io/p/sandbox/github/withastro/astro/tree/latest/examples/basics)
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/withastro/astro?devcontainer_path=.devcontainer/basics/devcontainer.json)

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

![just-the-basics](https://github.com/withastro/astro/assets/2244813/a0a5533c-a856-4198-8470-2d67b1d7c554)

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
│   └── favicon.svg
├── src/
│   ├── components/
│   │   └── Card.astro
│   ├── layouts/
│   │   └── Layout.astro
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).

## Automated Dependency Updates and Deploys

This repo is configured to keep dependencies current and deploy automatically:

- `/.github/dependabot.yml`: daily npm updates and daily GitHub Actions updates.
- `/.github/workflows/dependabot-automerge.yml`: auto-enables merge for Dependabot PRs.
- `/.github/workflows/ci-deploy.yml`: verifies pull requests (`pnpm audit`, checks, build, typecheck) and runs `pnpm run deploy` on pushes to `main`.
- `/.github/workflows/security-sweep.yml`: daily dependency sweep (`pnpm update`, `pnpm audit --fix`) with an automated PR.

Required GitHub secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `AUTOMATION_GITHUB_TOKEN` (optional but recommended for security-sweep PRs to trigger normal PR workflows)

pnpm version source:

- Workflows intentionally do not pin a pnpm version in `pnpm/action-setup`.
- pnpm is taken from `package.json#packageManager` to avoid `ERR_PNPM_BAD_PM_VERSION`.

Required Cloudflare Worker runtime secrets (set in Cloudflare, not in GitHub):

- `STEAM_API_KEY`
- `TURSO_AUTH_TOKEN`

Recommended repository settings:

- Enable `Allow auto-merge` in GitHub repository settings.
- Protect `main` and require the `Verify` job from `CI and Deploy` before merging.
- Enable Dependabot security updates in repository security settings.
