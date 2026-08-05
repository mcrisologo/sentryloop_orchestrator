import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateSentryIssueUrl } from "./issue-url.js";

describe("validateSentryIssueUrl", () => {
  it("accepts sentry.io issue URLs", () => {
    assert.equal(
      validateSentryIssueUrl("https://sentry.io/issues/123/"),
      "https://sentry.io/issues/123/",
    );
  });

  it("accepts org subdomains of sentry.io", () => {
    assert.match(
      validateSentryIssueUrl("https://acme.sentry.io/issues/123/"),
      /acme\.sentry\.io/,
    );
  });

  it("rejects http URLs", () => {
    assert.throws(
      () => validateSentryIssueUrl("http://sentry.io/issues/123/"),
      /HTTPS/,
    );
  });

  it("rejects non-Sentry hosts", () => {
    assert.throws(
      () => validateSentryIssueUrl("https://evil.example/issues/123/"),
      /allowed Sentry host/,
    );
  });

  it("honors SENTRY_ALLOWED_HOSTS for self-hosted", () => {
    assert.equal(
      validateSentryIssueUrl("https://sentry.internal.example/issues/9/", {
        SENTRY_ALLOWED_HOSTS: "sentry.internal.example",
      }),
      "https://sentry.internal.example/issues/9/",
    );
  });
});
