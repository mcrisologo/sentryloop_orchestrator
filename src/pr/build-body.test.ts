import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeMarkdownText } from "../format/markdown.js";
import { buildPrBody } from "./build-body.js";
import { buildFailureReport } from "./failure-report.js";
import type {
  FixIterationResult,
  InvestigationResult,
  OrchestratorResult,
  SentryIssueContext,
} from "../types.js";

describe("buildPrBody markdown safety", () => {
  it("does not put Sentry titles inside markdown links", () => {
    const issue: SentryIssueContext = {
      issueId: "1",
      issueUrl: "https://sentry.io/issues/1/",
      title: "Boom](https://evil.example) and *more*",
      culprit: "app/x.rb",
      environment: "production",
    };
    const investigation: InvestigationResult = {
      raw: "",
      rootCause: "root",
      affectedFiles: [],
    };
    const iteration: FixIterationResult = {
      iteration: 1,
      fixerOutput: "<<<HARD_PROOF>>>\nTests passed: YES\n<<</HARD_PROOF>>>",
      skepticReport: { verdict: "Proceed", raw: "", blockingFindings: [] },
      testsPassed: true,
      testOutput: "0 failures",
      regressionSpecPath: "spec/foo_spec.rb",
    };

    const body = buildPrBody(issue, investigation, iteration, "abc");
    assert.ok(
      body.includes("**Issue:** `Boom](https://evil.example) and *more*`"),
    );
    assert.ok(body.includes("**URL:** https://sentry.io/issues/1/"));
    assert.equal(body.includes("[Boom"), false);
  });
});

describe("escapeMarkdownText", () => {
  it("escapes brackets and emphasis markers", () => {
    assert.equal(escapeMarkdownText("a[b]*c"), "a\\[b\\]\\*c");
  });
});

describe("buildFailureReport markdown safety", () => {
  it("fences root cause and does not allow fence breakout", () => {
    const result: OrchestratorResult = {
      issue: {
        issueId: "1",
        issueUrl: "https://sentry.io/issues/1/",
        title: "Boom",
      },
      investigation: {
        raw: "",
        rootCause: "```\n# injected heading\n```",
        affectedFiles: [],
      },
      iterations: [
        {
          iteration: 1,
          fixerOutput: "",
          skepticReport: { verdict: "Revise", raw: "", blockingFindings: [] },
          testsPassed: false,
          testOutput: "",
          regressionSpecPath: "spec/`rm -rf`_spec.rb",
        },
      ],
      agreed: false,
      stopReason: "max_block_reviews",
      maxBlockReviews: 3,
    };

    const report = buildFailureReport(result);
    assert.match(report, /```text/);
    assert.equal(report.includes("```\n# injected"), false);
    assert.match(report, /spec\/'rm -rf'_spec\.rb/);
  });
});
