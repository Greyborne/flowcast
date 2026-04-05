/**
 * Universal Bank CSV Parser
 *
 * Handles common bank CSV export formats including:
 *   - Bank of America checking/savings:  Date, Description, Amount, Running Bal.
 *   - Bank of America credit card:       Posted Date, Payee, Amount
 *   - Novo business checking:            Date, Description, Amount, Note, Check Number, Category
 *   - Chase:                             Transaction Date, Description, Category, Type, Amount
 *   - Capital One:                       Transaction Date, Posted Date, Card No., Description, Category, Debit, Credit
 *   - Wells Fargo:                       Date, Amount, *, Check Number, Description
 *   - Generic Mint/Tiller exports:       Date, Description, Amount, ...
 *
 * Date formats supported:
 *   MM/DD/YYYY  MM-DD-YYYY  YYYY-MM-DD  YYYY/MM/DD  M/D/YYYY  M-D-YYYY
 *
 * Amount formats supported:
 *   -45.00  "-$45.00"  "$1,234.56"  "($45.00)"  45.00 (debit/credit split columns)
 *
 * A SHA-256 dedupeKey is computed from date + amount + description so
 * re-importing the same file won't create duplicates.
 */

import { createHash } from 'crypto';

export interface ParsedCSVTransaction {
  dedupeKey: string;
  date: Date;
  amount: number;
  description: string;
  memo: null;
  transactionType: null;
}

export interface CSVParseResult {
  transactions: ParsedCSVTransaction[];
  skippedRows: number;
}

function computeDedupeKey(date: Date, amount: number, description: string): string {
  const raw = `CSV:${date.toISOString().slice(0, 10)}:${amount.toFixed(2)}:${description.toLowerCase().trim()}`;
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Parse a CSV line respecting quoted fields (handles escaped quotes inside fields).
 */
function parseLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse common bank date formats:
 *   MM/DD/YYYY  MM-DD-YYYY  YYYY-MM-DD  YYYY/MM/DD  M/D/YYYY  M-D-YYYY
 */
function parseDate(raw: string): Date | null {
  raw = raw.trim();

  // MM/DD/YYYY or M/D/YYYY
  const mdy_slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (mdy_slash) {
    return new Date(Date.UTC(parseInt(mdy_slash[3]), parseInt(mdy_slash[1]) - 1, parseInt(mdy_slash[2])));
  }

  // MM-DD-YYYY or M-D-YYYY (Novo, some credit unions)
  const mdy_dash = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(raw);
  if (mdy_dash) {
    return new Date(Date.UTC(parseInt(mdy_dash[3]), parseInt(mdy_dash[1]) - 1, parseInt(mdy_dash[2])));
  }

  // YYYY-MM-DD (ISO, Chase, Capital One)
  const ymd_dash = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (ymd_dash) {
    return new Date(Date.UTC(parseInt(ymd_dash[1]), parseInt(ymd_dash[2]) - 1, parseInt(ymd_dash[3])));
  }

  // YYYY/MM/DD
  const ymd_slash = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(raw);
  if (ymd_slash) {
    return new Date(Date.UTC(parseInt(ymd_slash[1]), parseInt(ymd_slash[2]) - 1, parseInt(ymd_slash[3])));
  }

  return null;
}

/**
 * Parse a bank amount string into a signed float.
 * Handles: -45.00  "-$45.00"  "$1,234.56"  "($45.00)"  1,234.56
 * Parentheses = negative (accounting format).
 */
function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;

  const isNegative = s.startsWith('(') && s.endsWith(')');
  // Strip currency symbols, commas, spaces, parentheses
  s = s.replace(/[$£€,\s()]/g, '');
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return isNegative ? -Math.abs(n) : n;
}

/**
 * Find the index of a header column given a list of candidate names (lowercased).
 */
function findCol(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => h === candidate);
    if (idx !== -1) return idx;
  }
  // Partial match fallback
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => h.includes(candidate));
    if (idx !== -1) return idx;
  }
  return -1;
}

export function parseCSV(content: string): CSVParseResult {
  // Strip UTF-8 BOM if present
  const cleaned = content.replace(/^\uFEFF/, '');
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { transactions: [], skippedRows: 0 };

  // Find header row — first line that contains both a date-like and amount-like column name
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes('date') && lower.includes('amount')) {
      headerIdx = i;
      break;
    }
    // Debit/credit format: has 'date' and ('debit' or 'credit')
    if (lower.includes('date') && (lower.includes('debit') || lower.includes('credit'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return { transactions: [], skippedRows: lines.length };

  const headers = parseLine(lines[headerIdx]).map((h) => h.toLowerCase().trim());

  // ── Column detection ─────────────────────────────────────────────────────────

  const dateCol = findCol(headers, [
    'date', 'transaction date', 'posted date', 'trans date', 'transactiondate',
  ]);

  const descCol = findCol(headers, [
    'description', 'payee', 'merchant name', 'name', 'memo', 'narrative', 'details',
    'transaction description', 'trans description',
  ]);

  // Single signed amount column
  const amtCol = findCol(headers, ['amount', 'transaction amount', 'trans amount']);

  // Split debit/credit columns (Capital One, some credit unions)
  const debitCol  = findCol(headers, ['debit',  'withdrawal', 'withdrawals', 'charges']);
  const creditCol = findCol(headers, ['credit', 'deposit',    'deposits',   'payments']);

  const hasAmount     = amtCol !== -1;
  const hasSplitCols  = debitCol !== -1 || creditCol !== -1;

  if (dateCol === -1 || (!hasAmount && !hasSplitCols)) {
    return { transactions: [], skippedRows: lines.length };
  }

  const transactions: ParsedCSVTransaction[] = [];
  let skippedRows = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const fields = parseLine(lines[i]);

    // ── Date ────────────────────────────────────────────────────────────────────
    const date = parseDate(fields[dateCol] ?? '');
    if (!date) { skippedRows++; continue; }

    // ── Amount ──────────────────────────────────────────────────────────────────
    let amount: number | null = null;

    if (hasAmount) {
      amount = parseAmount(fields[amtCol] ?? '');
    } else {
      // Split debit/credit: debit is money out (negative), credit is money in (positive)
      const debit  = debitCol  !== -1 ? parseAmount(fields[debitCol]  ?? '') : null;
      const credit = creditCol !== -1 ? parseAmount(fields[creditCol] ?? '') : null;
      if (debit != null && debit !== 0) {
        amount = -Math.abs(debit);
      } else if (credit != null && credit !== 0) {
        amount = Math.abs(credit);
      } else {
        amount = 0;
      }
    }

    if (amount === null || isNaN(amount)) { skippedRows++; continue; }

    // ── Description ─────────────────────────────────────────────────────────────
    let description = '';
    if (descCol !== -1) {
      description = fields[descCol] ?? '';
    }
    if (!description) {
      // Fallback: first non-date, non-amount field that has content
      description = fields.find((_, idx) => idx !== dateCol && idx !== amtCol && idx !== debitCol && idx !== creditCol && fields[idx].trim()) ?? 'Unknown';
    }
    description = description.trim();

    transactions.push({
      dedupeKey: computeDedupeKey(date, amount, description),
      date,
      amount,
      description,
      memo: null,
      transactionType: null,
    });
  }

  return { transactions, skippedRows };
}
