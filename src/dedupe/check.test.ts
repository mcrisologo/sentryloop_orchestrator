import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acquireDedupeSlot, type GhRunner } from "./check.js";
import type { OrchestratorConfig, SentryIssueContext } from "../types.js";

const issue: SentryIssueContext = {
  issueId: "1",
  issueUrl: "https://sentry.io/issues/1/",
  title: "Boom",
  environment: "production",
};

function baseConfig(
  overrides: Partial<OrchestratorConfig> = {},
): OrchestratorConfig {
  return {
    apiKey: "test-key",
    githubOwner: "acme",
    githubRepo: "widgets",
    defaultBranch: "main",
    model: "composer-2.5",
    maxFixIterations: 3,
    enabled: true,
    projectContext: "test",
    githubToken: "ghp_test",
    requireDedupeLock: true,
    ...overrides,
  };
}

function mockGh(handlers: Record<string, (args: string[]) => string>): GhRunner {
  return async (args) => {
    const key = args[0] === "issue" || args[0] === "pr" ? `${args[0]} ${args[1]}` : args.join(" ");
    const handler = handlers[key];
    if (!handler) throw new Error(`unexpected gh args: ${args.join(" ")}`);
    return handler(args);
  };
}

describe("acquireDedupeSlot", () => {
  it("skips when labeled lock create fails and requireDedupeLock is true", async () => {
    const runner = mockGh({
      "issue create": () => {
        throw new Error("label missing");
      },
    });

    const result = await acquireDedupeSlot(issue, "abc123", baseConfig(), {
      ghRunner: async (args, token, options) => {
        try {
          return await runner(args, token, options);
        } catch (err) {
          if (options?.allowFailure) return "";
          throw err;
        }
      },
    });

    assert.equal(result.action, "skip");
    if (result.action === "skip") {
      assert.match(result.reason, /could not create fingerprint lock/);
    }
  });

  it("closes own lock and skips when a lower-numbered competitor exists", async () => {
    const closed: string[] = [];
    const runner: GhRunner = async (args) => {
      const cmd = `${args[0]} ${args[1]}`;
      if (cmd === "issue create") {
        return JSON.stringify({
          url: "https://github.com/acme/widgets/issues/20",
          number: 20,
        });
      }
      if (cmd === "issue list") {
        return JSON.stringify([
          {
            number: 11,
            url: "https://github.com/acme/widgets/issues/11",
            title: "[sentry-auto-fix lock] abc123",
            body: "sentry-dedupe:abc123",
            labels: [{ name: "sentry-auto-fix-lock" }],
          },
          {
            number: 20,
            url: "https://github.com/acme/widgets/issues/20",
            title: "[sentry-auto-fix lock] abc123",
            body: "sentry-dedupe:abc123",
            labels: [{ name: "sentry-auto-fix-lock" }],
          },
        ]);
      }
      if (cmd === "pr list") return "[]";
      if (cmd === "issue comment" || cmd === "issue close") {
        closed.push(cmd);
        return "";
      }
      throw new Error(`unexpected: ${args.join(" ")}`);
    };

    const result = await acquireDedupeSlot(issue, "abc123", baseConfig(), {
      ghRunner: runner,
    });

    assert.equal(result.action, "skip");
    if (result.action === "skip") {
      assert.match(result.reason, /holds the lock/);
      assert.equal(result.existingUrl, "https://github.com/acme/widgets/issues/11");
    }
    assert.ok(closed.includes("issue close"));
  });

  it("fails closed when the post-create uniqueness scan errors", async () => {
    const closed: string[] = [];
    const runner: GhRunner = async (args) => {
      const cmd = `${args[0]} ${args[1]}`;
      if (cmd === "issue create") {
        return JSON.stringify({
          url: "https://github.com/acme/widgets/issues/20",
          number: 20,
        });
      }
      if (cmd === "issue list") throw new Error("gh list failed");
      if (cmd === "issue comment" || cmd === "issue close") {
        closed.push(cmd);
        return "";
      }
      throw new Error(`unexpected: ${args.join(" ")}`);
    };

    const result = await acquireDedupeSlot(issue, "abc123", baseConfig(), {
      ghRunner: runner,
    });

    assert.equal(result.action, "skip");
    if (result.action === "skip") {
      assert.match(result.reason, /could not verify fingerprint uniqueness/);
    }
    assert.ok(closed.includes("issue close"));
  });

  it("proceeds with lock when no competitor or open PR exists", async () => {
    const runner: GhRunner = async (args) => {
      const cmd = `${args[0]} ${args[1]}`;
      if (cmd === "issue create") {
        return JSON.stringify({
          url: "https://github.com/acme/widgets/issues/20",
          number: 20,
        });
      }
      if (cmd === "issue list") {
        return JSON.stringify([
          {
            number: 20,
            url: "https://github.com/acme/widgets/issues/20",
            title: "[sentry-auto-fix lock] abc123",
            body: "sentry-dedupe:abc123",
            labels: [{ name: "sentry-auto-fix-lock" }],
          },
        ]);
      }
      if (cmd === "pr list") return "[]";
      throw new Error(`unexpected: ${args.join(" ")}`);
    };

    const result = await acquireDedupeSlot(issue, "abc123", baseConfig(), {
      ghRunner: runner,
    });

    assert.equal(result.action, "proceed");
    if (result.action === "proceed") {
      assert.equal(result.lockUrl, "https://github.com/acme/widgets/issues/20");
    }
  });

  it("escapes Sentry title markdown in the lock issue body", async () => {
    const captured: string[] = [];
    const injected: SentryIssueContext = {
      ...issue,
      title: "[click me](https://evil.example) and *more*",
    };
    const runner: GhRunner = async (args) => {
      const cmd = `${args[0]} ${args[1]}`;
      if (cmd === "issue create") {
        const bodyIdx = args.indexOf("--body");
        captured.push(args[bodyIdx + 1] ?? "");
        return JSON.stringify({
          url: "https://github.com/acme/widgets/issues/20",
          number: 20,
        });
      }
      if (cmd === "issue list") {
        return JSON.stringify([
          {
            number: 20,
            url: "https://github.com/acme/widgets/issues/20",
            title: "[sentry-auto-fix lock] abc123",
            body: "sentry-dedupe:abc123",
            labels: [{ name: "sentry-auto-fix-lock" }],
          },
        ]);
      }
      if (cmd === "pr list") return "[]";
      throw new Error(`unexpected: ${args.join(" ")}`);
    };

    await acquireDedupeSlot(injected, "abc123", baseConfig(), {
      ghRunner: runner,
    });

    assert.equal(captured.length, 1);
    assert.match(captured[0], /\\\[click me\\]\(https:\/\/evil\.example\) and \\\*more\\\*/);
    assert.equal(captured[0].includes("[click me](https://evil.example)"), false);
  });
});
