# Wire contract: `client_payload`

Shared with [`sentry_loop_bridge`](https://github.com/mcrisologo/sentry_loop_bridge).

| Field | Required | Notes |
|-------|----------|-------|
| `issue_id` | yes | Sentry issue id (string or number) |
| `issue_url` | yes | Permalink |
| `title` | yes | Issue title / exception summary |
| `culprit` | no | Sentry culprit |
| `environment` | no | Used by bridge allowlist |
| `count` | no | Event count |
| `level` | no | e.g. `error` |
| `stacktrace` | no | Truncated text (bridge default 8k) |

- GitHub `event_type` default: `sentry_issue`
- Schema: [`schemas/client_payload.schema.json`](./schemas/client_payload.schema.json)
- Golden fixture: [`examples/client_payload.golden.json`](./examples/client_payload.golden.json)

Keep both package schemas/fixtures in sync when the wire shape changes.
