import { createHash } from "node:crypto";
import type { SentryIssueContext } from "../types.js";

/** Stable key so the same bug (many events / sibling issue IDs) maps to one run. */
export function issueFingerprint(issue: SentryIssueContext): string {
  const title = normalize(issue.title);
  const culprit = normalize(issue.culprit ?? "");
  const frame = topAppFrame(issue.stacktrace ?? "");
  const material = [title, culprit, frame].filter(Boolean).join("|");
  const basis = material || `issue:${issue.issueId}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export function fingerprintBasis(issue: SentryIssueContext): string {
  return [
    `title=${normalize(issue.title)}`,
    `culprit=${normalize(issue.culprit ?? "")}`,
    `frame=${topAppFrame(issue.stacktrace ?? "") || "n/a"}`,
  ].join("; ");
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, "0x?")
    .replace(/\b\d{4,}\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/** First in-app frame from a text stack trace, if present. */
export function topAppFrame(stacktrace: string): string {
  for (const line of stacktrace.split(/\r?\n/)) {
    const trimmed = line.trim();
    const app = trimmed.match(
      /((?:app|lib|packs)\/[\w./_-]+\.(?:rb|js|ts|tsx|jsx))(?::(\d+))?/i,
    );
    if (app) {
      return normalize(`${app[1]}${app[2] ? `:${app[2]}` : ""}`);
    }
  }
  return "";
}

export function branchNameForFingerprint(fingerprint: string, slug: string): string {
  const safeSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `fix/sentry-${fingerprint}${safeSlug ? `-${safeSlug}` : ""}`;
}
