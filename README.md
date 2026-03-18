# FlowCast — Cash Flow Projection Engine

> *Your personal cash flow projection engine.*

A self-hosted, Docker-based web app that replaces a Google Sheets budget with a real-time cash flow projection system. See your bank balance on every payday for 2 years ahead. Reconcile income and bills with automatic cascade recalculation. No page refresh required.

---

## Quick Start

### Prerequisites
- Docker Desktop (or Docker Engine + Compose on Ubuntu)
- Node.js 20+ (for local development without Docker)
- VS Code (recommended)

### 1. Clone and configure

```bash
cp .env.example .env
# Edit .env if needed
```

### 2. Start with Docker

```bash
docker-compose up
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- API Health: http://localhost:3001/health

### 3. Initialize the database

```bash
# In a new terminal:
docker-compose exec backend npm run db:push
docker-compose exec backend npm run db:seed
```

### 4. Open in browser

Navigate to http://localhost:3000

---

## Development (without Docker)

### Backend

```bash
cd backend
npm install
npm run db:push       # Create SQLite database
npm run db:seed       # Seed with Chaz's bill templates
npm run dev           # Start with hot reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## Project Structure

```
flowcast/
├── docker-compose.yml          # Dev orchestration
├── docker-compose.prod.yml     # Production orchestration
├── .env.example                # Environment template
│
├── backend/                    # Node.js + Express + Prisma
│   ├── prisma/
│   │   └── schema.prisma       # Database schema
│   └── src/
│       ├── server.ts           # Express + WebSocket entry point
│       ├── routes/             # REST API endpoints
│       ├── services/
│       │   ├── projectionEngine.ts  # Core cash flow computation
│       │   └── cascadeService.ts    # Reconciliation + W2 propagation
│       ├── websocket/
│       │   └── wsServer.ts     # Real-time broadcast
│       ├── models/
│       │   └── prisma.ts       # Prisma singleton
│       └── db/
│           └── seed.ts         # Initial data seed
│
├── frontend/                   # React + TypeScript + Vite
│   └── src/
│       ├── App.tsx             # Root component + WebSocket connection
│       ├── components/
│       │   ├── Layout/         # App shell
│       │   ├── BalanceHeader/  # Current balance + stats cards
│       │   └── ProjectionGrid/ # 2-year pay period grid
│       ├── hooks/
│       │   └── usePayPeriods.ts # API + reconciliation hooks
│       └── types/
│           └── index.ts        # Shared TypeScript types
│
└── nginx/
    └── nginx.conf              # Reverse proxy config
```

---

## Key Concepts

### The Projection Grid

The main view is a horizontal grid of bi-weekly pay periods (columns) with bills and income as rows. Each column shows the projected bank balance for that payday.

### Reconciliation

- **Click a bill or income row** to reconcile it with the actual amount
- **Reconciled records are frozen** — they can't be edited unless you explicitly un-reconcile
- **W2 income**: reconciling to a different amount automatically updates all future unreconciled paychecks and cascades the new balance forward
- **Balance cascade**: after any reconciliation, all future period balances recompute in < 1 second and push to the browser via WebSocket

### Set Current Balance

Use the "Current Balance" card at the top to update your actual bank balance. This seeds the entire 2-year projection.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/pay-periods | List all pay periods with balance snapshots |
| GET | /api/pay-periods/:id | Full projection for one period |
| GET | /api/bills | List all bill templates |
| PUT | /api/bills/:id/monthly/:year/:month | Set bill amount for a specific month |
| GET | /api/income | List all income sources |
| POST | /api/reconciliation/income/:id | Reconcile income entry |
| DELETE | /api/reconciliation/income/:id | Un-reconcile income entry |
| POST | /api/reconciliation/bill/:id | Reconcile bill instance |
| DELETE | /api/reconciliation/bill/:id | Un-reconcile bill instance |
| POST | /api/reconciliation/balance | Set current bank balance |

---

## Production Deployment (Ubuntu 24.04 LTS)

```bash
# On your Ubuntu server:
git clone <your-repo> flowcast
cd flowcast
cp .env.example .env
# Edit .env with production values

docker-compose -f docker-compose.prod.yml up -d
```

---

*Built for Chaz — CT Tech Solutions*
