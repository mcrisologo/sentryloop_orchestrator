# Security

## Threat model (orchestrator)

| Surface | Risk | Mitigations |
|---------|------|-------------|
| Prompt injection via Sentry title/stack | Steer Cursor agents that push code | Untrusted delimiters; truncate stacks; no auto-merge; host CI must verify |
| Misconfigured public install | Agents hit wrong repo / burn Cursor quota | Required `GITHUB_OWNER`/`GITHUB_REPO`; kill switch default **off** |
| Secret leakage | Cursor / GitHub tokens in git | `.gitignore` for `.env`; allowlisted env-file keys only |
| Duplicate spend | Race on lock / missing token | Fail-closed lock when token present; require token in CI |

## Operator checklist

1. Set `SENTRY_AUTO_FIX_ENABLED=true` only after secrets + budgets are ready.
2. Require status checks on the claimed regression before merging auto-fix PRs.
3. Cap Actions concurrency on the **host app** workflow (e.g. `concurrency.group: sentry-auto-fix`).
4. Install Cursor GitHub App with least privilege on the target repo only.

## Reporting

Open a private security advisory on this repository.
