export interface SentryIssueContext {
  issueId: string;
  issueUrl: string;
  title: string;
  culprit?: string;
  level?: string;
  environment?: string;
  firstSeen?: string;
  count?: number;
  stacktrace?: string;
  metadata?: Record<string, unknown>;
}

export type SkepticVerdict = "Block" | "Revise" | "Proceed";

export interface SkepticReport {
  verdict: SkepticVerdict;
  raw: string;
  blockingFindings: string[];
}

export interface InvestigationResult {
  raw: string;
  rootCause: string;
  affectedFiles: string[];
}

export interface FixIterationResult {
  iteration: number;
  fixerOutput: string;
  skepticReport: SkepticReport;
  testsPassed: boolean;
  testOutput: string;
  regressionSpecPath?: string;
  fixerAgentId?: string;
  skepticAgentId?: string;
}

export type OrchestratorStopReason =
  | "agreed"
  | "max_block_reviews"
  | "pr_missing"
  | "deduped"
  | "dedupe_lock_failed"
  | "disabled";

export interface OrchestratorResult {
  issue: SentryIssueContext;
  investigation: InvestigationResult;
  iterations: FixIterationResult[];
  agreed: boolean;
  prUrl?: string;
  prBody?: string;
  branchName?: string;
  stopReason: OrchestratorStopReason;
  maxBlockReviews: number;
  fingerprint?: string;
  dedupeSkipped?: boolean;
  dedupeReason?: string;
  existingUrl?: string;
}

export interface OrchestratorConfig {
  apiKey: string;
  githubOwner: string;
  githubRepo: string;
  defaultBranch: string;
  model: string;
  /** Cap on fixer↔skeptic Block/Revise cycles (hard-max 3). */
  maxFixIterations: number;
  /** GitHub token for dedupe lock / open-PR checks (GH_TOKEN or GITHUB_TOKEN). */
  githubToken?: string;
  /** Bypass dedupe (manual re-run). */
  dedupeForce?: boolean;
  /** Env kill switch; false unless SENTRY_AUTO_FIX_ENABLED is explicitly on. */
  enabled: boolean;
  /** Host-injected project instructions for agents. */
  projectContext: string;
  /** When true (token present), abort if lock issue cannot be created. */
  requireDedupeLock: boolean;
}
