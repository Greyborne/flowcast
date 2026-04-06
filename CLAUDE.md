# FlowCast — Project Context for Claude Agents

## What This Project Is

FlowCast is a personal cash flow projection engine built to replace a Google Sheets/Tiller spreadsheet budget system. It gives Chaz real-time visibility into projected vs. actual cash flow across bi-weekly pay periods, with full transaction import, reconciliation, and bill/income template management.

**Owner:** Chaz (SQL Architect, IT/MSP background)  
**Future user:** Chaz's son (Phase 6 — multi-user auth)

---

## Repository

- **GitHub:** https://github.com/Greyborne/flowcast.git
- **Default branch:** `main` (branch-protected — all changes go through PRs)
- **Branch convention:** `feature/`, `fix/`, `phase-5/` etc.

### Git workflow
1. Always branch from `main`
2. Make changes, commit with detailed messages (see commit format below)
3. Push branch, open PR via GitHub API
4. Chaz reviews and merges to `main`
5. After merge, deploy to dev server (see Deploy section)

---

## Dev Server (Docker)

- **Host:** `10.55.20.96` (also `dockerdev.chazwall.lan` on LAN)
- **SSH user:** `flowcast`
- **Project path:** `/home/flowcast/projects/flowcast-deploy`
- **SSH command:** `ssh flowcast@10.55.20.96`

### App URLs (on LAN)
- Frontend: `http://10.55.20.96:3000`
- Backend API: `http://10.55.20.96:3001`
- WebSocket: `ws://10.55.20.96:3001/ws`

### Deploy after a merge to main
```bash
cd /home/flowcast/projects/flowcast-deploy
git pull
docker compose up -d --build
```

### Useful Docker commands
```bash
# View logs
docker logs flowcast-backend -f
docker logs flowcast-frontend -f

# Restart single container
docker restart flowcast-backend
docker restart flowcast-frontend

# Re-seed database (wipe first to avoid duplicates)
docker exec flowcast-backend rm /data/flowcast.db
docker exec flowcast-backend npx prisma db push
docker exec flowcast-backend npm run db:seed

# Recalculate all balances
# POST http://10.55.20.96:3001/api/pay-periods/recompute-all
```

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React + TypeScript + Vite + Tailwind + TanStack Query (port 3000) |
| Backend | Node.js + Express + TypeScript + Prisma 5.22.0 (port 3001) |
| Database | SQLite (`/data/flowcast.db` in Docker volume) |
| Realtime | WebSocket via `ws` library, path `/ws` |
| Orchestration | Docker Compose (`docker-compose.yml` for dev, `docker-compose.prod.yml` for prod) |

---

## Phase Status

| Phase | Theme | Status |
|---|---|---|
| 1 | DB schema, projection engine, seed data | ✅ Done |
| 2 | Core UI: projection grid, reconciliation, WebSocket, sticky headers | ✅ Done |
| 3 | Settings page, bill/income template management, period regeneration, backup/restore | ✅ Done |
| 4 | Transaction import (CSV/OFX), inbox, auto-match rules, manual transactions | ✅ Done |
| 4b | All Transactions tab: running balance, period break rows, nav arrows, scroll freeze | ✅ Done |
| 5 | Multi-account (personal + business) — account switcher, context, wizard, monthly UX | ✅ Done |
| **6** | **Multi-user auth (Chaz + son, isolated accounts)** | 🔜 Planned |

---

## Phase 5 — Multi-Account Plan (finalized 2026-03-24)

### Key Decisions
- Accounts are fully siloed — no shared templates, rules, transactions, or settings
- Personal account: bi-weekly pay schedule (existing behavior)
- Business account: monthly calendar periods (1st–last day of month, paydayDate = last day)
  - Business income is ad-hoc + monthly recurring clients who pay on specific days of the month
  - `IncomeSource` gets `expectedDayOfMonth: Int?` so e.g. "Client A pays on the 4th"
- Account colors: preset palette (not free-pick) — blue, green, purple, amber, etc.
- Active account stored in localStorage + React context
- Backend receives account via `X-Account-Id` header (axios interceptor sets it)
- New account creation runs an onboarding wizard (name, color, frequency, anchor, opening balance)

### Build Order

**5a — Schema & Backend Foundation**
1. Add `Account` model (id, name, color, createdAt)
2. Add `accountId` to every table; migration creates default "Personal" account + backfills all rows
3. Add `expectedDayOfMonth: Int?` to `IncomeSource`
4. Add `/api/accounts` CRUD routes
5. Express middleware: reads X-Account-Id, validates, attaches to req
6. Update ALL routes + recomputeFromPeriod + ensureInstances + WebSocket to be account-scoped
7. Monthly period generation: startDate=1st, endDate=last day, paydayDate=last day

**5b — Frontend Wiring**
1. AccountContext — active account, list, switch fn; persists to localStorage
2. Axios interceptor — injects X-Account-Id on every request
3. Account switcher dropdown in nav header (switch, create, rename, color)
4. New account onboarding wizard: name+color → frequency → anchor+payday day → opening balance

**5c — Monthly UX Tweaks**
- Income Sources form: "Expected day of month" field (monthly accounts only)
- Projection grid header: show "Mar 2026" instead of payday date for monthly accounts
- Period break rows in All Transactions: show month name for monthly account periods

---

## Deferred Items
- **Archived bill behavior in projection grid**: when a bill is archived, it disappears from the grid — decide if archived bills should show as $0 / struck-through for historical visibility. Flagged 2026-03-24, defer to after Phase 5.

---

## Key Technical Conventions

### Dates
- Always use `d.slice(0,10) + 'T12:00:00'` when parsing date strings for display (avoids UTC→local rollback)
- Pay period generation: `addWeeks(FIRST_PAYDAY, i * 2)` for bi-weekly
- Monthly periods: startDate = 1st of month, endDate = last day, paydayDate = last day

### Layout
- **Flex-fill architecture:** `h-screen flex flex-col overflow-hidden` on Layout, `flex-1 min-h-0` on content areas, `overflow-y-auto` on scroll containers
- **Never use** `calc(100vh - Xpx)` magic numbers
- Scroll containers: use `overflow-auto` (not `overflow-x-auto`) to preserve sticky cell behavior
- Period containment: `startDate <= txnDate <= endDate` is canonical for assigning transactions

### SQLite / Prisma
- No native enum support — all type fields use `String` with app-level validation
- `createMany` does NOT support `skipDuplicates` in SQLite/Prisma 5.22.0
- Use `db push` (not `migrate deploy`) — no migration files exist

### Settings Page
- **"Data Management" tab must always be the rightmost tab** in the TABS array in `frontend/src/pages/SettingsPage.tsx`
- When adding any new settings tab, insert it BEFORE the `data` tab entry, never after

---

## Commit Message Format

Always use this exact format — never short single-line messages:

```
Phase X / Feature Name: brief summary of what changed

- Specific change 1 and why
- Specific change 2 and why
- Specific change 3 and why

Co-Authored-By: Claudius Maximus <noreply@anthropic.com>
```

Wrap in a code block when presenting to Chaz so he can copy it directly.

**Proactively suggest commits** after completing a phase, fixing a significant bug, or making several related changes that form a logical unit.

---

## Collaboration Preferences

- Chaz is comfortable with technical concepts but prefers plain-language explanation before diving into code
- Sketch out the plan first, get confirmation, then implement
- Proactively flag architectural concerns or risks before they become problems
- Suggest GitHub commits at natural checkpoints without waiting to be asked
- When starting a session: read this file + check `git log --oneline -5` + `docker logs flowcast-backend --tail 20` to orient

---

## Project File Structure

```
flowcast/
├── CLAUDE.md                       ← you are here
├── SESSION_NOTES.md                ← high-level session history
├── docs/
│   ├── backlog.md                  ← task backlog (FC-XXX items)
│   └── agents/                     ← agent role definitions
├── docker-compose.yml              ← dev orchestration
├── docker-compose.prod.yml         ← production (Nginx)
├── backend/
│   ├── Dockerfile
│   ├── prisma/
│   │   └── schema.prisma           ← SQLite schema
│   └── src/
│       ├── server.ts               ← Express + HTTP + WebSocket init
│       ├── db/seed.ts              ← seed data
│       ├── services/
│       │   ├── projectionEngine.ts ← billFallsInPeriod(), recomputeFromPeriod()
│       │   └── cascadeService.ts   ← reconcile*, unreconcile*, setCurrentBalance
│       ├── websocket/wsServer.ts   ← broadcast() helper
│       └── routes/                 ← payPeriods, bills, income, reconciliation, settings, transactions, rules
└── frontend/
    └── src/
        ├── App.tsx                 ← WS connection + auto-reconnect + query invalidation
        ├── types/index.ts
        ├── hooks/
        └── components/
            ├── ProjectionGrid/
            ├── BalanceHeader/
            └── pages/
                └── SettingsPage.tsx  ← Data Management tab MUST be last
```
