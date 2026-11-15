# AGENTS.md

- Node ≥ 18, ESM (`.mjs`), zero dependencies — stdlib only.
- Run tests with `node scripts/test.mjs`. All tests must pass before any commit.
- TDD: write the failing test first, verify RED, implement, verify GREEN.
- Keep error messages stable in shape — callers and tests match on them.
- `agents.json` paths are tilde-anchored; never bake machine-specific usernames into committed files.
