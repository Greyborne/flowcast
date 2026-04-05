/**
 * Account Context Middleware
 *
 * Reads the X-Account-Id header and attaches accountId to the request.
 * Falls back to "personal" (the default account) when no header is present —
 * this keeps the API backward-compatible during Phase 5b frontend wiring.
 *
 * Phase 5b will add an Axios interceptor on the frontend that sends this header
 * on every request based on the active account in AccountContext.
 */

import { Request, Response, NextFunction } from 'express';
import prisma from '../models/prisma';

// Cache of known-good account IDs to avoid a DB round-trip on every request.
// Invalidated when accounts are created or deleted.
const accountCache = new Set<string>();
let cacheInitialized = false;

export async function initAccountCache(): Promise<void> {
  const accounts = await prisma.account.findMany({ select: { id: true } });
  accounts.forEach((a) => accountCache.add(a.id));
  cacheInitialized = true;
}

export function addToAccountCache(id: string): void {
  accountCache.add(id);
}

export function removeFromAccountCache(id: string): void {
  accountCache.delete(id);
}

export function accountMiddleware(req: Request, res: Response, next: NextFunction): void {
  const accountId = (req.headers['x-account-id'] as string) || 'personal';
  req.accountId = accountId;

  // If cache is initialized and this ID isn't in it, reject the request.
  // This prevents using arbitrary account IDs — they must actually exist.
  if (cacheInitialized && !accountCache.has(accountId)) {
    res.status(400).json({ error: `Unknown account: ${accountId}` });
    return;
  }

  next();
}

/** Helper: build a per-account AppSetting key. */
export function acctKey(accountId: string, key: string): string {
  return `${accountId}:${key}`;
}
