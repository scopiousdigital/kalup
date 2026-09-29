---
"kalup": patch
---

AGENTS.md rule 3 lets an agent pass `--yes` only after the user has read the plan and said yes to it. Rule 4 says what exit 5 means: an apply stopped part way, so the agent runs `npx kalup plan --json`, shows the user what is left, and never applies again without their review.
