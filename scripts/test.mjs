#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import * as wf from "./workflows.mjs";
import * as sync from "./sync.mjs";
import * as gen from "./generate.mjs";

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function eq(a, e, msg) { msg === undefined ? assert.strictEqual(a, e) : assert.strictEqual(a, e, msg); }
const liveTmpDirs = new Set();
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swf-"));
  liveTmpDirs.add(dir);
  return dir;
}
function w(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function clean(dir) { fs.rmSync(dir, { recursive: true, force: true }); liveTmpDirs.delete(dir); }

function regRoot(agents) {
  const root = tmp();
  w(root, "agents.json", JSON.stringify({ agents }));
  return root;
}

const A = (over = {}) => ({ name: "a", description: "agent a", ...over });

// --- loadRegistry ---

test("loadRegistry returns a valid registry", () => {
  const root = regRoot([
    { name: "a", description: "agent a", pi: "~/agents/a.md", claude: "~/.claude/agents/a.md" },
    { name: "b", description: "agent b" },
  ]);
  const { agents } = wf.loadRegistry(root);
  eq(agents.length, 2);
  eq(agents[0].name, "a");
  eq(agents[1].pi, undefined);
  clean(root);
});

test("loadRegistry rejects a missing or non-array agents field", () => {
  {
    const root = tmp();
    assert.throws(() => wf.loadRegistry(root), /cannot read/);
    clean(root);
  }
  {
    const root = tmp();
    w(root, "agents.json", JSON.stringify({ agents: "nope" }));
    assert.throws(() => wf.loadRegistry(root), /agents must be an array/);
    clean(root);
  }
});

test("loadRegistry rejects invalid agent names", () => {
  for (const bad of ["Bad_Name", "-x", "x-", "a--b", "a b"]) {
    const root = regRoot([A({ name: bad })]);
    assert.throws(() => wf.loadRegistry(root), /invalid agent name/);
    clean(root);
  }
});

test("loadRegistry rejects duplicate agent names", () => {
  const root = regRoot([A(), A({ description: "again" })]);
  assert.throws(() => wf.loadRegistry(root), /duplicate agent name: a/);
  clean(root);
});

test("loadRegistry rejects non-string or empty path fields", () => {
  for (const field of ["pi", "claude", "vibe"]) {
    {
      const root = regRoot([A({ [field]: "" })]);
      assert.throws(() => wf.loadRegistry(root), new RegExp(`agent "a": ${field} must be a non-empty string`));
      clean(root);
    }
    {
      const root = regRoot([A({ [field]: 42 })]);
      assert.throws(() => wf.loadRegistry(root), new RegExp(`agent "a": ${field} must be a non-empty string`));
      clean(root);
    }
  }
});

// --- loadWorkflows (ported from skill-router, repos.json → agents.json) ---

test("loadWorkflows returns [] when workflows.json is absent", () => {
  const root = regRoot([A()]);
  const { workflows } = wf.loadWorkflows(root);
  eq(workflows.length, 0);
  clean(root);
});

test("loadWorkflows returns a valid workflow with steps", () => {
  const root = regRoot([A(), A({ name: "b", description: "agent b" })]);
  w(root, "workflows.json", JSON.stringify({ workflows: [
    { name: "review", description: "Two-pass review",
      steps: [
        { agent: "a", task: "Review the code", output: "docs/review-a.md" },
        { agent: "b", task: "Audit the review", output: "docs/review-b.md" } ] } ] }));
  const { workflows } = wf.loadWorkflows(root);
  eq(workflows.length, 1);
  eq(workflows[0].name, "review");
  eq(workflows[0].steps[1].agent, "b");
  clean(root);
});

test("loadWorkflows rejects unknown agent names", () => {
  const root = regRoot([A()]);
  w(root, "workflows.json", JSON.stringify({ workflows: [
    { name: "review", description: "Two-pass review",
      steps: [ { agent: "zzz", task: "Review the code", output: "docs/review-a.md" } ] } ] }));
  assert.throws(() => wf.loadWorkflows(root), /review/);
  assert.throws(() => wf.loadWorkflows(root), /zzz/);
  clean(root);
});

test("loadWorkflows rejects empty steps, missing fields, bad names", () => {
  const agents = [A()];
  {
    const root = regRoot(agents);
    w(root, "workflows.json", JSON.stringify({ workflows: [
      { name: "review", description: "Two-pass review", steps: [] } ] }));
    assert.throws(() => wf.loadWorkflows(root), /review/);
    clean(root);
  }
  {
    const root = regRoot(agents);
    w(root, "workflows.json", JSON.stringify({ workflows: [
      { name: "review", description: "Two-pass review",
        steps: [ { agent: "a", task: "Review the code" } ] } ] }));
    assert.throws(() => wf.loadWorkflows(root), /review/);
    clean(root);
  }
  {
    const root = regRoot(agents);
    w(root, "workflows.json", JSON.stringify({ workflows: [
      { name: "Bad_Name", description: "Two-pass review",
        steps: [ { agent: "a", task: "Review the code", output: "docs/out.md" } ] } ] }));
    assert.throws(() => wf.loadWorkflows(root), /Bad_Name/);
    clean(root);
  }
});

test("loadWorkflows rejects duplicate workflow names", () => {
  const root = regRoot([A()]);
  const entry = {
    name: "review", description: "Two-pass review",
    steps: [ { agent: "a", task: "Review the code", output: "docs/out.md" } ] };
  w(root, "workflows.json", JSON.stringify({ workflows: [entry, entry] }));
  assert.throws(() => wf.loadWorkflows(root), /review/);
  assert.throws(() => wf.loadWorkflows(root), /duplicate/);
  clean(root);
});

test("loadWorkflows rejects escaping output paths", () => {
  const agents = [A()];
  for (const output of ["../outside.md", "/abs.md", "..\\outside.md"]) {
    const root = regRoot(agents);
    w(root, "workflows.json", JSON.stringify({ workflows: [
      { name: "review", description: "Two-pass review",
        steps: [ { agent: "a", task: "Review the code", output } ] } ] }));
    assert.throws(() => wf.loadWorkflows(root), /review/, `output: ${output}`);
    clean(root);
  }
});

test("loadWorkflows rejects duplicate output paths within a workflow", () => {
  const root = regRoot([A(), A({ name: "b", description: "agent b" })]);
  w(root, "workflows.json", JSON.stringify({ workflows: [
    { name: "review", description: "Two-pass review",
      steps: [
        { agent: "a", task: "Review the code", output: "docs/out.md" },
        { agent: "b", task: "Audit the review", output: "docs/out.md" } ] } ] }));
  assert.throws(() => wf.loadWorkflows(root), /review/);
  assert.throws(() => wf.loadWorkflows(root), /docs\/out\.md/);
  clean(root);
});

// --- manifestState ---

test("manifestState reports valid workflows and load errors", () => {
  {
    const root = regRoot([A()]);
    w(root, "workflows.json", JSON.stringify({ workflows: [
      { name: "review", description: "Two-pass review",
        steps: [ { agent: "a", task: "Review the code", output: "docs/out.md" } ] } ] }));
    const s = wf.manifestState(root);
    eq(s.valid, true);
    eq(s.workflows.length, 1);
    clean(root);
  }
  {
    const root = regRoot([A()]);
    w(root, "workflows.json", JSON.stringify({ workflows: [
      { name: "review", description: "Two-pass review",
        steps: [ { agent: "zzz", task: "Review the code", output: "docs/out.md" } ] } ] }));
    const s = wf.manifestState(root);
    eq(s.valid, false);
    eq(s.workflows.length, 0);
    assert.match(s.error, /zzz/);
    clean(root);
  }
});

// --- sync: runner skills + registry resolution (ported from skill-router) ---

const OWNED = (body = "body\n") =>
  `---\nname: run-workflow\ndescription: d\n---\n${sync.GLOBAL_SKILL_HEADER} -->\n${body}`;

const EMPTY_MANIFEST = JSON.stringify({ workflows: [] });
const BAD_MANIFEST = JSON.stringify({ workflows: "not-an-array" });

function syncRoot({ claude = false, manifest = EMPTY_MANIFEST, agents = [] } = {}) {
  const root = tmp();
  w(root, "agents.json", JSON.stringify({ agents }));
  if (manifest !== null) w(root, "workflows.json", manifest);
  w(root, claude ? "global-skills-claude/run-workflow/SKILL.md" : "global-skills/run-workflow/SKILL.md", OWNED());
  return root;
}

const rwFiles = (home) => ["workflows.json", "agents.json"].map(f => path.join(home, "run-workflow", f));

// --- syncGlobalSkills (pi) ---

test("syncGlobalSkills: copies byte-identical, idempotent, skips non-skills", () => {
  const root = tmp(); const skillsHome = tmp();
  w(root, "agents.json", JSON.stringify({ agents: [] }));
  w(root, "global-skills/route-skill/SKILL.md", OWNED("route\n"));
  w(root, "global-skills/stray/readme.txt", "not a skill");
  const r1 = sync.syncGlobalSkills(root, skillsHome);
  eq(r1.written.length, 1);
  eq(r1.skipped, 1);
  const dest = path.join(skillsHome, "route-skill", "SKILL.md");
  eq(fs.existsSync(dest), true);
  eq(fs.readFileSync(dest, "utf8"), fs.readFileSync(path.join(root, "global-skills/route-skill/SKILL.md"), "utf8"));
  const r2 = sync.syncGlobalSkills(root, skillsHome);
  eq(r2.written.length, 1);
  eq(fs.readFileSync(dest, "utf8"), fs.readFileSync(path.join(root, "global-skills/route-skill/SKILL.md"), "utf8"));
  clean(root); clean(skillsHome);
});

test("syncGlobalSkills returns empty when global-skills/ is absent", () => {
  const root = tmp(); const skillsHome = tmp();
  w(root, "agents.json", JSON.stringify({ agents: [] }));
  const r = sync.syncGlobalSkills(root, skillsHome);
  eq(r.written.length, 0);
  eq(r.skipped, 0);
  eq(fs.existsSync(skillsHome) ? fs.readdirSync(skillsHome).length : 0, 0);
  clean(root); clean(skillsHome);
});

test("syncGlobalSkills copies workflows.json AND agents.json beside the installed run-workflow skill", () => {
  const root = syncRoot(); const skillsHome = tmp();
  const r = sync.syncGlobalSkills(root, skillsHome);
  eq(r.written.filter(f => f.includes("run-workflow")).length, 1);
  const [wfJson, regJson] = rwFiles(skillsHome);
  eq(fs.readFileSync(wfJson, "utf8"), EMPTY_MANIFEST);
  eq(fs.readFileSync(regJson, "utf8"), JSON.stringify({ agents: [] }));
  clean(root); clean(skillsHome);
});

test("syncGlobalSkills skips the copies silently when workflows.json is absent", () => {
  const root = syncRoot({ manifest: null }); const skillsHome = tmp();
  const r = sync.syncGlobalSkills(root, skillsHome);
  eq(r.written.length, 1);
  for (const f of rwFiles(skillsHome)) eq(fs.existsSync(f), false);
  clean(root); clean(skillsHome);
});

test("syncGlobalSkills does not copy a malformed workflows.json (or the registry) into the installed dir", () => {
  const root = syncRoot({ manifest: BAD_MANIFEST }); const skillsHome = tmp();
  sync.syncGlobalSkills(root, skillsHome);
  for (const f of rwFiles(skillsHome)) eq(fs.existsSync(f), false, f);
  clean(root); clean(skillsHome);
});

test("syncGlobalSkills prunes stale installed copies when the repo manifest goes bad", () => {
  const root = syncRoot(); const skillsHome = tmp();
  sync.syncGlobalSkills(root, skillsHome);
  for (const f of rwFiles(skillsHome)) eq(fs.existsSync(f), true, f);
  // Repo manifest goes malformed: the stale installed copies must be pruned.
  w(root, "workflows.json", BAD_MANIFEST);
  sync.syncGlobalSkills(root, skillsHome);
  for (const f of rwFiles(skillsHome)) eq(fs.existsSync(f), false, f);
  // And when it is valid again.
  w(root, "workflows.json", EMPTY_MANIFEST);
  sync.syncGlobalSkills(root, skillsHome);
  for (const f of rwFiles(skillsHome)) eq(fs.existsSync(f), true, f);
  // And when it is removed entirely.
  fs.rmSync(path.join(root, "workflows.json"));
  sync.syncGlobalSkills(root, skillsHome);
  for (const f of rwFiles(skillsHome)) eq(fs.existsSync(f), false, f);
  clean(root); clean(skillsHome);
});

test("syncGlobalSkills never touches a user-authored installed skill (write and prune paths)", () => {
  const root = syncRoot(); const skillsHome = tmp();
  sync.syncGlobalSkills(root, skillsHome);
  const dest = path.join(skillsHome, "run-workflow", "SKILL.md");
  fs.writeFileSync(dest, "my own skill\n");
  w(root, "workflows.json", BAD_MANIFEST);
  const r = sync.syncGlobalSkills(root, skillsHome);
  eq(r.refused.join(), "run-workflow");
  eq(fs.readFileSync(dest, "utf8"), "my own skill\n");
  // The PR #26 guard covers the prune path too: the user-owned dir's
  // sibling copies are not pruned when the skill is refused.
  for (const f of rwFiles(skillsHome)) eq(fs.existsSync(f), true, f);
  clean(root); clean(skillsHome);
});

test("syncGlobalSkills refuses a symlinked destination and leaves it alone", () => {
  const root = syncRoot(); const parent = tmp(); const skillsHome = path.join(parent, "skills");
  w(parent, "elsewhere/SKILL.md", "someone else's\n");
  fs.mkdirSync(path.join(skillsHome, "run-workflow"), { recursive: true });
  fs.symlinkSync(path.join(parent, "elsewhere/SKILL.md"), path.join(skillsHome, "run-workflow", "SKILL.md"));
  const r = sync.syncGlobalSkills(root, skillsHome);
  eq(r.refused.join(), "run-workflow");
  eq(fs.lstatSync(path.join(skillsHome, "run-workflow", "SKILL.md")).isSymbolicLink(), true);
  clean(root); clean(parent);
});

// --- syncClaudeSkills (Claude Code) ---

test("syncClaudeSkills: writes the skill, is idempotent, refuses unmarked and symlinked files, reports dirCreated", () => {
  const root = syncRoot({ claude: true }); const home = path.join(tmp(), "skills");
  const src = fs.readFileSync(path.join(root, "global-skills-claude/run-workflow/SKILL.md"), "utf8");
  const r1 = sync.syncClaudeSkills(root, home);
  eq(r1.written.join(), "run-workflow"); eq(r1.dirCreated, true);
  eq(fs.readFileSync(path.join(home, "run-workflow/SKILL.md"), "utf8"), src);
  eq(sync.syncClaudeSkills(root, home).dirCreated, false);
  eq(sync.syncClaudeSkills(root, home).written.length, 0);
  fs.writeFileSync(path.join(home, "run-workflow/SKILL.md"), "my own skill\n");
  const r2 = sync.syncClaudeSkills(root, home);
  eq(r2.refused.join(), "run-workflow"); eq(r2.written.length, 0);
  eq(fs.readFileSync(path.join(home, "run-workflow/SKILL.md"), "utf8"), "my own skill\n");
  fs.rmSync(path.join(home, "run-workflow/SKILL.md"));
  w(path.dirname(home), "elsewhere/SKILL.md", src);
  fs.symlinkSync(path.join(path.dirname(home), "elsewhere/SKILL.md"), path.join(home, "run-workflow/SKILL.md"));
  const r3 = sync.syncClaudeSkills(root, home);
  eq(r3.refused.join(), "run-workflow");
  eq(fs.lstatSync(path.join(home, "run-workflow/SKILL.md")).isSymbolicLink(), true);
  clean(root); clean(path.dirname(home));
});

test("syncClaudeSkills copies workflows.json AND agents.json beside the installed skill", () => {
  const root = syncRoot({ claude: true }); const home = path.join(tmp(), "skills");
  const r = sync.syncClaudeSkills(root, home);
  eq(r.written.includes("run-workflow"), true);
  const [wfJson, regJson] = rwFiles(home);
  eq(fs.readFileSync(wfJson, "utf8"), EMPTY_MANIFEST);
  eq(fs.readFileSync(regJson, "utf8"), JSON.stringify({ agents: [] }));
  clean(root); clean(path.dirname(home));
});

test("syncClaudeSkills does not copy a malformed workflows.json (or the registry) into the installed dir", () => {
  const root = syncRoot({ claude: true, manifest: BAD_MANIFEST }); const home = path.join(tmp(), "skills");
  sync.syncClaudeSkills(root, home);
  for (const f of rwFiles(home)) eq(fs.existsSync(f), false, f);
  clean(root); clean(path.dirname(home));
});

test("syncClaudeSkills prunes stale installed copies when the repo manifest goes bad", () => {
  const root = syncRoot({ claude: true }); const home = path.join(tmp(), "skills");
  sync.syncClaudeSkills(root, home);
  for (const f of rwFiles(home)) eq(fs.existsSync(f), true, f);
  w(root, "workflows.json", BAD_MANIFEST);
  sync.syncClaudeSkills(root, home);
  for (const f of rwFiles(home)) eq(fs.existsSync(f), false, f);
  w(root, "workflows.json", EMPTY_MANIFEST);
  sync.syncClaudeSkills(root, home);
  for (const f of rwFiles(home)) eq(fs.existsSync(f), true, f);
  fs.rmSync(path.join(root, "workflows.json"));
  sync.syncClaudeSkills(root, home);
  for (const f of rwFiles(home)) eq(fs.existsSync(f), false, f);
  clean(root); clean(path.dirname(home));
});

test("syncClaudeSkills never touches a user-authored skill's sibling copies (prune path)", () => {
  const root = syncRoot({ claude: true }); const home = path.join(tmp(), "skills");
  sync.syncClaudeSkills(root, home);
  fs.writeFileSync(path.join(home, "run-workflow/SKILL.md"), "my own skill\n");
  w(root, "workflows.json", BAD_MANIFEST);
  const r = sync.syncClaudeSkills(root, home);
  eq(r.refused.join(), "run-workflow");
  eq(fs.readFileSync(path.join(home, "run-workflow/SKILL.md"), "utf8"), "my own skill\n");
  for (const f of rwFiles(home)) eq(fs.existsSync(f), true, f);
  clean(root); clean(path.dirname(home));
});

// --- committed runner skill bodies ---

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

test("pi run-workflow SKILL.md names the manifest, registry copy, subagent tool, and checkpoint rule", () => {
  const body = fs.readFileSync(path.join(REPO_ROOT, "global-skills/run-workflow/SKILL.md"), "utf8");
  assert(/workflows\.json/.test(body));
  assert(/agents\.json/.test(body));
  assert(/subagent/.test(body));
  assert(/checkpoint/i.test(body));
  // Registry paths are provenance docs: the skill must not tell the runner to
  // verify them at runtime.
  assert(!/verify.{0,40}(path|registry)/is.test(body), "must not instruct runtime path verification");
});

test("claude run-workflow SKILL.md names the manifest, registry copy, Task tool, and checkpoint rule", () => {
  const body = fs.readFileSync(path.join(REPO_ROOT, "global-skills-claude/run-workflow/SKILL.md"), "utf8");
  assert(/workflows\.json/.test(body));
  assert(/agents\.json/.test(body));
  assert(/Task tool/.test(body));
  assert(/checkpoint/i.test(body));
  assert(!/verify.{0,40}(path|registry)/is.test(body), "must not instruct runtime path verification");
});

test("committed skills sync byte-identically with both committed JSON files", () => {
  for (const [fn, srcDir] of [[sync.syncGlobalSkills, "global-skills"], [sync.syncClaudeSkills, "global-skills-claude"]]) {
    const home = path.join(tmp(), "skills");
    fn(REPO_ROOT, home);
    eq(fs.readFileSync(path.join(home, "run-workflow", "SKILL.md"), "utf8"),
      fs.readFileSync(path.join(REPO_ROOT, srcDir, "run-workflow", "SKILL.md"), "utf8"));
    eq(fs.readFileSync(path.join(home, "run-workflow", "workflows.json"), "utf8"),
      fs.readFileSync(path.join(REPO_ROOT, "workflows.json"), "utf8"));
    eq(fs.readFileSync(path.join(home, "run-workflow", "agents.json"), "utf8"),
      fs.readFileSync(path.join(REPO_ROOT, "agents.json"), "utf8"));
    clean(path.dirname(home));
  }
});

// --- generate: Vibe workflow-orchestrator mode (ported from skill-router PR #26) ---

test("renderVibeOrchestratorTOML emits a mode TOML with baked workflows", () => {
  const toml = gen.renderVibeOrchestratorTOML([
    { name: "design-review", description: "d", steps: [
      { agent: "superpowers", task: "Brainstorm the feature", output: "docs/design.md" },
      { agent: "ponytail", task: "Critique it", output: "docs/design-review.md" } ] },
  ]);
  assert(/agent_type = "agent"/.test(toml));
  assert(/disabled_tools = \["skill"\]/.test(toml));
  assert(/ask_user_question/.test(toml) && /task/.test(toml) && /write_file/.test(toml));
  assert(toml.startsWith(gen.GENERATED_MARKER));
  assert(toml.includes("design-review"));
  assert(toml.includes("Brainstorm the feature"));   // task text baked, escaped
  assert(toml.includes("docs/design.md"));
  assert(/checkpoint/i.test(toml));                   // ADR-009 contract in prose
  assert(/already exists and is non-empty/.test(toml)); // resume rule
  // every workflow and step appears; no bare """ breakage from quotes in task text
  const weird = gen.renderVibeOrchestratorTOML([
    { name: "w", description: 'say "hi"', steps: [
      { agent: "a", task: 'write "quoted" text', output: "docs/o.md" } ] }]);
  assert(weird.includes('\\"quoted\\"')); // quotes escaped — no masked regression behind a disjunction
});

test("writeVibeOrchestrator writes the mode for a valid manifest, removes it when the manifest goes bad", () => {
  const root = regRoot([A()]);
  w(root, "workflows.json", JSON.stringify({ workflows: [
    { name: "design-review", description: "two-step review", steps: [
      { agent: "a", task: "write the design", output: "docs/design.md" } ] } ] }));
  const orch = path.join(root, "agents-vibe", "workflow-orchestrator.toml");
  const r1 = gen.writeVibeOrchestrator(root, wf.manifestState(root));
  eq(r1.written, true);
  eq(r1.removed, false);
  const toml = fs.readFileSync(orch, "utf8");
  eq(toml.includes("design-review"), true);
  eq(toml.startsWith(gen.GENERATED_MARKER), true);
  // malformed workflows.json → the generated file is pruned
  w(root, "workflows.json", "{ not json !!!");
  const r2 = gen.writeVibeOrchestrator(root, wf.manifestState(root));
  eq(r2.written, false);
  eq(r2.removed, true);
  eq(fs.existsSync(orch), false);
  // absent workflows.json → still gone, no error
  fs.rmSync(path.join(root, "workflows.json"), { force: true });
  const r3 = gen.writeVibeOrchestrator(root, wf.manifestState(root));
  eq(r3.written, false);
  eq(r3.removed, false);
  eq(fs.existsSync(orch), false);
  clean(root);
});

test("writeVibeOrchestrator never removes a user-authored file", () => {
  const root = tmp();
  const orch = path.join(root, "agents-vibe", "workflow-orchestrator.toml");
  w(root, "agents-vibe/workflow-orchestrator.toml", "hand-written, no marker\n");
  const r = gen.writeVibeOrchestrator(root, wf.manifestState(root)); // no workflows.json
  eq(r.written, false);
  eq(r.removed, false);
  eq(fs.readFileSync(orch, "utf8"), "hand-written, no marker\n");
  clean(root);
});

test("writeVibeOrchestrator never clobbers a user-authored file on the write path", () => {
  const root = regRoot([A()]);
  w(root, "workflows.json", JSON.stringify({ workflows: [
    { name: "w", description: "d", steps: [ { agent: "a", task: "t", output: "docs/o.md" } ] } ] }));
  w(root, "agents-vibe/workflow-orchestrator.toml", "hand-written, no marker\n");
  const r = gen.writeVibeOrchestrator(root, wf.manifestState(root)); // valid manifest
  eq(r.written, false);
  eq(r.skippedUserFile, true);
  eq(fs.readFileSync(path.join(root, "agents-vibe", "workflow-orchestrator.toml"), "utf8"), "hand-written, no marker\n");
  clean(root);
});

// --- repo-root fixtures: the committed workflows.json validates against the committed agents.json ---

test("committed workflows.json validates against committed agents.json", () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const { workflows } = wf.loadWorkflows(root);
  eq(workflows.length, 3);
  const { agents } = wf.loadRegistry(root);
  eq(agents.length, 5);
  for (const wfEntry of workflows) {
    for (const step of wfEntry.steps) {
      assert(agents.some(a => a.name === step.agent), `unknown agent ${step.agent}`);
    }
  }
});

process.exitCode = await (async () => {
  let failed = 0;
  try {
    for (const t of tests) {
      try { await t.fn(); console.log("PASS", t.name); }
      catch (e) { failed++; console.log("FAIL", t.name, "\n  " + e.message); }
    }
  } finally {
    // Safety net: any fixture dir a failing/skipped clean() left behind is removed here.
    for (const dir of liveTmpDirs) clean(dir);
  }
  console.log(failed ? `${failed} test(s) failed` : "all green");
  return failed ? 1 : 0;
})();
