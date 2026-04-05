/**
 * FlowCast Config Backup / Restore
 *
 * schemaVersion history:
 *   1 — initial (billTemplates, incomeSources, autoMatchRules, appSettings)
 */

import { Router, Request, Response } from 'express';
import prisma from '../models/prisma';

const router = Router();

export const BACKUP_SCHEMA_VERSION = 1;

// ── GET /api/backup ────────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  try {
    const [billTemplates, incomeSources, autoMatchRules, appSettings] = await Promise.all([
      prisma.billTemplate.findMany({
        where: { accountId: req.accountId },
        orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
        include: { monthlyAmounts: { orderBy: [{ year: 'asc' }, { month: 'asc' }] } },
      }),
      prisma.incomeSource.findMany({ where: { accountId: req.accountId }, orderBy: { name: 'asc' } }),
      prisma.autoMatchRule.findMany({ where: { accountId: req.accountId }, orderBy: { priority: 'desc' } }),
      prisma.appSetting.findMany({ where: { key: { startsWith: `${req.accountId}:` } }, orderBy: { key: 'asc' } }),
    ]);

    // Embed targetName in rules so restore can re-link after IDs change
    const rulesWithNames = autoMatchRules.map((rule) => {
      const targetName =
        rule.targetType === 'BILL'
          ? billTemplates.find((t) => t.id === rule.targetId)?.name ?? null
          : incomeSources.find((s) => s.id === rule.targetId)?.name ?? null;
      return { ...rule, targetName };
    });

    const backup = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      counts: {
        billTemplates: billTemplates.length,
        incomeSources: incomeSources.length,
        autoMatchRules: autoMatchRules.length,
        appSettings: appSettings.length,
      },
      data: {
        billTemplates: billTemplates.map(({ monthlyAmounts, ...t }) => ({
          ...t,
          monthlyAmounts: monthlyAmounts.map(({ billTemplateId, ...m }) => m),
        })),
        incomeSources,
        autoMatchRules: rulesWithNames,
        appSettings,
      },
    };

    res.setHeader('Content-Disposition', `attachment; filename="flowcast-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(backup);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/backup/restore ───────────────────────────────────────────────────

router.post('/restore', async (req: Request, res: Response) => {
  try {
    const { mode, backup } = req.body as {
      mode: 'merge' | 'replace';
      backup: {
        schemaVersion: number;
        data: {
          billTemplates: any[];
          incomeSources: any[];
          autoMatchRules: any[];
          appSettings: any[];
        };
      };
    };

    if (!mode || !backup?.data) {
      return res.status(400).json({ error: 'mode and backup.data are required' });
    }

    const versionWarning =
      backup.schemaVersion > BACKUP_SCHEMA_VERSION
        ? `Backup schema version (${backup.schemaVersion}) is newer than this app (${BACKUP_SCHEMA_VERSION}). Some data may not restore correctly.`
        : backup.schemaVersion < BACKUP_SCHEMA_VERSION
        ? `Backup schema version (${backup.schemaVersion}) is older than this app (${BACKUP_SCHEMA_VERSION}). Missing fields will use defaults.`
        : null;

    const { billTemplates = [], incomeSources = [], autoMatchRules = [], appSettings = [] } = backup.data;

    // Map to track old backup IDs → new DB IDs for Replace mode
    const templateIdMap = new Map<string, string>();
    const sourceIdMap   = new Map<string, string>();

    const summary = { billTemplates: 0, incomeSources: 0, autoMatchRules: 0, appSettings: 0 };

    if (mode === 'replace') {
      // Wipe in dependency order, then reimport
      await prisma.autoMatchRule.deleteMany();
      await prisma.billMonthlyAmount.deleteMany();
      await prisma.billInstance.deleteMany();
      await prisma.billTemplate.deleteMany();
      await prisma.incomeEntry.deleteMany();
      await prisma.incomeSource.deleteMany();
      // Keep appSettings (upsert below)

      for (const t of billTemplates) {
        const { id: oldId, monthlyAmounts, ...fields } = t;
        const created = await prisma.billTemplate.create({ data: { ...fields } });
        if (oldId) templateIdMap.set(oldId, created.id);
        for (const m of monthlyAmounts ?? []) {
          await prisma.billMonthlyAmount.create({
            data: { billTemplateId: created.id, year: m.year, month: m.month, amount: m.amount },
          });
        }
        summary.billTemplates++;
      }

      for (const s of incomeSources) {
        const { id: oldId, ...fields } = s;
        const created = await prisma.incomeSource.create({ data: { ...fields } });
        if (oldId) sourceIdMap.set(oldId, created.id);
        summary.incomeSources++;
      }

      for (const rule of autoMatchRules) {
        const { id: _id, targetName, targetId, ...fields } = rule;
        // Re-link targetId using the new IDs where possible, fall back to name lookup
        let newTargetId = fields.targetType === 'BILL' ? templateIdMap.get(targetId) : sourceIdMap.get(targetId);
        if (!newTargetId && targetName) {
          if (fields.targetType === 'BILL') {
            const t = await prisma.billTemplate.findFirst({ where: { name: targetName } });
            newTargetId = t?.id;
          } else {
            const s = await prisma.incomeSource.findFirst({ where: { name: targetName } });
            newTargetId = s?.id;
          }
        }
        if (newTargetId) {
          await prisma.autoMatchRule.create({ data: { ...fields, targetId: newTargetId } });
          summary.autoMatchRules++;
        }
      }
    } else {
      // Merge — upsert by natural keys
      for (const t of billTemplates) {
        const { id: _id, monthlyAmounts, ...fields } = t;
        const existing = await prisma.billTemplate.findFirst({ where: { name: fields.name } });
        let template;
        if (existing) {
          template = await prisma.billTemplate.update({ where: { id: existing.id }, data: fields });
        } else {
          template = await prisma.billTemplate.create({ data: { ...fields } });
        }
        templateIdMap.set(t.id, template.id);
        for (const m of monthlyAmounts ?? []) {
          await prisma.billMonthlyAmount.upsert({
            where: { billTemplateId_year_month: { billTemplateId: template.id, year: m.year, month: m.month } },
            create: { billTemplateId: template.id, year: m.year, month: m.month, amount: m.amount },
            update: { amount: m.amount },
          });
        }
        summary.billTemplates++;
      }

      for (const s of incomeSources) {
        const { id: _id, ...fields } = s;
        const existing = await prisma.incomeSource.findFirst({ where: { name: fields.name } });
        let source;
        if (existing) {
          source = await prisma.incomeSource.update({ where: { id: existing.id }, data: fields });
        } else {
          source = await prisma.incomeSource.create({ data: { ...fields } });
        }
        sourceIdMap.set(s.id, source.id);
        summary.incomeSources++;
      }

      for (const rule of autoMatchRules) {
        const { id: _id, targetName, targetId, ...fields } = rule;
        let newTargetId = fields.targetType === 'BILL' ? templateIdMap.get(targetId) : sourceIdMap.get(targetId);
        if (!newTargetId && targetName) {
          if (fields.targetType === 'BILL') {
            const t = await prisma.billTemplate.findFirst({ where: { name: targetName } });
            newTargetId = t?.id;
          } else {
            const s = await prisma.incomeSource.findFirst({ where: { name: targetName } });
            newTargetId = s?.id;
          }
        }
        if (!newTargetId) continue;
        const existing = await prisma.autoMatchRule.findFirst({
          where: { pattern: fields.pattern, matchType: fields.matchType, targetType: fields.targetType },
        });
        if (existing) {
          await prisma.autoMatchRule.update({ where: { id: existing.id }, data: { ...fields, targetId: newTargetId } });
        } else {
          await prisma.autoMatchRule.create({ data: { ...fields, targetId: newTargetId } });
        }
        summary.autoMatchRules++;
      }
    }

    // AppSettings — always upsert by key regardless of mode
    for (const s of appSettings) {
      await prisma.appSetting.upsert({
        where: { key: s.key },
        create: { key: s.key, value: s.value },
        update: { value: s.value },
      });
      summary.appSettings++;
    }

    res.json({ mode, summary, versionWarning: versionWarning ?? undefined });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
