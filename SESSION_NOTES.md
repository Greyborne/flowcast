# FlowCast — Session Notes
_Last updated: 2026-03-18_

## ✅ Current State

The app is running and functional. All core features through Phase 2 are complete.

- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:3001
- **WebSocket:** ws://localhost:3001/ws

---

## Stack Summary

| Layer | Tech |
|---|---|
| Frontend | React + TypeScript + Vite + Tailwind + TanStack Query |
| Backend | Node.js + Express + TypeScript |
| ORM | Prisma 5.22.0 |
| Database | SQLite (file: `/data/flowcast.db`) |
| Orchestration | Docker Compose |
| Realtime | WebSockets (`ws` library) |

---

## Project Structure

```
flowcast/
├── docker-compose.yml          # Dev orchestration
├── docker-compose.prod.yml     # Production (Nginx) — not yet tested
├── backend/
│   ├── Dockerfile
│   ├── prisma/
│   │   └── schema.prisma       # SQLite schema — no enums, String types only
│   │                           # BillTemplate has @@unique([name]) to prevent dup seeds
│   └── src/
│       ├── server.ts           # Express + HTTP + WebSocket init
│       ├── db/
│       │   └── seed.ts         # 53 bi-weekly pay periods, 44 bill templates, 4 income sources
│       ├── services/
│       │   ├── projectionEngine.ts   # billFallsInPeriod(), recomputeFromPeriod()
│       │   └── cascadeService.ts     # reconcileIncome, reconcileBill, unreconcile*, setCurrentBalance
│       ├── websocket/
│       │   └── wsServer.ts     # broadcast() helper
│       └── routes/
│           ├── payPeriods.ts
│           ├── bills.ts        # includes PATCH /instance/:id for draft saves
│           ├── income.ts       # includes PATCH /entry/:id for draft saves
│           ├── reconciliation.ts
│           └── settings.ts
└── frontend/
    └── src/
        ├── App.tsx                         # WS connection + auto-reconnect + query invalidation
        ├── types/index.ts
        ├── hooks/
        │   └── usePayPeriods.ts            # TanStack Query hooks
        └── components/
            ├── ProjectionGrid/
            │   └── ProjectionGrid.tsx      # Main grid (see details below)
            └── BalanceHeader/
                └── BalanceHeader.tsx       # 4 stat cards + current balance input
```

---

## Key Design Decisions

1. **SQLite limitations** — No native enum support; all type fields use `String`. `createMany` does NOT support `skipDuplicates` in SQLite/Prisma 5.22.0.

2. **Reconciliation semantics (two-stage)**
   - **Draft save** (Enter/Tab in cell): updates `projectedAmount` only. Not frozen. Used to adjust future projections.
   - **Reconcile** (✓ button): sets `actualAmount`, marks `isReconciled = true`, sets `isFrozen = true` on bills.
   - **Un-reconcile**: inline yellow confirm → clears actualAmount, resets isReconciled/isFrozen, recomputes cascade.

3. **Cascade toggle** — All edits (draft OR reconcile) show "All future ↔ This only" pill toggle inline next to the ✓/✕ buttons. Applies uniformly to both bills and income.

4. **W2 Propagation** — When a W2 paycheck is reconciled (cascade=true), ALL future unreconciled W2 entries for that source are updated AND `IncomeSource.defaultAmount` is updated. Balance cascade follows.

5. **Reconciliation Lock** — `BillInstance.isFrozen = true` when reconciled. Cannot re-reconcile without explicit un-reconcile first. Income entries do not freeze.

6. **Pay Period Model** — 53 bi-weekly periods starting `2026-03-28`. Each period: `openingBalance` for first period, computed thereafter.

7. **Bill Amount Logic** — `BillTemplate.defaultAmount` (global) → `BillMonthlyAmount` override (per year/month). `billFallsInPeriod()` assigns bills to periods using DOT+1 offset spanning current+next month.

8. **WebSocket Broadcast** — After any cascade recompute: `broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: [...] })`. Frontend invalidates TanStack Query cache on receipt → grid refreshes automatically.

---

## ProjectionGrid Features (as of this session)

- **Horizontal scroll** — One column per pay period, dates across top
- **Sticky date header** (`top-0 z-20`) — Clicking a column header opens the detail panel
- **Sticky Projected Balance row** (`top-[41px] z-10`) — box-shadow border trick (CSS border doesn't travel with sticky elements; `boxShadow: '0 2px 0 #374151'` does)
- **Detail panel** — Right-side slide-in showing: Projected vs Planned balance, income breakdown, bill breakdown for selected period
- **Column highlight** — Selected period column shows blue background on bill/income cells
- **Removed rows** — Planned Balance and Difference rows removed from main grid (Planned Balance lives in detail panel)
- **Bill cells** — Click-to-edit, shows projected amount; green = income, red = bill; reconciled cells show lock icon
- **ReconcileInput** — Enter/Tab=draft save, ✓=reconcile+freeze, cascade pill toggle, `type="text" inputMode="decimal"` (no spinner arrows)
- **UnreconcileConfirm** — Inline yellow confirm for un-reconciling frozen bill cells
- **Scroll container** — `overflow-auto max-h-[calc(100vh-260px)]` (NOT `overflow-x-auto` — that breaks sticky)

---

## Seeded Data

- **53 pay periods** — bi-weekly from 2026-03-28 for 2 years
- **44 bill templates** — Groups 1–6 matching the Tiller spreadsheet
- **4 income sources** — Paycheck (W2, $2,583.77, propagates on reconcile), Freelance, CT Tech Salary, Misc Income
- **Opening balance** — `$252.98` (stored in AppSetting `currentBankBalance` and first period `openingBalance`)

---

## API Routes

| Method | Path | Description |
|---|---|---|
| GET | `/api/pay-periods` | All pay periods with snapshots, bills, income |
| PATCH | `/api/bills/instance/:id` | Draft-save projected amount (cascade optional) |
| POST | `/api/reconciliation/bill/:id` | Reconcile + freeze bill instance |
| DELETE | `/api/reconciliation/bill/:id` | Un-reconcile bill instance |
| PATCH | `/api/income/entry/:id` | Draft-save projected income amount (cascade optional) |
| POST | `/api/reconciliation/income/:id` | Reconcile income entry |
| DELETE | `/api/reconciliation/income/:id` | Un-reconcile income entry |
| POST | `/api/reconciliation/balance` | Set current bank balance, recompute all |

---

## Bugs Fixed This Session

| Bug | Fix |
|---|---|
| WebSocket not triggering auto-refresh | `VITE_WS_URL` was missing `/ws` path — added to `docker-compose.yml` |
| Vite HMR not picking up file changes on Windows/Docker | Added `watch: { usePolling: true }` to `vite.config.ts` |
| Sticky headers not working | `overflow-x-auto` traps sticky; changed to `overflow-auto max-h-[calc(100vh-260px)]` |
| Sticky border disappears on scroll | CSS `border-b` doesn't travel with sticky `<td>`; replaced with `boxShadow: '0 2px 0 #374151'` |
| Pay periods generated weekly (not bi-weekly) | `addWeeks(FIRST_PAYDAY, i)` was wrong → fixed to `addWeeks(FIRST_PAYDAY, i * 2)` |
| Home Mortgage appearing 6× per period | Was caused by weekly-overlapping periods; fixed by correcting bi-weekly generation |
| Duplicate pay periods from double seed | Wipe DB (`rm /data/flowcast.db`) → `db push` → `db:seed` |
| "Next Payday" date showing one day early | UTC→local rollback — fixed with `d.slice(0,10) + 'T12:00:00'` noon-UTC trick |
| `prisma migrate deploy` fails on fresh DB | No migration files exist (we use `db push`); use `db push` instead |
| `BillTemplate` duplicates on re-seed | Added `@@unique([name])` to schema |

---

## Useful Docker Commands

```bash
# Start everything
docker-compose up -d

# View backend logs
docker logs flowcast-backend -f

# View frontend logs
docker logs flowcast-frontend -f

# Restart a single container (pick up code changes)
docker restart flowcast-backend
docker restart flowcast-frontend

# Re-seed (wipe first to avoid duplicates)
docker exec flowcast-backend rm /data/flowcast.db
docker exec flowcast-backend npx prisma db push
docker exec flowcast-backend npm run db:seed

# Open Prisma Studio (DB browser)
docker exec -it flowcast-backend npx prisma studio
```

---

## Immediate Next Steps (Before Phase 3)

### D — Reset / Start Fresh with Real Balance
- Currently seeded anchor is `2026-03-28` but active pay period started `2026-03-14` (no column exists for it)
- **Fix in Phase 3 via Settings:** set anchor date + frequency in settings UI → regenerate periods properly
- For now: set current bank balance via the header card click-to-edit as a stopgap

### Prod Deploy Test
- `docker-compose.prod.yml` with Nginx — not yet tested end-to-end

---

## Product Roadmap

### Phase 3 — Settings & Polish *(next)*

**Settings Page**
- Pay schedule: anchor payday date + frequency (weekly / bi-weekly / semi-monthly / monthly)
- Projection window (1 / 2 / 3 years)
- Opening bank balance (canonical home for this, replaces header-card stopgap)
- "Regenerate Pay Periods" action — rebuilds all future unreconciled periods from new anchor/frequency
- Fixes the March 14 "missing current period" problem properly

**Bill & Income Template Management UI**
- Add / edit / archive bill templates (name, group, due day, default amount)
- Manage income sources (name, type, default amount, propagation behavior)
- BillMonthlyAmount overrides — per year/month amount adjustments
- No more touching `seed.ts` for configuration changes

**Late Payment / Period Reassignment**
- Problem: if mortgage is due Apr 5 (planned in Apr 25 period) but paid May 10, the May 9 period has no Home Mortgage row to reconcile against
- Solution: "Add bill to this period" action (+ button in column header) — manually attaches any bill template to any period as an override instance
- Original instance in the earlier period is marked skipped/void
- Balance cascade handles the rest
- Affects: new `BillInstance` creation endpoint, ProjectionGrid UI, projection engine void logic

**Other**
- Reconciliation log / audit trail view
- Mobile-friendly layout improvements

---

### Phase 4 — Transaction Import & Categorization

**Import**
- CSV upload from bank (most banks support this)
- OFX/QFX file support (Quicken format — widely supported)
- Manual transaction entry as fallback
- Plaid live bank feed — deferred (complex + API cost)

**Transaction Inbox**
- Imported transactions appear in an "Uncategorized" inbox
- Auto-match rules: merchant name patterns → bill template (e.g. "ALLY FINANCIAL" → Ally Car Kia)
- Manual match: assign uncategorized transaction to a bill instance or income entry
- Once matched, transaction amount flows into `actualAmount` automatically — *this becomes the reconciliation*
- Unmatched transactions can be assigned to discretionary categories (Groceries, Restaurants, etc.)

**Schema additions**
```
Transaction
  id, accountId, date, amount, merchant, rawDescription
  status (unmatched / matched / ignored)
  billInstanceId? (FK — null until matched)
  incomeEntryId?  (FK — null until matched)

AutoMatchRule
  id, accountId, pattern (regex/substring), billTemplateId?, incomeSourceId?
  priority, createdAt
```

---

### Phase 5 — Multi-Account

**Goal:** Personal and business accounts coexist with completely isolated data. No auth yet — just an account switcher.

**Features**
- Account switcher in nav (Personal / Business / + Add Account)
- Each account has its own: pay schedule, bill templates, income sources, pay periods, opening balance, settings
- Business account can have simpler template set and different pay frequency

**Schema additions**
```
Account
  id, name, type (personal / business), color, icon, createdAt

— All core models get accountId FK: —
PayPeriod      → + accountId
BillTemplate   → + accountId
IncomeSource   → + accountId
AppSetting     → + accountId
Transaction    → + accountId (already planned in Phase 4)
```

**Why before auth:** data isolation is already done at the account level. Phase 6 just layers a user identity on top — no painful "add accountId everywhere" migration mid-auth work.

---

### Phase 6 — Multi-User & Auth

**Goal:** Chaz's son gets his own login and sees only his account. Chaz retains full control of his.

**Features**
- Registration / login (email + password, JWT sessions)
- Each user owns one or more accounts
- Account-level roles: `owner` / `editor` / `viewer`
- Account sharing: optionally invite another user as viewer/editor on your account
- All API routes get auth middleware; account scoping enforced server-side

**Schema additions**
```
User
  id, email, passwordHash, name, createdAt

AccountMember  (join table)
  userId, accountId, role (owner / editor / viewer)
```

---

## Roadmap Summary

| Phase | Theme | Status |
|---|---|---|
| 1 | Foundation — DB schema, projection engine, seed | ✅ Done |
| 2 | Core UI — Grid, reconciliation, WS, sticky headers, detail panel | ✅ Done |
| 3 | Settings & Polish — Config UI, template mgmt, late payment reassignment | 🔜 Next |
| 4 | Transactions — CSV/OFX import, inbox, auto-categorization, matching | Planned |
| 5 | Multi-Account — Account switcher, isolated data, business account | Planned |
| 6 | Multi-User & Auth — Login, JWT, per-user ownership, account sharing | Planned |
