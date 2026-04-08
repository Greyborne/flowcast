# Flowcast Backlog

This file tracks planned, in‑progress, and completed work for Flowcast.

## Conventions

Each task should have:
- **ID:** short identifier (e.g. `FC-001`)
- **Title:** concise summary
- **Status:** Todo / In Progress / Done
- **Risk:** Low / Medium / High
- **Tier:** 1 / 2 / 3 (see `docs/agents/models.md`)
- **Owner:** agent / Chaz / mixed
- **Description:** what the task covers
- **Acceptance Criteria:** bullet list
- **Notes:** optional extra context

---

## FC-001 — Deploy Flowcast to Ubuntu Docker server

- **Status:** Todo
- **Risk:** Medium
- **Tier:** 1 (Planner), 1→2 (Implementer), 1 (Verifier)
- **Owner:** agent (with Chaz for env details)

**Description**

Set up Flowcast to run on the Ubuntu 24.04 Docker server instead of the Windows desktop. Use the existing `docker-compose.yml` / `docker-compose.prod.yml` and document a repeatable process.

**Acceptance Criteria**

- Backend and frontend containers start successfully on the Ubuntu server.
- Flowcast is reachable via HTTP from Chaz's network (exact URL documented).
- Database file location and persistence are clearly documented.
- Commands to start/stop/restart the stack are documented.
- Basic smoke test steps are listed (and pass):
  - load main grid
  - reconcile a sample bill/income
  - confirm balances update and persist across restarts.

**Notes**

- Use Tier 1 for planning and initial implementation.
- Escalate to Tier 2 if deployment/debugging requires more complex reasoning.
