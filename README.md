# Sentry loop orchestrator

Cursor SDK pipeline: **Sentry issue → investigate → fix/skeptic loop (max 3) → GitHub PR**.

Standalone npm package: **`@gohub/sentry-loop-orchestrator`**  
Repository: [`sentryloop_orchestrator`](https://github.com/mcrisologo/sentryloop_orchestrator)

Companion bridge (separate repo): [`sentryloop_rubybridge`](https://github.com/mcrisologo/sentryloop_rubybridge)
(`sentry_github_dispatch` Ruby gem).

## Why you need a bridge

Sentry’s plain **HTTP webhook** action **cannot** set `Authorization: Bearer …`, so it usually **cannot** call GitHub’s `repository_dispatch` API directly (401). Something trusted must receive Sentry’s webhook and then call GitHub with a PAT.

This package is the **orchestrator** (runs in GitHub Actions after dispatch). The **bridge** is whatever fires `repository_dispatch` with `event_type: sentry_issue`. Pick one option below.

---

## Bridge options (Sentry → GitHub)

### Option A — App as bridge (Rails gem `sentry_github_dispatch`)

Install the separate [`sentryloop_rubybridge`](https://github.com/mcrisologo/sentryloop_rubybridge) gem in your app. Sentry POSTs to your host; the gem verifies auth, allowlists environment, enqueues a job, and the job calls `repository_dispatch`.

```text
Sentry alert → https://<app>/internal/webhooks/sentry/<TOKEN>/auto_fix
            → DispatchJob → api.github.com/.../dispatches
            → Actions runs this orchestrator
```

| | |
|--|--|
| **Pros** | Full control in your codebase (path token, HMAC, header secret, env allowlist, rate limit, idempotency, kill switch). No third-party iPaaS. Same deploy/credentials story as the app. Matches the hardened gem gates. |
| **Cons** | Trigger uptime is coupled to the app (if the app is down, new Sentry→Actions fires stall). You operate webhook secrets + a fine-grained GitHub PAT on the app host. Rails/Puma must use a **shared** cache for idempotency. |

**Best when:** you already run a Rails app that can expose a public webhook, and you want security gates owned in-repo.

See gem README: [sentryloop_rubybridge](https://github.com/mcrisologo/sentryloop_rubybridge).

---

### Option B — External Worker / Zapier / Make

Sentry → Worker (or similar) → same `repository_dispatch` HTTP call. Store the GitHub PAT only in the Worker’s secrets.

| | |
|--|--|
| **Pros** | CI / auto-fix triggers are **not** tied to app uptime. Isolates the failure domain (app outage ≠ silent Sentry pipeline). Easy to swap apps that share one Worker. |
| **Cons** | Auth/filters live outside your app (easy to drift from prod allowlists). Another vendor + secret surface. Harder to reuse the gem’s HMAC/idempotency/rate-limit story unless you reimplement them in the Worker. |

**Best when:** you do not want webhook traffic or PAT material on the app, or app downtime must not block incident automation.

---

### Option C — Manual only (`workflow_dispatch`)

Skip any bridge. In GitHub Actions → **Sentry auto-fix** → **Run workflow** → paste a Sentry issue URL (or run the CLI locally).

| | |
|--|--|
| **Pros** | Zero webhook attack surface. No PAT on the app. Good for pilots, cost control, and learning the orchestrator. |
| **Cons** | Not unattended — someone must notice Sentry and start the run. No automatic prod signal → PR loop. |

**Best when:** volume is low, or you are still wiring secrets / Cursor / filters before enabling A or B.

---

### What does *not* work (or is rejected)

| Approach | Why not |
|----------|---------|
| Direct Sentry → `api.github.com/.../dispatches` | Plain Sentry webhooks cannot set GitHub `Authorization` → usually **401**. |
| Cursor Automation with native Sentry trigger only | Fine for a pilot; skeptic/loop gates are **soft** (prompt-only) — weaker for unattended prod than this SDK orchestrator. |
| Auto-merge on green CI | Rejected — agent-authored fixes still need human review. |

---

### Choosing quickly

```text
Need unattended prod alerts?
  no  → Option C (manual)
  yes → OK to put webhook + PAT on the app?
          yes → Option A (gem bridge)
          no  → Option B (Worker / Zapier / Make)
```

All three still end the same way: GitHub Actions runs **this** orchestrator, which opens a PR for humans — **never auto-merges**.

---

## Install

```bash
npm install github:OWNER/sentryloop_orchestrator
# or after publish:
npm install @gohub/sentry-loop-orchestrator

npx sentry-fix-orchestrator --issue-url "https://sentry.io/issues/123/"
```

Local sibling layout (optional, not a monorepo):

```text
ror/dasig/
  dasig/
  sentry_loop/                    # folder only — not a git repo
    sentryloop_rubybridge/        # separate git repo (GitHub: sentryloop_rubybridge)
    sentryloop_orchestrator/      # this git repo
```

Host app workflows check out **this** repo alone (not a parent `sentry_loop` repo) and run `npm ci` here.

Each stage runs as a separate cloud agent (fixer **resumes** across rounds so the branch stays warm). A PR is opened only when:

1. Skeptic verdict is **Proceed** with no Critical/High/Block findings
2. Fixer reports **Tests passed: YES**
3. A regression spec path is present in the output

**Max block/review = 3** (hard cap). After three unsuccessful Block/Revise cycles the orchestrator exits with code 2 and opens a GitHub tracking issue from CI — never auto-merges.

**Fingerprint dedupe:** repeat events and sibling Sentry issues for the same bug (normalized title + culprit + top `app/` frame) share one fingerprint. While a lock or open PR exists for that key, later fires exit 0 as skipped. Bypass with `--force` / `DEDUPE_FORCE=1`.

## Prerequisites

1. **Cursor API key** — [Dashboard → Integrations](https://cursor.com/dashboard/integrations)
2. **Cloud Agents enabled** for the target GitHub repo
3. **Node.js 22.13+** locally; GitHub Actions uses Node 22

## Quick start (manual test)

```bash
npm install

# CURSOR_API_KEY from package .env, or TARGET_APP_ROOT env files (allowlisted keys only)
npm start -- --payload-file examples/sentry-payload.json
npm start -- --issue-url "https://sentry.io/issues/1234567890/" --title "NoMethodError in FooService"
```

Exit codes:

| Code | Meaning |
|------|---------|
| 0 | Agreement + PR URL, **or** dedupe skip / lock fail-closed, **or** kill switch off |
| 1 | Startup/config error |
| 2 | Max block/review (3) without agreement |
| 3 | Agreement but PR URL missing |

## GitHub Actions (host app)

1. Checkout the app repo
2. Checkout `OWNER/sentryloop_orchestrator` into `sentryloop_orchestrator/`
3. `npm ci` + run from that directory

Optional Actions variable: `SENTRY_LOOP_ORCHESTRATOR_REPOSITORY` (default `{owner}/sentryloop_orchestrator`).  
Optional secret: `SENTRY_LOOP_GITHUB_TOKEN` if the orchestrator repo is private.

### Secrets / variables (on the **app** repo)

| Name | Kind | Purpose |
|------|------|---------|
| `CURSOR_API_KEY` | secret | Cursor cloud agents |
| `SENTRY_LOOP_GITHUB_TOKEN` | secret (optional) | Checkout private orchestrator repo |
| `SENTRY_LOOP_ORCHESTRATOR_REPOSITORY` | variable (optional) | Default `{owner}/sentryloop_orchestrator` |
| `SENTRY_AUTO_FIX_ENABLED` | variable | Must be `true`/`1`/`on`/`yes` to run (default **off**) |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_API_KEY` | — | Required (unless `--fingerprint-only`) |
| `GITHUB_OWNER` / `GITHUB_REPO` | — | **Required** (no hardcoded defaults) |
| `DEFAULT_BRANCH` | `main` | PR base branch |
| `CURSOR_MODEL` | `composer-2.5` | Cloud agent model |
| `MAX_FIX_ITERATIONS` | `3` | Block/review cycles; **hard-capped at 3** |
| `SENTRY_AUTO_FIX_ENABLED` | off | Set `true`/`1`/`on`/`yes` to run agents |
| `PROJECT_CONTEXT` / `PROJECT_CONTEXT_PATH` | generic stub | Host project instructions for agents |
| `GH_TOKEN` / `GITHUB_TOKEN` | — | Fingerprint dedupe (required in CI) |
| `DEDUPE_FORCE` | — | Bypass dedupe |
| `RESULT_PATH` | — | Summary JSON path (`RESULT_FULL=1` for full transcripts) |
| `TARGET_APP_ROOT` | — | Extra allowlisted env-file search root |

## Local development

```bash
npm test
npm run typecheck
npm run build
```

Do not commit `.env` or API keys.

## Related

- Bridge gem repo: https://github.com/mcrisologo/sentryloop_rubybridge
- [SECURITY.md](./SECURITY.md)
