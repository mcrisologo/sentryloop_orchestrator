import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parseSentryPayload } from "./parse-payload.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("parseSentryPayload", () => {
  it("parses the golden client_payload fixture", () => {
    const raw = JSON.parse(
      readFileSync(join(root, "examples/client_payload.golden.json"), "utf8"),
    );
    const issue = parseSentryPayload(raw);
    assert.equal(issue.issueId, "1234567890");
    assert.equal(issue.environment, "production");
    assert.match(issue.stacktrace ?? "", /example_service\.rb:15/);
  });

  it("unwraps nested client_payload / data shapes", () => {
    const raw = JSON.parse(
      readFileSync(join(root, "examples/sentry-nested-payload.json"), "utf8"),
    );
    const issue = parseSentryPayload(raw);
    assert.equal(issue.issueId, "9876543210");
    assert.equal(issue.environment, "production");
    assert.match(issue.stacktrace ?? "", /clients_controller\.rb:24/);
  });

  it("throws when required identity fields are missing", () => {
    assert.throws(() => parseSentryPayload({ title: "only" }), /issue/i);
  });
});

describe("client_payload contract", () => {
  it("golden fixture has required schema keys", () => {
    const schema = JSON.parse(
      readFileSync(join(root, "schemas/client_payload.schema.json"), "utf8"),
    );
    const golden = JSON.parse(
      readFileSync(join(root, "examples/client_payload.golden.json"), "utf8"),
    );
    for (const key of schema.required as string[]) {
      assert.ok(golden[key] != null && String(golden[key]).length > 0, key);
    }
  });
});
