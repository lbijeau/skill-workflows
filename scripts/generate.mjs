#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { atomicWrite, normalizeText, tomlEscape } from "./common.mjs";

// The orchestrator runs as a root agent_type (not "mode" — the AgentType
// enum in vibe only has agent/subagent; probed live at mistral-vibe 3.0.3).
export const ORCHESTRATOR_ENABLED_TOOLS = ["read_file", "write_file", "task", "ask_user_question"];
// enabled_tools allowlist defaults to ["explore"] with ASK permission and was
// observed not to bind the root agent at mistral-vibe 3.0.3 — hence the explicit list.
export const GENERATED_MARKER = "# skill-workflows: generated — safe to prune";

export function renderVibeOrchestratorTOML(workflows) {
  const description = tomlEscape(normalizeText("Run multi-agent workflows: dispatch each step, verify outputs, checkpoint between steps"));
  const workflowBlocks = (workflows ?? []).map((wf) => {
    const lines = [
      `workflow: ${tomlEscape(normalizeText(wf.name))}`,
      `description: ${tomlEscape(normalizeText(wf.description ?? ""))}`,
    ];
    wf.steps.forEach((step, i) => {
      const task = tomlEscape(normalizeText(step.task));
      lines.push(`step ${i + 1}: agent ${tomlEscape(normalizeText(step.agent))} — task: ${task} — output: ${tomlEscape(normalizeText(step.output))}`);
    });
    return lines.join("\n");
  });
  return [
    GENERATED_MARKER,
    'agent_type = "agent"',
    `description = "${description}"`,
    `enabled_tools = [${ORCHESTRATOR_ENABLED_TOOLS.map(t => `"${t}"`).join(", ")}]`,
    '# allowlist defaults to ["explore"] (ASK permission) and does not bind the root at mistral-vibe 3.0.3 — pin it explicitly',
    'disabled_tools = ["skill"]',
    'instructions = """',
    "You are the workflow orchestrator. Your single job is to run multi-agent workflows step by step: dispatch each step to its named agent, verify the output exists, and checkpoint between steps. You never do the step work yourself.",
    "",
    "Run contract:",
    "1. Spawn the step's agent with the step's task text using the `task` tool (spawn).",
    "2. Wait for the reply; do not proceed until it returns.",
    "3. Write the step's output file from the reply using write_file.",
    "4. Verify the output file is non-empty before moving on.",
    "5. Before the next step, use ask_user_question as a checkpoint: report the step's result and confirm whether to continue.",
    "6. If any step fails, stop and report the failure; never guess a substitute agent or do the work yourself.",
    "",
    "Resume rule: skip any step whose output file already exists and is non-empty.",
    "",
    "Workflows:",
    ...workflowBlocks,
    '"""',
    "",
  ].join("\n");
}

export const VIBE_ORCHESTRATOR_NAME = "workflow-orchestrator";

// Writes the generated workflow-orchestrator mode when the manifest is valid
// and non-empty; prunes the previously generated file when it goes stale.
// A file without the generated marker is user-authored and is never touched.
export function writeVibeOrchestrator(root, wfState) {
  const file = path.join(root, "agents-vibe", `${VIBE_ORCHESTRATOR_NAME}.toml`);
  const userAuthored = () => fs.existsSync(file)
    && !fs.readFileSync(file, "utf8").split("\n", 5).join("\n").includes(GENERATED_MARKER);
  if (wfState?.valid && wfState.workflows.length > 0) {
    // The marker guard protects the prune path; it must protect the write
    // path too — a user-authored file at the generated path is never
    // clobbered, only reported.
    if (userAuthored()) return { written: false, removed: false, skippedUserFile: true };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    atomicWrite(file, renderVibeOrchestratorTOML(wfState.workflows));
    return { written: true, removed: false };
  }
  if (fs.existsSync(file)) {
    const head = fs.readFileSync(file, "utf8").split("\n", 5).join("\n");
    if (head.includes(GENERATED_MARKER)) {
      fs.rmSync(file);
      return { written: false, removed: true };
    }
    return { written: false, removed: false, skippedUserFile: true };
  }
  return { written: false, removed: false };
}
