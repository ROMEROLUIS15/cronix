# CI/CD Gatekeeper — Preventing broken code from reaching Vercel

## Why this exists

Before this setup it was possible to push code with TypeScript errors or failing tests directly to GitHub, causing:
- Failed builds in Vercel
- Type errors discovered late (in CI, not locally)
- Broken tests visible in GitHub Actions without having run them locally first

## The 3 layers

```
git commit  →  [pre-commit]  ESLint --fix on staged files only     (~3s)
git push    →  [pre-push]    Full TypeCheck + Unit tests            (~40s)
GitHub CI   →  [Actions]     Tests + Lint on all branches           (always)
                             Build only on PRs / main / develop
Vercel      →  only receives code that passed everything above
```

## Layer 1 — pre-commit (Husky + lint-staged)

**File:** `.husky/pre-commit`

Runs `eslint --fix` only on staged files. Fast and invisible.

> **Important note:** `tsc --noEmit` was intentionally removed from lint-staged.
> Lint-staged passes file paths as arguments to each command, which causes TypeScript
> to enter "individual files" mode and completely ignore `tsconfig.json`.
> The real typecheck happens in the pre-push hook.

## Layer 2 — pre-push (Husky)

**File:** `.husky/pre-push`

```sh
npm run typecheck && npm test
```

- `typecheck`: `tsc --noEmit` over the full project using the real `tsconfig.json` (~10s)
- `test`: Vitest unit tests (~20-30s)

If either fails, the push is cancelled. Fix the error and try again.

## Layer 3 — GitHub Actions

**File:** `.github/workflows/test.yml`

| Job | When it runs | What it does |
|-----|-------------|--------------|
| `unit` | All pushes and PRs | Unit tests + ESLint |
| `build` | PRs + `main` / `develop` | Next.js production build |
| `integration` | Push only (not draft PRs) | Integration tests AI → DB |
| `e2e` | Push to `main` only | Playwright (chromium, firefox, webkit) |

## Initial setup (once per machine)

```bash
npm run prepare
```

Initializes Husky and registers the hooks in `.git/hooks/`.
Must be run after cloning the repo or if hooks stop working.

## If a hook fails unexpectedly

1. Read the full error — Husky prints exactly which command failed
2. For **lint**: run `npm run lint` to see all errors
3. For **typecheck**: run `npm run typecheck` to see all type errors
4. For **tests**: run `npm test` to see which tests failed
5. Fix, `git add` the changes, and retry the push

## Bypassing a hook in an emergency

```bash
git push --no-verify
```

Use only in exceptional, documented cases. GitHub Actions CI will still run regardless.
