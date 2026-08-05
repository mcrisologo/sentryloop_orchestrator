import { Agent, CursorAgentError } from "@cursor/sdk";
import type { OrchestratorConfig } from "../types.js";

export interface AgentRunResult {
  agentId: string;
  runId: string;
  text: string;
  status: "finished" | "error" | "cancelled";
}

function cloudOptions(config: OrchestratorConfig, startingRef?: string) {
  const repoUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}`;

  return {
    apiKey: config.apiKey,
    model: { id: config.model },
    cloud: {
      repos: [
        {
          url: repoUrl,
          startingRef: startingRef ?? config.defaultBranch,
        },
      ],
      skipReviewerRequest: true,
      autoCreatePR: false,
    },
  };
}

export async function runCloudAgent(
  config: OrchestratorConfig,
  prompt: string,
  label: string,
  options: { startingRef?: string } = {},
): Promise<AgentRunResult> {
  console.log(`[agent] starting ${label}...`);

  try {
    await using agent = await Agent.create(cloudOptions(config, options.startingRef));
    return await sendAndWait(agent, prompt, label);
  } catch (err) {
    throw wrapAgentError(err, label);
  }
}

/** Continue the same cloud agent so git branch + conversation stay warm. */
export async function resumeCloudAgent(
  config: OrchestratorConfig,
  agentId: string,
  prompt: string,
  label: string,
): Promise<AgentRunResult> {
  console.log(`[agent] resuming ${label} agent_id=${agentId}...`);

  try {
    await using agent = await Agent.resume(agentId, {
      apiKey: config.apiKey,
    });
    return await sendAndWait(agent, prompt, label);
  } catch (err) {
    throw wrapAgentError(err, label);
  }
}

async function sendAndWait(
  agent: Awaited<ReturnType<typeof Agent.create>>,
  prompt: string,
  label: string,
): Promise<AgentRunResult> {
  const run = await agent.send(prompt);
  console.log(`[agent] ${label} run_id=${run.id} agent_id=${agent.agentId}`);

  const result = await run.wait();

  if (result.status === "error") {
    throw new Error(
      `${label} run failed (run_id=${run.id}): ${result.error?.message ?? "unknown"}`,
    );
  }

  const text =
    result.result?.trim() || (await collectAssistantTextFromStream(run));
  console.log(`[agent] ${label} finished (${text.length} chars)`);

  return {
    agentId: agent.agentId,
    runId: run.id,
    text,
    status: result.status,
  };
}

function wrapAgentError(err: unknown, label: string): Error {
  if (err instanceof CursorAgentError) {
    return new Error(
      `${label} startup failed: ${err.message} (retryable=${err.isRetryable})`,
    );
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

async function collectAssistantTextFromStream(
  run: Awaited<ReturnType<Awaited<ReturnType<typeof Agent.create>>["send"]>>,
): Promise<string> {
  const chunks: string[] = [];
  for await (const event of run.stream()) {
    if (event.type !== "assistant") continue;
    for (const block of event.message.content) {
      if (block.type === "text") chunks.push(block.text);
    }
  }
  return chunks.join("");
}

export function extractTaggedBlock(text: string, tag: string): string {
  const slash = new RegExp(`<<<${tag}>>>([\\s\\S]*?)<<<\\/${tag}>>>`, "i");
  const slashMatch = text.match(slash)?.[1]?.trim();
  if (slashMatch) return slashMatch;

  // Legacy: same open/close tag (pre-public-hardening prompts)
  const legacy = new RegExp(`<<<${tag}>>>([\\s\\S]*?)<<<${tag}>>>`, "i");
  return text.match(legacy)?.[1]?.trim() ?? "";
}

/**
 * Only accept a PR URL that belongs to the configured owner/repo. A spoofed or
 * poisoned URL in agent output must not be reported as the produced PR.
 */
export function extractPrUrl(
  text: string,
  owner: string,
  repo: string,
): string | undefined {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `https://github\\.com/${esc(owner)}/${esc(repo)}/pull/\\d+`,
    "i",
  );
  const tagged = text.match(/PR_URL=(\S+)/)?.[1]?.replace(/[)>.,]+$/, "");
  if (tagged && re.test(tagged)) return tagged;
  return text.match(re)?.[0];
}
