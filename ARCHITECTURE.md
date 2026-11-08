# Architecture — sentryloop_orchestrator

**Public names**

| Layer | Name |
|-------|------|
| GitHub repo | `sentryloop_orchestrator` |
| npm package | `@gohub/sentry-loop-orchestrator` |
| Env prefix | `SENTRY_AUTO_FIX_*` (+ `GITHUB_OWNER` / `GITHUB_REPO` / `CURSOR_API_KEY`) |

Companion: [`sentryloop_rubybridge`](https://github.com/mcrisologo/sentryloop_rubybridge).

## Runtime sequence

```text
repository_dispatch / workflow_dispatch / CLI
  → parseSentryPayload
  → runOrchestrator
       1. kill switch (enabled?)
       2. checkDedupe (open PR / existing lock)
       3. acquireDedupeSlot (create lock + race re-check)
       4. investigate (cloud agent)
       5. fix ↔ skeptic loop (max 3; fixer resumes)
       6. agreement gates: Proceed + Tests passed + regression spec
       7. PR author → extractPrUrl(owner, repo) only
       8. release lock
```

Never auto-merges. Human review + host CI required.

## Untrusted data

All Sentry-derived fields (title, URL, culprit, env, stack) are wrapped in
`<<<UNTRUSTED:…>>>` blocks with delimiter neutralization. Only `PROJECT_CONTEXT`
is treated as trusted instruction text.

## Docs

- Wire contract: [`CONTRACT.md`](./CONTRACT.md)
- Operator security: [`SECURITY.md`](./SECURITY.md)
- Host product mind maps live in the consuming app
