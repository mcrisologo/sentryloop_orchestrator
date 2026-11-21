import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractTaggedBlock } from "./agents/run-agent.js";
import {
  extractTestPassed,
  extractRegressionSpecPath,
  parseSkepticReport,
  skepticAllowsProceed,
} from "./pr/parse-output.js";
import {
  assertGithubName,
  isSentryAutoFixEnabled,
  clampBlockReviews,
} from "./config.js";
import { truncate, untrustedBlock } from "./prompts/untrusted.js";
import { issueFingerprint } from "./dedupe/fingerprint.js";

describe("extractTaggedBlock", () => {
  it("parses slash-close tags", () => {
    const text = "<<<ROOT_CAUSE>>>\nhello\n<<</ROOT_CAUSE>>>";
    assert.equal(extractTaggedBlock(text, "ROOT_CAUSE"), "hello");
  });

  it("parses legacy same-tag close", () => {
    const text = "<<<HARD_PROOF>>>\nproof\n<<<HARD_PROOF>>>";
    assert.equal(extractTaggedBlock(text, "HARD_PROOF"), "proof");
  });
});

describe("parse-output gates", () => {
  it("requires Proceed without blocking findings", () => {
    const report = parseSkepticReport(`
SKEPTIC REPORT
- Verdict: Proceed
- Findings:
  - Severity: Low
    Claim challenged: n/a
`);
    assert.equal(report.verdict, "Proceed");
    assert.equal(skepticAllowsProceed(report), true);
  });

  it("blocks Critical findings even with Proceed", () => {
    const report = parseSkepticReport(`
- Verdict: Proceed
- Findings:
  - Severity: Critical
    Claim challenged: incomplete
`);
    assert.equal(skepticAllowsProceed(report), false);
  });

  it("reads tests passed only from HARD_PROOF", () => {
    const raw = `
<<<HARD_PROOF>>>
- Spec: \`spec/foo_spec.rb\`
- Tests passed: YES
0 failures
<<</HARD_PROOF>>>
`;
    assert.equal(extractTestPassed(raw), true);
    assert.equal(extractRegressionSpecPath(raw), "spec/foo_spec.rb");
  });

  it("ignores Tests passed outside HARD_PROOF", () => {
    const raw = "Tests passed: YES\n<<<HARD_PROOF>>>\nnothing\n<<</HARD_PROOF>>>";
    assert.equal(extractTestPassed(raw), false);
  });

  it("treats bare 0 failures as passed", () => {
    const raw = "<<<HARD_PROOF>>>\n0 failures\n<<</HARD_PROOF>>>";
    assert.equal(extractTestPassed(raw), true);
  });

  it("treats Tests passed: YES as passed", () => {
    const raw = "<<<HARD_PROOF>>>\nTests passed: YES\n<<</HARD_PROOF>>>";
    assert.equal(extractTestPassed(raw), true);
  });

  it("does not treat 10 failures as passed", () => {
    const raw = "<<<HARD_PROOF>>>\n10 failures\n<<</HARD_PROOF>>>";
    assert.equal(extractTestPassed(raw), false);
  });

  it("does not treat 100 failures as passed", () => {
    const raw = "<<<HARD_PROOF>>>\n100 failures\n<<</HARD_PROOF>>>";
    assert.equal(extractTestPassed(raw), false);
  });

  it("rejects Tests passed: YES when a non-zero failure count is present", () => {
    const raw =
      "<<<HARD_PROOF>>>\nTests passed: YES\n10 failures\n<<</HARD_PROOF>>>";
    assert.equal(extractTestPassed(raw), false);
  });
});

describe("config kill switch", () => {
  it("defaults to disabled", () => {
    assert.equal(isSentryAutoFixEnabled({}), false);
  });

  it("enables only on allowlisted values", () => {
    assert.equal(isSentryAutoFixEnabled({ SENTRY_AUTO_FIX_ENABLED: "true" }), true);
    assert.equal(isSentryAutoFixEnabled({ SENTRY_AUTO_FIX_ENABLED: "1" }), true);
    assert.equal(isSentryAutoFixEnabled({ SENTRY_AUTO_FIX_ENABLED: "false" }), false);
    assert.equal(isSentryAutoFixEnabled({ SENTRY_AUTO_FIX_ENABLED: "maybe" }), false);
  });

  it("clamps block reviews to 3", () => {
    assert.equal(clampBlockReviews(99), 3);
    assert.equal(clampBlockReviews(0), 3);
  });

  it("accepts GitHub owner and repo names", () => {
    assert.doesNotThrow(() => assertGithubName("GITHUB_OWNER", "mcrisologo"));
    assert.doesNotThrow(() =>
      assertGithubName("GITHUB_REPO", "sentryloop_orchestrator"),
    );
  });

  it("rejects owner/repo values that could inject paths or flags", () => {
    assert.throws(() => assertGithubName("GITHUB_OWNER", "../evil"), /must be/);
    assert.throws(() => assertGithubName("GITHUB_REPO", "--repo"), /must be/);
    assert.throws(() => assertGithubName("GITHUB_REPO", "acme/widgets"), /must be/);
  });
});

describe("untrusted helpers", () => {
  it("truncates long text", () => {
    assert.match(truncate("abcdefghij", 5), /truncated/);
  });

  it("wraps untrusted blocks", () => {
    const block = untrustedBlock("stacktrace", "boom");
    assert.match(block, /<<<UNTRUSTED:stacktrace>>>/);
    assert.match(block, /<<<\/UNTRUSTED:stacktrace>>>/);
  });
});

describe("fingerprint", () => {
  it("is stable for same title/culprit/frame", () => {
    const issue = {
      issueId: "1",
      issueUrl: "https://sentry.io/issues/1/",
      title: "NoMethodError in Foo",
      culprit: "app/services/foo.rb in call",
      stacktrace: "app/services/foo.rb:10:in `call'",
    };
    const a = issueFingerprint(issue);
    const b = issueFingerprint({ ...issue, issueId: "2" });
    assert.equal(a, b);
  });
});
