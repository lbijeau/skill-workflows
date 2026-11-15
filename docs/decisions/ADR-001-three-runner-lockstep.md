# ADR-001: The three-runner lockstep contract

Date: 2026-11-14

## Status

Accepted. Restates the contract from skill-router's ADR-009 and ADR-010,
which migrated here with the module per skill-router's ADR-011.

## Context

A workflow runs on three harnesses: pi and Claude Code via an installed
`run-workflow` skill, and Vibe via a generated `workflow-orchestrator`
mode TOML (Vibe agents get `disabled_tools = ["skill"]`, so a skill
cannot be the runner there — skill-router ADR-010). Three runners for
one contract is three chances to drift.

## Decision

The three runners implement **one contract**, verbatim:

- Dispatch each step's agent, in order, by **name** (pi subagent, Claude
  Task, Vibe spawn `config_name`). Never guess a substitute agent; on
  failure, stop and report.
- Verify each step's output file exists and is non-empty before moving
  on (the orchestrator writes the file itself on Vibe; on pi/Claude the
  step agent writes it).
- One human checkpoint between steps: report the step's result and
  confirm whether to continue.
- Resume: skip any step whose output file already exists and is
  non-empty.

**Lockstep duty:** a change to any runner's behavior is a change to all
three, landed as one commit covering all three runner artifacts plus the
README; reviews must check them together.

**Known divergence (accepted, from skill-router ADR-010):** the pi and
Claude runners read `workflows.json` (the sibling copy installed beside
the skill) at runtime, while the Vibe mode bakes the workflow list in at
generation time. A workflow edit between installs means Vibe runs the old
contract until the next `install`/`update`. This drift window is
accepted rather than papered over; `./install.sh status` surfaces the
mode's presence (and the install report its regeneration) so the drift is
visible, not silent.

## Consequences

- The runners must be reviewed together; a behavior change to one
  without the others is a review blocker.
- The zero-harness-agent case: a step naming an agent registered for no
  harness (or missing from the harness's agent dir) is valid at
  generation — the registry only checks names — and fails at dispatch
  with the runner's stop-and-report. Accepted; the README states it.
- The Vibe drift window cannot be closed in v1 (no runtime manifest
  discovery exists on Vibe); it shrinks with every install/update.
