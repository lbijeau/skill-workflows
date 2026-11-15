#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { manifestState, loadRegistry } from "./workflows.mjs";
import { syncGlobalSkills, syncClaudeSkills, GLOBAL_SKILL_HEADER } from "./sync.mjs";
import { writeVibeOrchestrator, GENERATED_MARKER, VIBE_ORCHESTRATOR_NAME } from "./generate.mjs";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The Vibe mode lands in skill-router's agents-vibe/ directory (ADR-011's
// council ruling: it is the only agent_paths entry the user's Vibe config
// has). A missing checkout is a skip-with-message, never a hard error — and
// the directory is never created here.
export const DEFAULT_VIBE_ROOT = () => path.join(os.homedir(), "repositories", "skill-router");

const DEFAULT_PI_SKILLS = () => path.join(os.homedir(), ".pi/agent/skills");
const DEFAULT_CLAUDE_SKILLS = () => {
  if (process.env.CLAUDE_CONFIG_DIR) return path.join(process.env.CLAUDE_CONFIG_DIR, "skills");
  return path.join(os.homedir(), ".claude", "skills");
};

// `paths` = { skillsHome, claudeSkillsHome, vibeRoot }. A custom root (tests)
// must pass all three explicitly — the defaults write the real user homes.
function flowPaths(paths) {
  if (paths === null || typeof paths !== "object" || Array.isArray(paths)) {
    throw new TypeError("runInstall/runUpdate take (root, { skillsHome, claudeSkillsHome, vibeRoot })");
  }
  return {
    skillsHome: paths.skillsHome ?? DEFAULT_PI_SKILLS(),
    claudeSkillsHome: paths.claudeSkillsHome ?? DEFAULT_CLAUDE_SKILLS(),
    vibeRoot: paths.vibeRoot ?? DEFAULT_VIBE_ROOT(),
  };
}

// install and update are the same flow: overwrite the run-workflow skills
// this repo owns, refresh the sibling manifest + registry copies, and
// regenerate the Vibe orchestrator mode in skill-router's checkout.
function runFlow(root, paths) {
  const { skillsHome, claudeSkillsHome, vibeRoot } = flowPaths(paths);
  const report = [];
  const wfState = manifestState(root);
  if (!wfState.valid) {
    report.push(`workflows.json: skipped (${wfState.error})`);
  }
  const pi = syncGlobalSkills(root, skillsHome, wfState);
  for (const f of pi.written) report.push(`pi skill: ${path.basename(path.dirname(f))} synced to ${path.dirname(f)}`);
  for (const name of pi.refused) report.push(`pi skill: ${name} refused (user-owned destination, left alone)`);
  const claude = syncClaudeSkills(root, claudeSkillsHome, wfState);
  for (const name of claude.written) report.push(`claude skill: ${name} synced to ${path.join(claudeSkillsHome, name)}`);
  for (const name of claude.refused) report.push(`claude skill: ${name} refused (user-owned destination, left alone)`);
  if (fs.existsSync(vibeRoot)) {
    const orch = writeVibeOrchestrator(vibeRoot, wfState);
    report.push(`vibe orchestrator mode: ${orch.written ? "written" : orch.removed ? "removed" : orch.skippedUserFile ? "skipped (user-authored file present, left alone)" : "skipped"}`);
  } else {
    report.push(`vibe orchestrator mode: skipped (skill-router checkout not found at ${vibeRoot})`);
  }
  report.push("reminder: run /reload (or restart your agent) to pick up the updated skills");
  return { exitCode: 0, report };
}

export function runInstall(root, paths = {}) { return runFlow(root, paths); }
export function runUpdate(root, paths = {}) { return runFlow(root, paths); }

// Read-only: is the run-workflow skill (with its sibling manifest + registry
// copies) present at the given skills home? "installed" | "incomplete" |
// "missing" | "refused" (a user-owned file install will not touch).
function runnerState(root, skillsHome) {
  const dir = path.join(skillsHome, "run-workflow");
  const skill = path.join(dir, "SKILL.md");
  if (!fs.existsSync(skill)) return "missing";
  let content;
  try { content = fs.readFileSync(skill, "utf8"); } catch { return "refused"; }
  const owned = content.split("\n").some(l => l.startsWith(GLOBAL_SKILL_HEADER));
  if (!owned) return "refused";
  const copies = ["workflows.json", "agents.json"].every(f => fs.existsSync(path.join(dir, f)));
  if (!copies) return "incomplete";
  const state = manifestState(root);
  if (!state.valid) return "incomplete";
  const expected = f => fs.readFileSync(path.join(root, f), "utf8");
  const inSync = ["workflows.json", "agents.json"].every(f => {
    try { return fs.readFileSync(path.join(dir, f), "utf8") === expected(f); } catch { return false; }
  });
  return inSync ? "installed" : "stale";
}

// Read-only status report: workflows count, registry count, runner presence
// per harness, Vibe mode presence, manifest validity. Never writes.
export function statusOf(root, paths = {}) {
  const { skillsHome, claudeSkillsHome, vibeRoot } = flowPaths(paths);
  const state = manifestState(root);
  let registry = 0;
  let registryError;
  try { registry = loadRegistry(root).agents.length; }
  catch (e) { registryError = e.message; }
  let vibeMode = "no skill-router checkout";
  if (fs.existsSync(vibeRoot)) {
    const file = path.join(vibeRoot, "agents-vibe", `${VIBE_ORCHESTRATOR_NAME}.toml`);
    if (fs.existsSync(file)) {
      const head = fs.readFileSync(file, "utf8").split("\n", 5).join("\n");
      vibeMode = head.includes(GENERATED_MARKER) ? "present" : "user-authored";
    } else {
      vibeMode = "absent";
    }
  }
  return {
    workflows: state.workflows.length,
    manifestValid: state.valid,
    manifestError: state.valid ? undefined : state.error,
    registry,
    registryError,
    piRunner: runnerState(root, skillsHome),
    claudeRunner: runnerState(root, claudeSkillsHome),
    vibeMode,
  };
}

export function printStatus(st) {
  const lines = [
    `workflows: ${st.manifestValid ? st.workflows : `error (${st.manifestError})`}`,
    `registry: ${st.registryError ? `error (${st.registryError})` : `${st.registry} agents`}`,
    `pi runner: ${st.piRunner}`,
    `claude runner: ${st.claudeRunner}`,
    `vibe orchestrator mode: ${st.vibeMode}`,
  ];
  return lines.join("\n");
}

// The CLI as a function so it can be tested against a temp root and temp
// homes; `opts` = { root, skillsHome, claudeSkillsHome, vibeRoot }.
export function runCli(argv, env, opts = {}) {
  const root = opts.root ?? REPO_ROOT;
  const cmd = argv[0];
  const out = [], err = [];
  const custom = opts.root !== undefined;
  const paths = { skillsHome: opts.skillsHome, claudeSkillsHome: opts.claudeSkillsHome, vibeRoot: opts.vibeRoot };
  try {
    if (cmd === "status") {
      out.push(printStatus(statusOf(root, paths)));
      return { exitCode: 0, out, err };
    }
    if (cmd === "install" || cmd === "update") {
      // A custom root (tests) must not fall back to the real user homes.
      if (custom && !(paths.skillsHome && paths.claudeSkillsHome && paths.vibeRoot !== undefined)) {
        err.push("runCli: a custom root needs explicit skillsHome, claudeSkillsHome and vibeRoot (it would otherwise write the real user homes)");
        return { exitCode: 1, out, err };
      }
      const run = cmd === "install" ? runInstall : runUpdate;
      const r = run(root, paths);
      out.push(...r.report);
      return { exitCode: r.exitCode, out, err };
    }
  } catch (e) {
    err.push(e.message);
    return { exitCode: 1, out, err };
  }
  err.push("usage: install.mjs <install|update|status>");
  return { exitCode: 1, out, err };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const r = runCli(process.argv.slice(2), process.env);
  for (const line of r.out) console.log(line);
  for (const line of r.err) console.error(line);
  process.exit(r.exitCode);
}
