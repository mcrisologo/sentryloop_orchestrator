# Orchestrator runtime

Back to the [orchestrator mind map](../mind_maps/orchestrator.md).

Internals for changing or debugging `@gohub/sentry-loop-orchestrator`. Operator threat model stays in [SECURITY.md](../../SECURITY.md). Wire fields stay in [CONTRACT.md](../../CONTRACT.md).

## Design decisions

| Date | Problem | Chose | Rejected |
|------|---------|-------|----------|
| 2026 | Sentry HTTP webhooks cannot set GitHub `Authorization` | Split **bridge** (webhook → `repository_dispatch`) from **orchestrator** (Actions → Cursor agents → PR) | Direct Sentry → GitHub API (401); auto-merge on green CI (agent output is not proof) |
| 2026 | Prompt injection via Sentry title/stack | Untrusted tagged blocks, delimiter neutralization, instruction-phrase replacement, markdown escape at GitHub sinks | Prompt-only “don’t follow the title” with no wrapping |
| 2026 | Duplicate Sentry events burn Cursor quota | SHA-256 fingerprint + GitHub lock issue, fail-closed when a token is present | In-memory locks (lost across Actions jobs) |
| 2026 | Cloud SDK has no `tools` / `disallowedTools` | Document residual risk; skipReviewerRequest; autoCreatePR false; human merge | Pretend the skeptic is a sandbox |

## Entrypoints and config

| Entrypoint | Path | Role |
|------------|------|------|
| CLI | `bin/sentry-fix-orchestrator.js` → `src/index.ts` | Parse args/stdin, run orchestrator, write summary / `RESULT_PATH` |
| Library | `src/orchestrator.ts` `runOrchestrator` | Kill switch, dedupe, fix loop, PR author |
| Payload | `src/sentry/parse-payload.ts` | `client_payload` / nested Sentry JSON → `SentryIssueContext` |
| Host Actions | *not in this repo* | Checkout this package, `npm ci`, run the CLI with secrets |

Required env (no hardcoded owner/repo): `CURSOR_API_KEY`, `GITHUB_OWNER`, `GITHUB_REPO`. Agents also need `SENTRY_AUTO_FIX_ENABLED` on. Optional: `CURSOR_MODEL`, `MAX_FIX_ITERATIONS` (clamped to 3), `PROJECT_CONTEXT` / `PROJECT_CONTEXT_PATH`, `GH_TOKEN` / `GITHUB_TOKEN`, `SENTRY_ALLOWED_HOSTS`, `RESULT_PATH`. Allowlisted `.env` keys: `src/load-env.ts`.

## Call flow

Sample: `sentry-fix-orchestrator --payload-file examples/client_payload.golden.json`

1. `loadLocalEnvFiles` — allowlisted keys only; does not override process env.
2. `readPayloadFromArgs` → `parseSentryPayload` → `validateSentryIssueUrl` (HTTPS, allowlisted host, `/issues/`, no credentials).
3. `loadConfig` — fail if API key or owner/repo missing; `assertGithubName` on owner/repo.
4. `runOrchestrator`:
   - If kill switch off → `stopReason: disabled`, exit 0.
   - `checkDedupe` / `acquireDedupeSlot` — skip on open PR or lower-numbered lock.
   - `runCloudAgent` investigator → tagged `ROOT_CAUSE` / `AFFECTED_FILES`.
   - Loop ≤3: fixer (`Agent.resume` after round 1) then skeptic; parse verdict, tests, spec path.
   - On agreement: `buildPrBody` → PR-author agent → `extractPrUrl` for **this** owner/repo only.
   - `finally` close the lock issue.
5. CLI maps stop reasons to exit codes: 0 skip/disabled, 1 config, 2 no agreement, 3 agreement but no PR URL.

## Code map

| File | Job |
|------|-----|
| `src/index.ts` | CLI, exit codes, step summary, `RESULT_PATH` |
| `src/orchestrator.ts` | Loop + agreement gates |
| `src/config.ts` | Kill switch, iteration clamp, owner/repo names |
| `src/prompts/untrusted.ts` | Truncate, delimiter + instruction neutralization, untrusted blocks |
| `src/prompts/index.ts` | Investigator / fixer / skeptic / PR-author prompts |
| `src/agents/run-agent.ts` | Cursor SDK create/resume/wait; PR URL allowlist |
| `src/dedupe/fingerprint.ts` | Stable 16-hex key + branch name |
| `src/dedupe/check.ts` | Lock issue create/race/close via `gh` |
| `src/pr/parse-output.ts` | Skeptic verdict, tests-passed, spec path |
| `src/pr/build-body.ts` / `failure-report.ts` | Markdown for PRs and CI summaries |
| `src/format/markdown.ts` | Escape helpers for GitHub markdown sinks |

## Rules and permissions

Enforced in code (not only in prompts):

- Kill switch default off (`isSentryAutoFixEnabled`).
- Owner/repo required + GitHub name charset (`assertGithubName`).
- Sentry URL host allowlist (`sentry.io` or `SENTRY_ALLOWED_HOSTS`).
- Max 3 block/review rounds (`MAX_BLOCK_REVIEWS`).
- `autoCreatePR: false`; PR URL must match configured owner/repo.
- Dedupe fail-closed when `CI=true` / `REQUIRE_DEDUPE_TOKEN` and no GitHub token.
- Untrusted Sentry/agent text delimited and sanitized before prompting; GitHub issue/PR markdown escaped at the sink.

**Not enforceable in this SDK version:** cloud tool allowlists, read-only skeptic, wall-clock/token spend caps, webhook HMAC (bridge). Human merge + host CI remain mandatory.

AuthZ: the Cursor API key and GitHub token are the caller’s. The package does not implement multi-tenant isolation; one Actions job = one target repo.

## Side effects, failure modes, gotchas

- Side effects: Cursor cloud agents (clone, commit, push), GitHub lock issues, optional PR, optional `RESULT_PATH` file, GitHub step summary.
- Missing `sentry-auto-fix-lock` label → lock create fails → skip if `requireDedupeLock`.
- Agent-attested “Tests passed: YES” can lie; parsers reject a non-zero failure count in `HARD_PROOF` but host CI is the real proof.
- `RESULT_FULL=1` persists full transcripts (PII). Default is summary only.
- Local sibling folder names (`sentry_loop/`) are not GitHub repo names (`sentryloop_orchestrator`, `sentryloop_rubybridge`).
