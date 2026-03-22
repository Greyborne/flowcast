import { Router, Request, Response } from 'express';
import multer from 'multer';
import prisma from '../models/prisma';
import { parseOFX } from '../parsers/ofx';
import { parseCSV } from '../parsers/csv';
import { findAutoMatch, findMatchCandidates } from '../services/autoMatcher';
import { recomputeFromPeriod } from '../services/projectionEngine';
import { broadcast } from '../websocket/wsServer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Import ────────────────────────────────────────────────────────────────────

// POST /api/transactions/import
router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const content = req.file.buffer.toString('utf-8');
    const filename = req.file.originalname;

    // Detect format
    const isOFX = /\.(ofx|qfx)$/i.test(filename) || content.includes('OFXHEADER') || /<OFX>/i.test(content);
    const format = isOFX ? 'OFX' : 'CSV';

    // Parse
    let rawTransactions: { dedupeKey: string | null; date: Date; amount: number; description: string; memo: string | null; transactionType: string | null }[];

    if (isOFX) {
      const result = parseOFX(content);
      rawTransactions = result.transactions.map((t) => ({
        dedupeKey: t.fitId,
        date: t.date,
        amount: t.amount,
        description: t.description,
        memo: t.memo,
        transactionType: t.transactionType,
      }));
    } else {
      const result = parseCSV(content);
      rawTransactions = result.transactions.map((t) => ({
        dedupeKey: t.dedupeKey,
        date: t.date,
        amount: t.amount,
        description: t.description,
        memo: null,
        transactionType: null,
      }));
    }

    const totalCount = rawTransactions.length;

    // Dedup check — collect all existing dedupeKeys in one query
    const keysToCheck = rawTransactions.map((t) => t.dedupeKey).filter(Boolean) as string[];
    const existing = keysToCheck.length > 0
      ? await prisma.transaction.findMany({ where: { dedupeKey: { in: keysToCheck } }, select: { dedupeKey: true } })
      : [];
    const existingKeys = new Set(existing.map((e) => e.dedupeKey));

    const newTransactions = rawTransactions.filter(
      (t) => !t.dedupeKey || !existingKeys.has(t.dedupeKey),
    );
    const skippedCount = totalCount - newTransactions.length;

    // Create import batch
    const batch = await prisma.importBatch.create({
      data: { filename, format, totalCount, skippedCount, status: 'COMPLETED' },
    });

    // Auto-match each transaction
    let matchedCount = 0;
    const created: { id: string; billInstanceId: string | null; incomeEntryId: string | null; payPeriodId: string | null }[] = [];

    for (const t of newTransactions) {
      const match = await findAutoMatch(t.description);
      let billInstanceId: string | null = null;
      let incomeEntryId: string | null = null;
      let status = 'UNMATCHED';

      if (match) {
        if (match.targetType === 'BILL') {
          // Find the nearest unreconciled bill instance for this template
          const inst = await prisma.billInstance.findFirst({
            where: {
              billTemplateId: match.targetId,
              isReconciled: false,
              payPeriod: {
                paydayDate: {
                  gte: new Date(t.date.getTime() - 14 * 86400000),
                  lte: new Date(t.date.getTime() + 14 * 86400000),
                },
              },
            },
            orderBy: { payPeriod: { paydayDate: 'asc' } },
            include: { payPeriod: true },
          });
          if (inst) {
            billInstanceId = inst.id;
            status = 'MATCHED';
            matchedCount++;
          }
        } else {
          const entry = await prisma.incomeEntry.findFirst({
            where: {
              incomeSourceId: match.targetId,
              isReconciled: false,
              payPeriod: {
                paydayDate: {
                  gte: new Date(t.date.getTime() - 14 * 86400000),
                  lte: new Date(t.date.getTime() + 14 * 86400000),
                },
              },
            },
            orderBy: { payPeriod: { paydayDate: 'asc' } },
            include: { payPeriod: true },
          });
          if (entry) {
            incomeEntryId = entry.id;
            status = 'MATCHED';
            matchedCount++;
          }
        }
      }

      const txn = await prisma.transaction.create({
        data: {
          importBatchId: batch.id,
          dedupeKey: t.dedupeKey,
          date: t.date,
          amount: t.amount,
          description: t.description,
          memo: t.memo,
          transactionType: t.transactionType,
          source: format,
          status,
          billInstanceId,
          incomeEntryId,
        },
        select: { id: true, billInstanceId: true, incomeEntryId: true },
      });
      created.push({ ...txn, payPeriodId: null });
    }

    // Auto-reconcile matched instances
    const affectedPeriodIds = new Set<string>();
    for (const txn of created) {
      if (txn.billInstanceId) {
        const inst = await prisma.billInstance.findUnique({ where: { id: txn.billInstanceId } });
        if (inst && !inst.isReconciled) {
          const tx = await prisma.transaction.findFirst({ where: { billInstanceId: txn.billInstanceId }, select: { amount: true } });
          await prisma.billInstance.update({
            where: { id: txn.billInstanceId },
            data: { isReconciled: true, actualAmount: tx ? Math.abs(tx.amount) : inst.projectedAmount, reconciledAt: new Date() },
          });
          affectedPeriodIds.add(inst.payPeriodId);
        }
      }
      if (txn.incomeEntryId) {
        const entry = await prisma.incomeEntry.findUnique({ where: { id: txn.incomeEntryId } });
        if (entry && !entry.isReconciled) {
          const tx = await prisma.transaction.findFirst({ where: { incomeEntryId: txn.incomeEntryId }, select: { amount: true } });
          await prisma.incomeEntry.update({
            where: { id: txn.incomeEntryId },
            data: { isReconciled: true, actualAmount: tx ? Math.abs(tx.amount) : entry.projectedAmount, reconciledAt: new Date() },
          });
          affectedPeriodIds.add(entry.payPeriodId);
        }
      }
    }

    // Update batch counts
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { importedCount: newTransactions.length, matchedCount },
    });

    // Recompute affected periods
    if (affectedPeriodIds.size > 0) {
      const sorted = await prisma.payPeriod.findMany({
        where: { id: { in: [...affectedPeriodIds] } },
        orderBy: { paydayDate: 'asc' },
        select: { id: true },
      });
      if (sorted.length > 0) {
        const affected = await recomputeFromPeriod(sorted[0].id);
        broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affected });
      }
    }

    res.status(201).json({
      batchId: batch.id,
      totalCount,
      importedCount: newTransactions.length,
      skippedCount,
      matchedCount,
      format,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── List Transactions ─────────────────────────────────────────────────────────

// GET /api/transactions?status=UNMATCHED&from=&to=&limit=&offset=
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, from, to, limit = '100', offset = '0' } = req.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (from || to) {
      where.date = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }

    const [total, transactions] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: parseInt(offset),
        take: parseInt(limit),
        include: {
          billInstance: { include: { billTemplate: { select: { name: true, group: true } } } },
          incomeEntry: { include: { incomeSource: { select: { name: true } } } },
          importBatch: { select: { filename: true, format: true } },
        },
      }),
    ]);

    res.json({ total, transactions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Match Candidates ──────────────────────────────────────────────────────────

// GET /api/transactions/:id/candidates?search= — candidates near date or matching search
router.get('/:id/candidates', async (req: Request, res: Response) => {
  try {
    const txn = await prisma.transaction.findUniqueOrThrow({ where: { id: req.params.id } });
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const candidates = await findMatchCandidates(txn.date, txn.amount, search);
    res.json(candidates);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Match / Unmatch ───────────────────────────────────────────────────────────

// PATCH /api/transactions/:id/match
// Body: { billInstanceId } | { billTemplateId } | { incomeEntryId } | { incomeSourceId }
// billTemplateId / incomeSourceId are used for ad-hoc items with no existing instance —
// the backend finds the containing pay period and creates a new entry each time.
router.patch('/:id/match', async (req: Request, res: Response) => {
  try {
    const { billInstanceId, billTemplateId, incomeEntryId, incomeSourceId } = req.body;
    if (!billInstanceId && !billTemplateId && !incomeEntryId && !incomeSourceId) {
      return res.status(400).json({ error: 'billInstanceId, billTemplateId, incomeEntryId, or incomeSourceId required' });
    }

    const txn = await prisma.transaction.findUniqueOrThrow({ where: { id: req.params.id } });

    // Unmatch any previous association
    if (txn.billInstanceId) {
      await prisma.billInstance.update({
        where: { id: txn.billInstanceId },
        data: { isReconciled: false, actualAmount: null, reconciledAt: null },
      });
    }
    if (txn.incomeEntryId) {
      await prisma.incomeEntry.update({
        where: { id: txn.incomeEntryId },
        data: { isReconciled: false, actualAmount: null, reconciledAt: null },
      });
    }

    let resolvedBillInstanceId: string | null = null;
    let resolvedIncomeEntryId: string | null = null;
    let payPeriodId: string | null = null;

    if (billInstanceId) {
      const inst = await prisma.billInstance.update({
        where: { id: billInstanceId },
        data: { isReconciled: true, actualAmount: Math.abs(txn.amount), reconciledAt: new Date() },
      });
      resolvedBillInstanceId = inst.id;
      payPeriodId = inst.payPeriodId;
    } else if (billTemplateId) {
      // Discretionary template — find the pay period containing the transaction date,
      // then upsert a bill instance for it.
      const template = await prisma.billTemplate.findUniqueOrThrow({ where: { id: billTemplateId } });
      const period = await prisma.payPeriod.findFirst({
        where: {
          startDate: { lte: txn.date },
          endDate: { gte: txn.date },
        },
      }) ?? await prisma.payPeriod.findFirst({
        // Fallback: nearest period by payday if transaction date doesn't fall in any period
        orderBy: { paydayDate: 'asc' },
        where: { paydayDate: { gte: txn.date } },
      }) ?? await prisma.payPeriod.findFirst({
        orderBy: { paydayDate: 'desc' },
      });

      if (!period) return res.status(400).json({ error: 'No pay periods found' });

      const inst = await prisma.billInstance.upsert({
        where: { payPeriodId_billTemplateId: { payPeriodId: period.id, billTemplateId: template.id } },
        create: {
          payPeriodId: period.id,
          billTemplateId: template.id,
          projectedAmount: template.defaultAmount,
          isReconciled: true,
          actualAmount: Math.abs(txn.amount),
          reconciledAt: new Date(),
        },
        update: {
          isReconciled: true,
          actualAmount: Math.abs(txn.amount),
          reconciledAt: new Date(),
        },
      });
      resolvedBillInstanceId = inst.id;
      payPeriodId = period.id;
    }

    if (incomeEntryId) {
      const entry = await prisma.incomeEntry.update({
        where: { id: incomeEntryId },
        data: { isReconciled: true, actualAmount: Math.abs(txn.amount), reconciledAt: new Date() },
      });
      resolvedIncomeEntryId = entry.id;
      payPeriodId = entry.payPeriodId;
    } else if (incomeSourceId) {
      // Ad-hoc income source — find the period containing the transaction date and
      // create a new income entry (never upsert — multiple ad-hoc entries per period are allowed).
      const source = await prisma.incomeSource.findUniqueOrThrow({ where: { id: incomeSourceId } });
      const period = await prisma.payPeriod.findFirst({
        where: { startDate: { lte: txn.date }, endDate: { gte: txn.date } },
      }) ?? await prisma.payPeriod.findFirst({
        where: { paydayDate: { gte: txn.date } }, orderBy: { paydayDate: 'asc' },
      }) ?? await prisma.payPeriod.findFirst({ orderBy: { paydayDate: 'desc' } });

      if (!period) return res.status(400).json({ error: 'No pay periods found' });

      const entry = await prisma.incomeEntry.create({
        data: {
          payPeriodId: period.id,
          incomeSourceId: source.id,
          projectedAmount: source.defaultAmount,
          actualAmount: Math.abs(txn.amount),
          isReconciled: true,
          reconciledAt: new Date(),
        },
      });
      resolvedIncomeEntryId = entry.id;
      payPeriodId = period.id;
    }

    await prisma.transaction.update({
      where: { id: req.params.id },
      data: { billInstanceId: resolvedBillInstanceId, incomeEntryId: resolvedIncomeEntryId, status: 'MATCHED' },
    });

    if (payPeriodId) {
      const affected = await recomputeFromPeriod(payPeriodId);
      broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affected });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/transactions/:id/unmatch — remove association and un-reconcile
router.patch('/:id/unmatch', async (req: Request, res: Response) => {
  try {
    const txn = await prisma.transaction.findUniqueOrThrow({ where: { id: req.params.id } });
    const affectedPeriods: string[] = [];

    if (txn.billInstanceId) {
      const inst = await prisma.billInstance.update({
        where: { id: txn.billInstanceId },
        data: { isReconciled: false, actualAmount: null, reconciledAt: null },
      });
      affectedPeriods.push(inst.payPeriodId);
    }
    if (txn.incomeEntryId) {
      const entry = await prisma.incomeEntry.update({
        where: { id: txn.incomeEntryId },
        data: { isReconciled: false, actualAmount: null, reconciledAt: null },
      });
      affectedPeriods.push(entry.payPeriodId);
    }

    await prisma.transaction.update({
      where: { id: req.params.id },
      data: { billInstanceId: null, incomeEntryId: null, status: 'UNMATCHED' },
    });

    if (affectedPeriods.length > 0) {
      const sorted = await prisma.payPeriod.findMany({
        where: { id: { in: affectedPeriods } },
        orderBy: { paydayDate: 'asc' },
        select: { id: true },
      });
      const affected = await recomputeFromPeriod(sorted[0].id);
      broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affected });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/transactions/:id/ignore
router.patch('/:id/ignore', async (req: Request, res: Response) => {
  try {
    await prisma.transaction.update({ where: { id: req.params.id }, data: { status: 'IGNORED' } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/transactions/:id/unignore
router.patch('/:id/unignore', async (req: Request, res: Response) => {
  try {
    await prisma.transaction.update({ where: { id: req.params.id }, data: { status: 'UNMATCHED' } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Manual Transaction ────────────────────────────────────────────────────────

// POST /api/transactions/manual
router.post('/manual', async (req: Request, res: Response) => {
  try {
    const { date, amount, description, memo, notes } = req.body;
    if (!date || typeof amount !== 'number' || !description) {
      return res.status(400).json({ error: 'date, amount, description required' });
    }
    const txn = await prisma.transaction.create({
      data: { date: new Date(date), amount, description, memo, notes, source: 'MANUAL', status: 'UNMATCHED' },
    });
    res.status(201).json(txn);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/transactions/:id — delete a manually-entered transaction
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const txn = await prisma.transaction.findUniqueOrThrow({ where: { id: req.params.id } });
    const affectedPeriods: string[] = [];

    // Un-reconcile if matched
    if (txn.billInstanceId) {
      const inst = await prisma.billInstance.update({
        where: { id: txn.billInstanceId },
        data: { isReconciled: false, actualAmount: null, reconciledAt: null },
      });
      affectedPeriods.push(inst.payPeriodId);
    }
    if (txn.incomeEntryId) {
      const entry = await prisma.incomeEntry.update({
        where: { id: txn.incomeEntryId },
        data: { isReconciled: false, actualAmount: null, reconciledAt: null },
      });
      affectedPeriods.push(entry.payPeriodId);
    }

    await prisma.transaction.delete({ where: { id: req.params.id } });

    if (affectedPeriods.length > 0) {
      const sorted = await prisma.payPeriod.findMany({
        where: { id: { in: affectedPeriods } },
        orderBy: { paydayDate: 'asc' },
        select: { id: true },
      });
      const affected = await recomputeFromPeriod(sorted[0].id);
      broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affected });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Import Batches ────────────────────────────────────────────────────────────

// GET /api/transactions/batches
router.get('/batches', async (_req: Request, res: Response) => {
  try {
    const batches = await prisma.importBatch.findMany({
      orderBy: { importedAt: 'desc' },
      include: { _count: { select: { transactions: true } } },
    });
    res.json(batches);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/transactions/batches/:id — delete an import batch and its transactions (un-reconciling matched ones)
router.delete('/batches/:id', async (req: Request, res: Response) => {
  try {
    const txns = await prisma.transaction.findMany({
      where: { importBatchId: req.params.id },
      select: { id: true, billInstanceId: true, incomeEntryId: true },
    });

    const affectedPeriods = new Set<string>();
    for (const txn of txns) {
      if (txn.billInstanceId) {
        const inst = await prisma.billInstance.update({
          where: { id: txn.billInstanceId },
          data: { isReconciled: false, actualAmount: null, reconciledAt: null },
        });
        affectedPeriods.add(inst.payPeriodId);
      }
      if (txn.incomeEntryId) {
        const entry = await prisma.incomeEntry.update({
          where: { id: txn.incomeEntryId },
          data: { isReconciled: false, actualAmount: null, reconciledAt: null },
        });
        affectedPeriods.add(entry.payPeriodId);
      }
    }

    await prisma.transaction.deleteMany({ where: { importBatchId: req.params.id } });
    await prisma.importBatch.delete({ where: { id: req.params.id } });

    if (affectedPeriods.size > 0) {
      const sorted = await prisma.payPeriod.findMany({
        where: { id: { in: [...affectedPeriods] } },
        orderBy: { paydayDate: 'asc' },
        select: { id: true },
      });
      const affected = await recomputeFromPeriod(sorted[0].id);
      broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affected });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auto Match Rules ──────────────────────────────────────────────────────────

/** Return whichever of two instances/entries is closest in paydayDate to txnDate (null-safe). */
function pickClosest<T extends { payPeriod?: { paydayDate: Date } }>(
  txnDate: Date,
  before: T | null,
  after: T | null,
): T | null {
  if (!before) return after;
  if (!after) return before;
  const distBefore = Math.abs(txnDate.getTime() - (before as any).payPeriod.paydayDate.getTime());
  const distAfter  = Math.abs(txnDate.getTime() - (after  as any).payPeriod.paydayDate.getTime());
  return distBefore <= distAfter ? before : after;
}

// POST /api/transactions/rules/apply — run rules engine against transactions
// Body (all optional):
//   from, to: ISO date strings — restrict to transactions in this date range
//   force: boolean — if true, unmatch already-matched transactions first, then re-run rules
router.post('/rules/apply', async (req: Request, res: Response) => {
  try {
    const { from, to, force = false } = req.body as { from?: string; to?: string; force?: boolean };

    const dateFilter = (from || to) ? {
      date: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to   ? { lte: new Date(to + 'T23:59:59.999Z') } : {}),
      },
    } : {};

    // If force, unmatch all currently-matched transactions in the range first
    if (force) {
      const matched = await prisma.transaction.findMany({
        where: { status: 'MATCHED', ...dateFilter },
        select: { id: true, billInstanceId: true, incomeEntryId: true },
      });

      for (const txn of matched) {
        if (txn.billInstanceId) {
          await prisma.billInstance.update({
            where: { id: txn.billInstanceId },
            data: { isReconciled: false, isFrozen: false, actualAmount: null, reconciledAt: null },
          });
        }
        if (txn.incomeEntryId) {
          await prisma.incomeEntry.update({
            where: { id: txn.incomeEntryId },
            data: { isReconciled: false, actualAmount: null, reconciledAt: null },
          });
        }
        await prisma.transaction.update({
          where: { id: txn.id },
          data: { status: 'UNMATCHED', billInstanceId: null, incomeEntryId: null },
        });
      }
    }

    const unmatched = await prisma.transaction.findMany({
      where: { status: 'UNMATCHED', ...dateFilter },
    });

    let matchedCount = 0;
    const affectedPeriodIds = new Set<string>();

    for (const txn of unmatched) {
      const match = await findAutoMatch(txn.description);
      if (!match) continue;

      // No date window — the rule already identifies the target. Find the nearest
      // unreconciled instance; if none exists (discretionary bill), create one.
      if (match.targetType === 'BILL') {
        const [before, after] = await Promise.all([
          prisma.billInstance.findFirst({
            where: { billTemplateId: match.targetId, isReconciled: false, payPeriod: { paydayDate: { lte: txn.date } } },
            orderBy: { payPeriod: { paydayDate: 'desc' } },
            include: { payPeriod: true },
          }),
          prisma.billInstance.findFirst({
            where: { billTemplateId: match.targetId, isReconciled: false, payPeriod: { paydayDate: { gt: txn.date } } },
            orderBy: { payPeriod: { paydayDate: 'asc' } },
            include: { payPeriod: true },
          }),
        ]);

        let inst = pickClosest(txn.date, before, after);

        if (!inst) {
          // Discretionary bill — no instances exist; create one in the period containing the transaction
          const template = await prisma.billTemplate.findUnique({ where: { id: match.targetId } });
          const period = await prisma.payPeriod.findFirst({
            where: { startDate: { lte: txn.date }, endDate: { gte: txn.date } },
          }) ?? await prisma.payPeriod.findFirst({
            where: { paydayDate: { gte: txn.date } }, orderBy: { paydayDate: 'asc' },
          }) ?? await prisma.payPeriod.findFirst({ orderBy: { paydayDate: 'desc' } });

          if (template && period) {
            inst = await prisma.billInstance.upsert({
              where: { payPeriodId_billTemplateId: { payPeriodId: period.id, billTemplateId: template.id } },
              create: { payPeriodId: period.id, billTemplateId: template.id, projectedAmount: template.defaultAmount, isReconciled: false, isFrozen: false },
              update: {},
              include: { payPeriod: true },
            });
          }
        }

        if (inst) {
          await prisma.transaction.update({
            where: { id: txn.id },
            data: { status: 'MATCHED', billInstanceId: inst.id },
          });
          await prisma.billInstance.update({
            where: { id: inst.id },
            data: { isReconciled: true, actualAmount: Math.abs(txn.amount), reconciledAt: new Date() },
          });
          affectedPeriodIds.add(inst.payPeriodId);
          matchedCount++;
        }
      } else {
        const [before, after] = await Promise.all([
          prisma.incomeEntry.findFirst({
            where: { incomeSourceId: match.targetId, isReconciled: false, payPeriod: { paydayDate: { lte: txn.date } } },
            orderBy: { payPeriod: { paydayDate: 'desc' } },
            include: { payPeriod: true },
          }),
          prisma.incomeEntry.findFirst({
            where: { incomeSourceId: match.targetId, isReconciled: false, payPeriod: { paydayDate: { gt: txn.date } } },
            orderBy: { payPeriod: { paydayDate: 'asc' } },
            include: { payPeriod: true },
          }),
        ]);
        const entry = pickClosest(txn.date, before, after);
        if (entry) {
          await prisma.transaction.update({
            where: { id: txn.id },
            data: { status: 'MATCHED', incomeEntryId: entry.id },
          });
          await prisma.incomeEntry.update({
            where: { id: entry.id },
            data: { isReconciled: true, actualAmount: Math.abs(txn.amount), reconciledAt: new Date() },
          });
          affectedPeriodIds.add(entry.payPeriodId);
          matchedCount++;
        }
      }
    }

    if (affectedPeriodIds.size > 0) {
      const sorted = await prisma.payPeriod.findMany({
        where: { id: { in: [...affectedPeriodIds] } },
        orderBy: { paydayDate: 'asc' },
        select: { id: true },
      });
      if (sorted.length > 0) {
        const affected = await recomputeFromPeriod(sorted[0].id);
        broadcast({ type: 'BALANCE_UPDATE', payPeriodIds: affected });
      }
    }

    res.json({ total: unmatched.length, matched: matchedCount, force });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/transactions/rules
router.get('/rules', async (_req: Request, res: Response) => {
  try {
    const rules = await prisma.autoMatchRule.findMany({ orderBy: { priority: 'desc' } });
    res.json(rules);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transactions/rules
router.post('/rules', async (req: Request, res: Response) => {
  try {
    const { pattern, matchType = 'CONTAINS', targetType, targetId, priority = 0 } = req.body;
    if (!pattern || !targetType || !targetId) {
      return res.status(400).json({ error: 'pattern, targetType, targetId required' });
    }
    const rule = await prisma.autoMatchRule.create({ data: { pattern, matchType, targetType, targetId, priority } });
    res.status(201).json(rule);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/transactions/rules/:id
router.put('/rules/:id', async (req: Request, res: Response) => {
  try {
    const { pattern, matchType, targetType, targetId, priority, isActive } = req.body;
    const rule = await prisma.autoMatchRule.update({
      where: { id: req.params.id },
      data: { pattern, matchType, targetType, targetId, priority, isActive },
    });
    res.json(rule);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/transactions/rules/:id
router.delete('/rules/:id', async (req: Request, res: Response) => {
  try {
    await prisma.autoMatchRule.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
