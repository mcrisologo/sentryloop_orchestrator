# Security

## Threat model (orchestrator)

| Surface | Risk | Mitigations |
|---------|------|-------------|
| Prompt injection via Sentry title/stack | Steer Cursor agents that push code | Untrusted delimiters; truncate stacks; sanitized lock/PR markdown; no auto-merge; host CI must verify |
| Misconfigured public install | Agents hit wrong repo / burn Cursor quota | Required `GITHUB_OWNER`/`GITHUB_REPO` with name validation; kill switch default **off** |
| Secret leakage | Cursor / GitHub tokens in git; creds in issue URLs | `.gitignore` for `.env`; allowlisted env-file keys only; Sentry URLs reject embedded credentials |
| Duplicate spend | Race on lock / missing token | Fail-closed lock when token present; require token in CI |
| Full cloud toolset | Investigator/fixer/skeptic/PR-author all get the standard cloud agent tools | `@cursor/sdk` `tools` / `disallowedTools` are **local-only**; skeptic “read-only” is prompt-only. Do not treat the skeptic as a sandbox. |

## Operator checklist

1. Set `SENTRY_AUTO_FIX_ENABLED=true` only after secrets + budgets are ready.
2. Require status checks on the claimed regression before merging auto-fix PRs.
3. Cap Actions concurrency on the **host app** workflow (e.g. `concurrency.group: sentry-auto-fix`).
4. Install Cursor GitHub App with least privilege on the target repo only.
5. Treat skeptic output as advisory. Cloud agents cannot be tool-allowlisted today; require status checks on the claimed regression before merge.

## Reporting

Open a private security advisory on this repository.
