import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runOrchestrator } from "./orchestrator.js";
import type { OrchestratorConfig, SentryIssueContext } from "./types.js";

const issue: SentryIssueContext = {
  issueId: "1",
  issueUrl: "https://sentry.io/issues/1/",
  title: "Boom",
  environment: "production",
};

function baseConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    apiKey: "test-key",
    githubOwner: "acme",
    githubRepo: "widgets",
    defaultBranch: "main",
    model: "composer-2.5",
    maxFixIterations: 3,
    enabled: false,
    projectContext: "test project",
    requireDedupeLock: false,
    ...overrides,
  };
}

describe("runOrchestrator kill switch", () => {
  it("returns stopReason=disabled without calling agents", async () => {
    const result = await runOrchestrator(issue, baseConfig({ enabled: false }));
    assert.equal(result.stopReason, "disabled");
    assert.equal(result.agreed, false);
    assert.equal(result.iterations.length, 0);
  });
});
