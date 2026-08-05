import { loadConfig, MAX_BLOCK_REVIEWS } from "./config.js";
import {
  acquireDedupeSlot,
  checkDedupe,
  releaseDedupeLock,
} from "./dedupe/check.js";
import { branchNameForFingerprint } from "./dedupe/fingerprint.js";
import {
  extractPrUrl,
  extractTaggedBlock,
  resumeCloudAgent,
  runCloudAgent,
} from "./agents/run-agent.js";
import {
  fixerPrompt,
  investigatorPrompt,
  prAuthorPrompt,
  skepticPrompt,
} from "./prompts/index.js";
import { buildPrBody } from "./pr/build-body.js";
import {
  extractRegressionSpecPath,
  extractTestPassed,
  parseSkepticReport,
  skepticAllowsProceed,
} from "./pr/parse-output.js";
import type {
  FixIterationResult,
  InvestigationResult,
  OrchestratorConfig,
  OrchestratorResult,
  SentryIssueContext,
} from "./types.js";

export async function runOrchestrator(
  issue: SentryIssueContext,
  config: OrchestratorConfig = loadConfig(),
): Promise<OrchestratorResult> {
  const maxRounds = Math.min(config.maxFixIterations, MAX_BLOCK_REVIEWS);
  const force = config.dedupeForce === true;

  if (!config.enabled) {
    console.warn(
      "[orchestrator] kill switch: SENTRY_AUTO_FIX_ENABLED is off — skipping agents",
    );
    return {
      issue,
      investigation: { raw: "", rootCause: "", affectedFiles: [] },
      iterations: [],
      agreed: false,
      stopReason: "disabled",
      maxBlockReviews: maxRounds,
    };
  }

  const dedupe = await checkDedupe(issue, config, { force });
  const branchName = branchNameForFingerprint(
    dedupe.fingerprint,
    issue.title.slice(0, 40),
  );

  console.log(
    `[orchestrator] issue=${issue.issueId} fingerprint=${dedupe.fingerprint} branch=${branchName} max_block_reviews=${maxRounds}`,
  );
  console.log(`[dedupe] basis: ${dedupe.basis}`);

  if (dedupe.action === "skip") {
    console.warn(`[dedupe] skip — ${dedupe.reason}`);
    return {
      issue,
      investigation: { raw: "", rootCause: "", affectedFiles: [] },
      iterations: [],
      agreed: false,
      branchName,
      stopReason: "deduped",
      maxBlockReviews: maxRounds,
      fingerprint: dedupe.fingerprint,
      dedupeSkipped: true,
      dedupeReason: dedupe.reason,
      existingUrl: dedupe.existingUrl,
    };
  }

  const slot = await acquireDedupeSlot(issue, dedupe.fingerprint, config, {
    force,
  });
  if (slot.action === "skip") {
    console.warn(`[dedupe] slot skip — ${slot.reason}`);
    return {
      issue,
      investigation: { raw: "", rootCause: "", affectedFiles: [] },
      iterations: [],
      agreed: false,
      branchName,
      stopReason: "deduped",
      maxBlockReviews: maxRounds,
      fingerprint: dedupe.fingerprint,
      dedupeSkipped: true,
      dedupeReason: slot.reason,
      existingUrl: slot.existingUrl,
    };
  }
  const lockUrl = slot.lockUrl;
  if (lockUrl) console.log(`[dedupe] lock acquired ${lockUrl}`);

  try {
    return await runFixLoop(issue, config, {
      branchName,
      maxRounds,
      fingerprint: dedupe.fingerprint,
      lockUrl,
    });
  } finally {
    await releaseDedupeLock(
      lockUrl,
      config,
      `Lock released for fingerprint \`${dedupe.fingerprint}\` (Sentry ${issue.issueId}).`,
    );
  }
}

async function runFixLoop(
  issue: SentryIssueContext,
  config: OrchestratorConfig,
  ctx: {
    branchName: string;
    maxRounds: number;
    fingerprint: string;
    lockUrl?: string;
  },
): Promise<OrchestratorResult> {
  const { branchName, maxRounds, fingerprint } = ctx;
  const promptCtx = {
    projectContext: config.projectContext,
    defaultBranch: config.defaultBranch,
  };

  const investigationRun = await runCloudAgent(
    config,
    investigatorPrompt(issue, promptCtx),
    "investigator",
  );

  const investigation: InvestigationResult = {
    raw: investigationRun.text,
    rootCause: extractTaggedBlock(investigationRun.text, "ROOT_CAUSE"),
    affectedFiles: extractTaggedBlock(investigationRun.text, "AFFECTED_FILES")
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean),
  };

  const iterations: FixIterationResult[] = [];
  let priorFixerOutput: string | undefined;
  let priorSkepticRaw: string | undefined;
  let fixerAgentId: string | undefined;
  let agreed = false;
  let finalIteration: FixIterationResult | undefined;
  let stopReason: OrchestratorResult["stopReason"] = "max_block_reviews";

  for (let i = 1; i <= maxRounds; i++) {
    console.log(`[orchestrator] block/review ${i}/${maxRounds}`);

    const fixerPromptText = fixerPrompt({
      issue,
      investigation: investigation.raw,
      branchName,
      iteration: i,
      maxIterations: maxRounds,
      priorFixerOutput,
      skepticReport: priorSkepticRaw,
      projectContext: config.projectContext,
      defaultBranch: config.defaultBranch,
    });

    const fixerRun = fixerAgentId
      ? await resumeCloudAgent(config, fixerAgentId, fixerPromptText, `fixer-${i}`)
      : await runCloudAgent(config, fixerPromptText, `fixer-${i}`);

    fixerAgentId = fixerRun.agentId;

    const skepticRun = await runCloudAgent(
      config,
      skepticPrompt({
        issue,
        investigation: investigation.raw,
        fixerOutput: fixerRun.text,
        iteration: i,
        maxIterations: maxRounds,
        projectContext: config.projectContext,
      }),
      `skeptic-${i}`,
      { startingRef: branchName },
    );

    const skepticReport = parseSkepticReport(skepticRun.text);
    const testsPassed = extractTestPassed(fixerRun.text);
    const regressionSpecPath = extractRegressionSpecPath(fixerRun.text);
    const testOutput =
      extractTaggedBlock(fixerRun.text, "HARD_PROOF") ||
      extractSectionFromProof(fixerRun.text);

    const iterationResult: FixIterationResult = {
      iteration: i,
      fixerOutput: fixerRun.text,
      skepticReport,
      testsPassed,
      testOutput,
      regressionSpecPath,
      fixerAgentId,
      skepticAgentId: skepticRun.agentId,
    };
    iterations.push(iterationResult);

    priorFixerOutput = fixerRun.text;
    priorSkepticRaw = skepticRun.text;

    if (skepticAllowsProceed(skepticReport) && testsPassed && regressionSpecPath) {
      agreed = true;
      finalIteration = iterationResult;
      stopReason = "agreed";
      console.log(`[orchestrator] agreement at block/review ${i}`);
      break;
    }

    console.log(
      `[orchestrator] block/review ${i} not ready: verdict=${skepticReport.verdict} tests=${testsPassed} spec=${regressionSpecPath ?? "missing"}`,
    );

    if (i === maxRounds) {
      stopReason = "max_block_reviews";
      console.warn(
        `[orchestrator] hit max block/review cap (${maxRounds}) — no PR`,
      );
    }
  }

  let prUrl: string | undefined;
  let prBody: string | undefined;

  if (agreed && finalIteration) {
    prBody = buildPrBody(issue, investigation, finalIteration, fingerprint);
    const prTitle = `fix(sentry): ${issue.title.slice(0, 72)}`;
    const prRun = await runCloudAgent(
      config,
      prAuthorPrompt({
        branchName,
        prTitle,
        prBody,
        defaultBranch: config.defaultBranch,
      }),
      "pr-author",
      { startingRef: branchName },
    );
    prUrl = extractPrUrl(prRun.text, config.githubOwner, config.githubRepo);
    if (!prUrl) stopReason = "pr_missing";
  }

  return {
    issue,
    investigation,
    iterations,
    agreed,
    prUrl,
    prBody,
    branchName,
    stopReason,
    maxBlockReviews: maxRounds,
    fingerprint,
  };
}

function extractSectionFromProof(text: string): string {
  const hardProof = extractTaggedBlock(text, "HARD_PROOF");
  const match = hardProof.match(/```[\s\S]*?```/);
  return match?.[0]?.replace(/```/g, "").trim() ?? "";
}
