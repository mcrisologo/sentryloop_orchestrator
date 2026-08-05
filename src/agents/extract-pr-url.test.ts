import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractPrUrl } from "./run-agent.js";

describe("extractPrUrl", () => {
  it("accepts a PR URL for the configured owner/repo", () => {
    const text = "PR_URL=https://github.com/acme/widgets/pull/12";
    assert.equal(extractPrUrl(text, "acme", "widgets"), "https://github.com/acme/widgets/pull/12");
  });

  it("rejects a PR URL for a different repo", () => {
    const text = "PR_URL=https://github.com/evil/other/pull/99";
    assert.equal(extractPrUrl(text, "acme", "widgets"), undefined);
  });

  it("finds an untagged matching URL in free text", () => {
    const text = "Opened https://github.com/acme/widgets/pull/3 successfully";
    assert.equal(extractPrUrl(text, "acme", "widgets"), "https://github.com/acme/widgets/pull/3");
  });

  it("rejects spoofed tagged URL that does not match owner/repo", () => {
    const text = [
      "PR_URL=https://evil.example/phishing",
      "also see https://github.com/acme/widgets/pull/1",
    ].join("\n");
    // Tagged line is invalid; free-text match for the configured repo still wins.
    assert.equal(extractPrUrl(text, "acme", "widgets"), "https://github.com/acme/widgets/pull/1");
  });
});
