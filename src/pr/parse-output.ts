import type { SkepticReport, SkepticVerdict } from "../types.js";

const VERDICT_RE = /Verdict:\s*(Block|Revise|Proceed)/i;
const BLOCKING_SEVERITY_RE = /Severity:\s*(Critical|High|Block)/i;

export function parseSkepticReport(raw: string): SkepticReport {
  const verdictMatch = raw.match(VERDICT_RE);
  const verdict = (verdictMatch?.[1] ?? "Revise") as SkepticVerdict;

  const blockingFindings: string[] = [];
  const lines = raw.split("\n");
  let inFindings = false;

  for (const line of lines) {
    if (/^-?\s*Findings:/i.test(line)) {
      inFindings = true;
      continue;
    }
    if (inFindings && /^-?\s*(Missing evidence|Residual risks|SKEPTIC REPORT)/i.test(line)) {
      inFindings = false;
    }
    if (inFindings && BLOCKING_SEVERITY_RE.test(line)) {
      blockingFindings.push(line.trim());
    }
  }

  return { verdict, raw, blockingFindings };
}

export function skepticAllowsProceed(report: SkepticReport): boolean {
  return report.verdict === "Proceed" && report.blockingFindings.length === 0;
}

export function extractSection(raw: string, heading: string): string {
  const re = new RegExp(
    `(?:^|\\n)##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    "i",
  );
  return raw.match(re)?.[1]?.trim() ?? "";
}

function hardProofText(raw: string): string {
  const tagged = raw.match(/<<<HARD_PROOF>>>([\s\S]*?)<<<\/HARD_PROOF>>>/i)?.[1];
  if (tagged?.trim()) return tagged;
  const legacy = raw.match(/<<<HARD_PROOF>>>([\s\S]*?)<<<HARD_PROOF>>>/i)?.[1];
  if (legacy?.trim()) return legacy;
  return extractSection(raw, "Hard proof");
}

export function extractRegressionSpecPath(raw: string): string | undefined {
  const proof = hardProofText(raw);
  const specMatch =
    proof.match(/(?:regression\s*)?spec:\s*`([^`]+)`/i) ??
    proof.match(/(?:regression\s*)?spec:\s*(\S+)/i) ??
    raw.match(/spec\/[\w./_-]+\.rb/);
  return specMatch?.[1] ?? specMatch?.[0];
}

export function extractTestPassed(raw: string): boolean {
  const proof = hardProofText(raw).toLowerCase();
  // Any explicit non-zero failure count wins over a self-attested YES.
  if (/\b([1-9]\d*)\s+failures?\b/.test(proof)) return false;
  if (/\d+\s+examples?,\s*([1-9]\d*)\s+failures?\b/.test(proof)) return false;
  if (/tests passed:\s*yes\b/i.test(proof)) return true;
  return /\b0 failures\b/.test(proof) || /\d+\s+examples?,\s*0\s+failures\b/.test(proof);
}
