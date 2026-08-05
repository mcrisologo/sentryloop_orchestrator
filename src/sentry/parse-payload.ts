import type { SentryIssueContext } from "../types.js";
import { validateSentryIssueUrl } from "./issue-url.js";

/** Loose shape covering alert webhooks, issue webhooks, and repository_dispatch. */
interface RawPayload {
  issue_id?: string;
  issueId?: string;
  id?: string | number;
  issue_url?: string;
  issueUrl?: string;
  url?: string;
  web_url?: string;
  permalink?: string;
  title?: string;
  message?: string;
  culprit?: string;
  level?: string;
  environment?: string;
  first_seen?: string;
  firstSeen?: string;
  count?: number | string;
  stacktrace?: string;
  stack_trace?: string;
  issue?: NestedIssue;
  event?: NestedEvent;
  data?: {
    issue?: NestedIssue;
    event?: NestedEvent;
  };
  client_payload?: RawPayload;
}

interface NestedIssue {
  id?: string | number;
  shortId?: string;
  title?: string;
  culprit?: string;
  level?: string;
  count?: string | number;
  firstSeen?: string;
  permalink?: string;
  url?: string;
  web_url?: string;
  metadata?: { type?: string; value?: string; title?: string };
}

interface NestedEvent {
  environment?: string;
  stacktrace?: string;
  title?: string;
  message?: string;
  exception?: {
    values?: Array<{
      type?: string;
      value?: string;
      stacktrace?: {
        frames?: Array<{
          filename?: string;
          abs_path?: string;
          function?: string;
          lineno?: number;
          context_line?: string;
        }>;
      };
    }>;
  };
  entries?: Array<{
    type?: string;
    data?: {
      values?: Array<{
        type?: string;
        value?: string;
        stacktrace?: {
          frames?: Array<{
            filename?: string;
            absPath?: string;
            function?: string;
            lineNo?: number;
            context?: Array<[number, string]>;
          }>;
        };
      }>;
    };
  }>;
}

function pickString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const v of values) {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

function formatFrames(
  frames: Array<{
    filename?: string;
    abs_path?: string;
    absPath?: string;
    function?: string;
    lineno?: number;
    lineNo?: number;
    context_line?: string;
  }>,
): string {
  return frames
    .filter((f) => f.filename || f.abs_path || f.absPath)
    .map((f) => {
      const file = f.filename || f.abs_path || f.absPath || "?";
      const line = f.lineno ?? f.lineNo;
      const fn = f.function ? ` in \`${f.function}\`` : "";
      const loc = line != null ? `${file}:${line}` : file;
      return `  ${loc}${fn}`;
    })
    .join("\n");
}

function stacktraceFromEvent(event?: NestedEvent): string | undefined {
  if (!event) return undefined;
  if (typeof event.stacktrace === "string" && event.stacktrace.trim()) {
    return event.stacktrace.trim();
  }

  const exception = event.exception?.values?.[0];
  if (exception?.stacktrace?.frames?.length) {
    const header = [exception.type, exception.value].filter(Boolean).join(": ");
    return [header, formatFrames(exception.stacktrace.frames)].filter(Boolean).join("\n");
  }

  const entry = event.entries?.find((e) => e.type === "exception");
  const value = entry?.data?.values?.[0];
  if (value?.stacktrace?.frames?.length) {
    const header = [value.type, value.value].filter(Boolean).join(": ");
    return [header, formatFrames(value.stacktrace.frames)].filter(Boolean).join("\n");
  }

  return pickString(event.message, event.title);
}

function unwrapPayload(raw: RawPayload): RawPayload {
  if (raw.client_payload && typeof raw.client_payload === "object") {
    return { ...raw.client_payload, ...raw };
  }
  return raw;
}

function issueUrlFromId(issueId: string): string {
  return `https://sentry.io/issues/${issueId}/`;
}

export function parseSentryPayload(raw: unknown): SentryIssueContext {
  if (!raw || typeof raw !== "object") {
    throw new Error("Expected a JSON object for the Sentry payload.");
  }

  const p = unwrapPayload(raw as RawPayload);
  const nestedIssue = p.issue ?? p.data?.issue;
  const nestedEvent = p.event ?? p.data?.event;

  const issueId = pickString(
    p.issue_id,
    p.issueId,
    p.id,
    nestedIssue?.id,
    nestedIssue?.shortId,
  );

  const issueUrl = pickString(
    p.issue_url,
    p.issueUrl,
    p.web_url,
    p.permalink,
    p.url,
    nestedIssue?.permalink,
    nestedIssue?.url,
    nestedIssue?.web_url,
    issueId ? issueUrlFromId(issueId) : undefined,
  );

  const title = pickString(
    p.title,
    nestedIssue?.title,
    nestedIssue?.metadata?.title,
    nestedIssue?.metadata?.value
      ? `${nestedIssue.metadata.type ?? "Error"}: ${nestedIssue.metadata.value}`
      : undefined,
    nestedEvent?.title,
    nestedEvent?.message,
    p.message,
  );

  if (!issueId) throw new Error("Sentry payload missing issue id.");
  if (!issueUrl) throw new Error("Sentry payload missing issue URL.");
  if (!title) throw new Error("Sentry payload missing issue title.");

  return {
    issueId,
    issueUrl: validateSentryIssueUrl(issueUrl),
    title,
    culprit: pickString(p.culprit, nestedIssue?.culprit),
    level: pickString(p.level, nestedIssue?.level),
    environment: pickString(p.environment, nestedEvent?.environment),
    firstSeen: pickString(p.first_seen, p.firstSeen, nestedIssue?.firstSeen),
    count: pickNumber(p.count, nestedIssue?.count),
    stacktrace: pickString(
      p.stacktrace,
      p.stack_trace,
      stacktraceFromEvent(nestedEvent),
    ),
    metadata: p as Record<string, unknown>,
  };
}

function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

export async function readPayloadFromArgs(args: string[]): Promise<SentryIssueContext> {
  const url = flagValue(args, "--issue-url");
  if (url) {
    const idMatch = url.match(/\/issues\/(\d+)/);
    return {
      issueId: idMatch?.[1] ?? `manual-${Date.now()}`,
      issueUrl: validateSentryIssueUrl(url),
      title: flagValue(args, "--title") ?? "Manual Sentry issue",
      stacktrace: flagValue(args, "--stacktrace"),
    };
  }

  const path = flagValue(args, "--payload-file");
  if (path) {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(path, "utf8");
    return parseSentryPayload(JSON.parse(text));
  }

  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (text) return parseSentryPayload(JSON.parse(text));
  }

  throw new Error(
    "No Sentry payload. Pass --issue-url, --payload-file, or pipe JSON on stdin.",
  );
}
