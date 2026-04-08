# Flowcast Agent Model Tiers

Flowcast agents should use the **cheapest model that is good enough**, and only escalate when quality or safety requires it.

## Tier 1 — Local default (free)

**Model:** `ollama/qwen3.5:9b`

Use this by default for:
- planning, backlog work, and task decomposition
- most code changes within a single service
- writing docs, checklists, and test plans
- non‑destructive refactors

Notes:
- Runs on Chaz's GPU, $0 cost.
- Prefer this unless there is a clear quality/safety reason to escalate.

## Tier 2 — Codex (baseline)

**Primary:** `openai-codex/gpt-5.1`

Escalate to Tier 2 when:
- Tier 1 struggles to complete the task or produces obviously weak code/logic
- reasoning spans many files or complex data flows
- careful API/typing work is required and Tier 1 is making repeated mistakes

This is the first paid step up. Start here before going to Tier 3.

## Tier 3 — Codex (high-end)

**Examples:** `openai-codex/gpt-5.3-codex`, `openai-codex/gpt-5.4`

Reserve Tier 3 for:
- tasks that can **destroy or corrupt data** (migrations, destructive jobs)
- changes to **core financial logic** or projection/balance math
- large, intricate refactors with high blast radius
- anything where correctness is more important than cost or speed

## Planner vs Executor pattern

To keep costs down:

- **Planner / prompt author:**
  - Use Tier 1 (9B) to:
    - understand the task
    - inspect code
    - produce a clear plan and prompts for execution
- **Executor:**
  - Use Tier 2/3 only when needed to
    - implement risky changes
    - update complex logic
    - write migration scripts

The framework should make it easy to say:
- "Let the planner use Tier 1, but run the implementation on Tier 2/3 for this task."

## Manual overrides

Chaz can always override the default tier for a task. The planner should respect instructions like:

- "Use Codex Tier 2 for this task."
- "Force Tier 3 for this migration."
- "Keep this one on 9B only."

When in doubt:
- default to Tier 1
- escalate with a short justification if needed.
