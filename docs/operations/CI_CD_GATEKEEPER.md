# CI/CD Gatekeeper — Preventing broken code from reaching Vercel

## Why this exists

Before this setup it was possible to push code with TypeScript errors or failing tests directly to GitHub, causing:
- Failed builds in Vercel
- Type errors discovered late (in CI, not locally)
- Broken tests visible in GitHub Actions without having run them locally first
- ESLint errors in CI that passed locally (lint-staged only checked staged files, not all files)

## The 3 layers

```
git push    →  [pre-push]    Lint + TypeCheck + Unit tests            (~60s)
GitHub CI   →  [Actions]     Tests + Lint on all branches             (always)
                             Build only on PRs / main / develop
                             E2E only on push to main
Vercel      →  only receives code that passed everything above
```

> **Note:** The pre-commit hook (lint-staged) runs ESLint `--fix` on staged files only (~3s).
> The real full-project checks happen in pre-push.

---

## Layer 1 — pre-commit (Husky + lint-staged)

**File:** `.husky/pre-commit`

Runs `eslint --fix` only on staged files. Fast and invisible (~3s).

---

## Layer 2 — pre-push (Husky)

**File:** `.husky/pre-push`

```sh
npm run lint && npm run typecheck && npm test
```

| Command | What it checks | Approx. time |
|---------|---------------|-------------|
| `npm run lint` | ESLint on all project files | ~5s |
| `npm run typecheck` | `tsc --noEmit` full project via `tsconfig.json` | ~10s |
| `npm test` | Vitest unit + repository tests | ~40s |

If any command fails, the push is cancelled. Fix the error and retry.

> **Why lint in pre-push and not just pre-commit?**
> lint-staged only checks staged files. A file not staged in the current commit
> (e.g. a test file added two commits ago) would never get linted locally — only
> in CI. Adding `npm run lint` to pre-push ensures the full project is always clean.

---

## Layer 3 — GitHub Actions

**File:** `.github/workflows/test.yml`

| Job | When it runs | What it does |
|-----|-------------|--------------|
| `unit` | All pushes and PRs on all branches | Unit tests + ESLint |
| `build` | PRs + pushes to `main` / `develop` | Next.js production build |
| `integration` | Push only (not draft PRs) | Integration tests AI → DB |
| `e2e` | Push to `main` or `develop` | Playwright (chromium, firefox, webkit) |

### Required GitHub Secrets

All secrets must be set in **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Used by |
|--------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | All jobs |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Build + E2E |
| `SUPABASE_SERVICE_ROLE_KEY` | Integration tests |
| `NEXT_PUBLIC_AXIOM_DATASET` | All jobs |
| `AXIOM_TOKEN` | All jobs |
| `E2E_TEST_EMAIL` | E2E setup |
| `E2E_TEST_PASSWORD` | E2E setup |

To add or update secrets from `.env.local`:
```bash
grep KEY .env.local | cut -d= -f2 | gh secret set KEY_NAME -R ROMEROLUIS15/cronix
```

---

## ESLint configuration

**File:** `.eslintrc.json`

The `@typescript-eslint` plugin is explicitly declared so that inline
`// eslint-disable-next-line @typescript-eslint/...` comments in test files
are recognized. Without this, CI fails with "Definition for rule not found".

```json
{
  "extends": "next/core-web-vitals",
  "plugins": ["@typescript-eslint"],
  "rules": {
    "@typescript-eslint/no-non-null-assertion": "off"
  }
}
```

---

## Initial setup (once per machine)

```bash
npm run prepare
```

Initializes Husky and registers the hooks in `.git/hooks/`.
Must be run after cloning the repo or if hooks stop working.

---

## If a hook fails unexpectedly

1. Read the full error — Husky prints exactly which command failed
2. For **lint**: run `npm run lint` to see all errors
3. For **typecheck**: run `npm run typecheck` to see all type errors
4. For **tests**: run `npm test` to see which tests failed
5. Fix, `git add` the changes, and retry the push

---

## Bypassing a hook in an emergency

```bash
git push --no-verify
```

Use only in exceptional, documented cases. GitHub Actions CI will still run regardless.

---

## Known pre-existing type errors (non-blocking)

These errors exist in `develop` and are tracked separately — they do not affect
the pre-push hook because `tsc` exits with code 0 when only these files fail
(they are excluded or typed as `any` at the call site):

| File | Error |
|------|-------|
| `app/[locale]/register/actions.ts` | `slug` not in business insert type |
| `app/api/assistant/voice/route.ts` | `getRepos` not imported |
| `app/auth/callback/route.ts` | `provider` / `slug` type mismatch |
| `lib/repositories/SupabaseUserRepository.ts` | role/status string → enum mismatch |

> These should be resolved in a dedicated `fix/typecheck-cleanup` branch.
