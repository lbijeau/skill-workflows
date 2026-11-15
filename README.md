# skill-workflows

Multi-agent workflow definitions and the agent registry that validates them — extracted from [skill-router](https://github.com/lucbijeau/skill-router) per ADR-011 so workflows can evolve independently of skill routing. `workflows.json` names the workflows; `agents.json` names the agents each step may reference; `scripts/workflows.mjs` loads and validates both. Full docs land in Task 4.
