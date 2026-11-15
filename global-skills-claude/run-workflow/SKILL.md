---
name: run-workflow
description: Run a named skill-workflows workflow step by step, dispatching each step's agent and checkpointing with the user between steps
---

<!-- Generated-style boilerplate; overwritten by skill-workflows install/update.
Put custom behavior in your own CLAUDE.md or say it in the invocation. -->

The user names a workflow (or asks to list them). Run it as follows:

1. Read the `workflows.json` sitting next to this SKILL.md. If it is
   absent, say so and stop. Its sibling `agents.json` is the agent
   registry: it documents each step agent's installed locations for
   reference — dispatch is by agent name, and registry paths are
   provenance documentation, never something to check at runtime.
2. If the user asked to list workflows, list each one's name and
   description and stop. Otherwise confirm the target workflow with
   the user before starting.
3. For each step in order: dispatch the step's agent with the Task tool,
   passing the step's `task` text and telling it to write the
   step's `output` file. If the named agent is not installed, report
   that and stop — do not guess a substitute.
4. After each step: verify the output file exists and is non-empty. If
   it is not, report the failed step and stop — earlier outputs stay
   untouched.
5. **Checkpoint:** after every step, report the output file to the user
   and wait for their go-ahead before the next step. Never run two
   steps without a human between them.
6. When all steps are done, list the outputs and stop.
7. **Resume:** if the user asks to continue or rerun a workflow, skip
   any step whose output file already exists and is non-empty; start
   from the first step that fails that check.
