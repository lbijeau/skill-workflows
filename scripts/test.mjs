#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import * as wf from "./workflows.mjs";

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
