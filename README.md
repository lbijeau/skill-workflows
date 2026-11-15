# skill-workflows

Multi-agent workflow definitions, the agent registry that validates them, and
the three runners that execute them — extracted from
[skill-router](https://github.com/lucbijeau/skill-router) per its ADR-011.

## What and why

skill-router generates one clean-room agent per third-party skills repo, and
ADR-009 gave it a workflow module behind a narrow seam: a `workflows.json`
manifest of named, ordered steps, each naming an agent and an output file.
ADR-009 also named the split trigger — extract when a workflow needs to
compose an agent skill-router did not generate. The trigger fired:
agent-roster's six SDLC stage agents are a second agent source, so per
ADR-011 the module moved here, and skill-router went back to being purely
about skill routing.

This repo owns the workflow spec (name + steps of agent/task/output —
deliberately minimal; no typed handoffs or gate semantics in v1), the
`agents.json` registry the spec validates against, and the three runners
(pi skill, Claude Code skill, Vibe mode). skill-router no longer ships any
of it; if you had the old skill-router-installed `run-workflow` skills,
skill-router's update prunes them and this repo's install re-ships them at
the same paths.

## Quickstart

Requires Node ≥ 18. No dependencies.

```sh
./install.sh install   # or: update — same flow
./install.sh status    # read-only report
```

`install`/`update` (identical) do three things:

1. Sync the `run-workflow` skill to `~/.pi/agent/skills/run-workflow/`
   and `~/.claude/skills/run-workflow/`, each with sibling copies of
   `workflows.json` and `agents.json` (the skill reads them at runtime).
2. Regenerate the Vibe `workflow-orchestrator` mode TOML — see the
   cross-repo contract below.
3. Print a report; a malformed `workflows.json` is a printed warning,
   never a failed install.

The installed `workflows.json`/`agents.json` copies carry a top-level
`"_generated": "skill-workflows"` provenance key (the loaders ignore unknown
top-level keys). The sync prunes an installed copy **only when the key is
present**: remove the key from your installed copy and it is yours — the
prune leaves it alone. A hand-edited copy that still carries the key is
accepted loss on a bad repo manifest.

`status` is read-only: workflows count, registry count, runner presence
per harness, Vibe mode presence, and manifest validity.

## `check` — registry drift check

`./install.sh check` verifies each `agents.json` entry: every present path
field must point at an existing file (tilde-expanded), and where the file
exists its frontmatter `name:` must match the registry entry. Per agent it
reports `ok`, `missing path: <path>` (warning — the paths are provenance
docs), or `drift: registry "X" but file says "Y"`. A rename in a source
repo surfaces here, at check time, not just at dispatch. Exit is non-zero
only on drift.

## `uninstall`

`./install.sh uninstall` removes what skill-workflows owns and nothing
else: the installed `run-workflow` skill dirs (`~/.pi/agent/skills/`,
`~/.claude/skills/`) only if their SKILL.md carries this repo's generated
marker, and the Vibe `workflow-orchestrator.toml` only if it carries this
repo's marker. User-authored files — and files still carrying the
skill-router predecessor's marker, which this repo never installed over —
are refused and reported, never deleted. Each removal or refusal is
printed.

Install never clobbers a user-authored file at a destination path: files
without a generated-boilerplate marker (this repo's or its skill-router
predecessor's) are refused and reported, not overwritten. Files still carrying
skill-router's old install marker are taken over — same paths, same names, no
stale double-install.

## The registry (`agents.json`)

```json
{ "agents": [
  { "name": "superpowers", "description": "…",
    "pi": "~/repositories/skill-router/agents/superpowers.md",
    "claude": "~/.claude/agents/superpowers.md" } ] }
```

- `name` (lowercase kebab-case) is the only field validation depends on:
  every workflow step's agent must exist in the registry, or
  `workflows.json` fails to load with the workflow and agent in the
  message.
- The optional `pi`/`claude`/`vibe` paths are **provenance documentation**
  — where that agent's harness file lives on this machine — not something
  verified at dispatch. A missing or wrong path is a `status` line, never
  an error. (agent-roster's agents, for example, are hand-copied into each
  project; their registry paths document the source repo, not a dispatch
  target.)
- The registry is a **hand-maintained contract** with foreign repos:
  names duplicate agent frontmatter elsewhere with no sync mechanism. A
  rename there breaks at dispatch (stop-and-report), not at install.

## The three runners

| Harness | Runner | Dispatch |
|---|---|---|
| pi | installed `run-workflow` skill | subagent by name |
| Claude Code | installed `run-workflow` skill | Task by agent name |
| Vibe | generated `workflow-orchestrator` mode | `agents.spawn` by `config_name` |

All three implement one contract — dispatch in order, verify each output
file exists and is non-empty, one human checkpoint between steps, resume
by skipping completed outputs, stop-and-report on failure, never guess a
substitute agent — restated as this repo's
[ADR-001](docs/decisions/ADR-001-three-runner-lockstep.md), which carries
the lockstep duty: a behavior change to any runner is a change to all
three, in one commit.

**Known divergence (ADR-001):** pi and Claude read the installed
`workflows.json` at runtime; the Vibe mode bakes the workflow list in at
generation. A workflow edit between installs means Vibe runs the old
contract until the next install/update — `status` surfaces the mode so
the drift is visible.

**Zero-harness-agent caveat:** a step naming an agent registered for zero
harnesses (or absent from a harness's agent dir) is valid at generation —
the registry only checks names — and fails at dispatch with the runner's
stop-and-report. Accepted: the runner contract covers it; the registry's
per-harness fields exist precisely so `status` and humans can see it.

## The feature-line workflow and the per-ticket loop

`feature-line` (requirements → sprint-planning) covers the front of the
agent-roster SDLC line: it turns a brainstorm outcome into a spec, then
into sequenced tickets. The per-ticket **test-authorship →
code-generation loop** that follows in agent-roster's full line is
deliberately out of scope here: it runs once per sequenced ticket, which
is a loop driven by a human dispatcher, not a linear workflow spec. Do
not "fix" this by bloating the spec with loop semantics — dispatch those
stages per ticket with the runner's stop-and-report contract, or drive
them via agent-roster's own `/sdlc-*` commands.

## The cross-repo Vibe contract

Vibe loads agent TOMLs from `agent_paths` — and the user's Vibe config
points only at skill-router's `agents-vibe/`. So this repo writes its
generated `workflow-orchestrator.toml` **into skill-router's checkout**
(`~/repositories/skill-router/agents-vibe/`), carrying skill-workflows'
own marker. The contract, stated in both READMEs:

- skill-router's prune **skips foreign markers** — it never removes this
  repo's TOML.
- skill-workflows owns its TOML: `install`/`update` regenerate or prune
  it (marker-guarded; a user-authored file at the path is left alone).
- If skill-router's checkout is absent, the Vibe step **skips with a
  message** — never a hard error, and the directory is never created.
- Accepted cost: skill-router's working tree shows this foreign file
  while skill-workflows is installed.

## Development

```sh
node scripts/test.mjs   # the whole suite; all green before any commit
```

TDD: failing test first, RED, implement, GREEN. ESM `.mjs`, stdlib only.
`agents.json` paths are tilde-anchored; never bake machine-specific
usernames into committed files.
