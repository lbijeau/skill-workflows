import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { atomicWrite } from "./common.mjs";
import { manifestState } from "./workflows.mjs";

export const GLOBAL_SKILL_MARKER = "overwritten by skill-workflows install/update";

export const GLOBAL_SKILL_HEADER = "<!-- Generated-style boilerplate; " + GLOBAL_SKILL_MARKER;

// The predecessor: skill-router shipped the run-workflow skills before the
// ADR-011 extraction, with its own boilerplate marker at the same paths.
// Those files are install-owned (not user-authored): this repo's installer
// takes them over — same paths, same names, no stale double-install.
export const PREDECESSOR_SKILL_HEADER = "<!-- Generated-style boilerplate; overwritten by skill-router install/update";

export function isSymlink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

// Owned only if the boilerplate comment is the first thing after the
// frontmatter; a user's file that merely mentions the phrase is not.
function isOwnedSkillContent(content) {
  const lines = content.split("\n");
  if (lines[0] !== "---") return false;
  const end = lines.indexOf("---", 1);
  if (end < 0) return false;
  const first = lines.slice(end + 1).find(l => l.trim() !== "");
  return first !== undefined
    && (first.startsWith(GLOBAL_SKILL_HEADER) || first.startsWith(PREDECESSOR_SKILL_HEADER));
}

// "absent" | "current" | "outdated" | "refused". Never overwrites a user's own
// file: only absent files or files carrying the generated-boilerplate marker
// are ours; symlinks and unreadable destinations are refused. Shared by both
// sync functions so they cannot disagree.
function skillDestStatus(skillsHome, src) {
  const dir = path.join(skillsHome, src.name);
  const dest = path.join(dir, "SKILL.md");
  if (isSymlink(dir) || isSymlink(dest)) return "refused";
  if (!fs.existsSync(dest)) return "absent";
  let cur;
  try { cur = fs.readFileSync(dest, "utf8"); } catch { return "refused"; }
  if (!isOwnedSkillContent(cur)) return "refused";
  return cur === src.content ? "current" : "outdated";
}

function skillSources(root, srcDirName) {
  const srcDir = path.join(root, srcDirName);
  if (!fs.existsSync(srcDir)) return [];
  const out = [];
  for (const d of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const file = path.join(srcDir, d.name, "SKILL.md");
    if (d.isDirectory() && fs.existsSync(file)) {
      out.push({ name: d.name, content: fs.readFileSync(file, "utf8") });
    }
  }
  return out;
}

// The run-workflow skill reads the workflows.json (and consults the
// agents.json registry copy) that sit next to its own SKILL.md: copy both
// repo-root files into the installed dir, but only when the run-workflow
// skill itself is ours (not refused). Absent manifest = nothing to copy;
// install must not break. A malformed manifest is also skipped — and a
// previously installed copy is pruned, so the skill never executes a
// manifest the repo no longer endorses. `state.valid` already implies the
// registry is loadable (loadWorkflows validates it via loadRegistry), so
// the pair copies or prunes together, never one without the other.
function syncManifestAndRegistry(root, destDir, state) {
  const manifestOk = state.valid && fs.existsSync(path.join(root, "workflows.json"));
  for (const name of ["workflows.json", "agents.json"]) {
    const dest = path.join(destDir, name);
    if (manifestOk) {
      fs.mkdirSync(destDir, { recursive: true });
      atomicWrite(dest, fs.readFileSync(path.join(root, name), "utf8"));
    } else if (fs.existsSync(dest) && !isSymlink(destDir) && !isSymlink(dest)) {
      fs.rmSync(dest);
    }
  }
}

// Global skills live committed under global-skills/<name>/SKILL.md and are
// synced into the pi skills home on every install/update. The copy step is
// marker-guarded (the PR #26 fix): a user-authored file at the install path
// is never clobbered on the write path, and a refused skill's sibling
// copies are never pruned on the prune path — only reported.
export function syncGlobalSkills(root, skillsHome, wfState) {
  const home = skillsHome ?? path.join(os.homedir(), ".pi/agent/skills");
  const srcDir = path.join(root, "global-skills");
  const written = [];
  const refused = [];
  let skipped = 0;
  if (!fs.existsSync(srcDir)) return { written, skipped, refused };
  for (const d of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (!d.isDirectory()) { skipped++; continue; }
    const src = path.join(srcDir, d.name, "SKILL.md");
    if (!fs.existsSync(src)) { skipped++; continue; }
    const status = skillDestStatus(home, { name: d.name, content: fs.readFileSync(src, "utf8") });
    if (status === "refused") { refused.push(d.name); continue; }
    const dest = path.join(home, d.name, "SKILL.md");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, fs.readFileSync(src));
    written.push(dest);
  }
  const state = wfState ?? manifestState(root);
  if (fs.existsSync(path.join(srcDir, "run-workflow", "SKILL.md"))
    && !refused.includes("run-workflow")) {
    syncManifestAndRegistry(root, path.join(home, "run-workflow"), state);
  }
  return { written, skipped, refused };
}

// Claude Code twin: same ownership contract (refused, never overwritten),
// same manifest + registry copy guards. Sources come from
// global-skills-claude/<name>/SKILL.md.
export function syncClaudeSkills(root, skillsHome, wfState) {
  const written = [], refused = [];
  const existed = fs.existsSync(skillsHome);
  const sources = skillSources(root, "global-skills-claude");
  for (const src of sources) {
    const st = skillDestStatus(skillsHome, src);
    if (st === "refused") { refused.push(src.name); continue; }
    if (st === "current") continue;
    const dir = path.join(skillsHome, src.name);
    fs.mkdirSync(dir, { recursive: true });
    atomicWrite(path.join(dir, "SKILL.md"), src.content);
    written.push(src.name);
  }
  const state = wfState ?? manifestState(root);
  const runWorkflow = sources.find(s => s.name === "run-workflow");
  if (runWorkflow && !refused.includes("run-workflow")) {
    syncManifestAndRegistry(root, path.join(skillsHome, "run-workflow"), state);
  }
  return { written, refused, dirCreated: !existed && fs.existsSync(skillsHome) };
}
