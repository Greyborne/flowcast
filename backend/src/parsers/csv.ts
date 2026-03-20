/**
 * Bank of America CSV Parser
 *
 * BofA checking/savings CSV format (export from Online Banking → Download):
 *   Date,Description,Amount,Running Bal.
 *   01/15/2024,"WALMART STORE #1234",-45.00,1234.56
 *
 * Credit card CSV format is slightly different — we handle both by detecting
 * column headers and mapping accordingly.
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
 * Parse a CSV line respecting quoted fields.
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
 * Parse a date string in MM/DD/YYYY or YYYY-MM-DD format.
 */
function parseDate(raw: string): Date | null {
  raw = raw.trim();
  // MM/DD/YYYY
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (mdy) {
    return new Date(Date.UTC(parseInt(mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2])));
  }
  // YYYY-MM-DD
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (ymd) {
    return new Date(Date.UTC(parseInt(ymd[1]), parseInt(ymd[2]) - 1, parseInt(ymd[3])));
  }
  return null;
}

export function parseCSV(content: string): CSVParseResult {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { transactions: [], skippedRows: 0 };

  // Find header row (first line containing "Date" and "Amount")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes('date') && lower.includes('amount')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return { transactions: [], skippedRows: lines.length };

  const headers = parseLine(lines[headerIdx]).map((h) => h.toLowerCase().trim());

  // Column index resolution — handle BofA checking and credit card variants
  const dateCol = headers.findIndex((h) => h === 'date' || h === 'posted date' || h === 'transaction date');
  const descCol = headers.findIndex((h) => h === 'description' || h === 'payee' || h === 'merchant name');
  const amtCol = headers.findIndex((h) => h === 'amount');

  if (dateCol === -1 || amtCol === -1) return { transactions: [], skippedRows: lines.length };

  const transactions: ParsedCSVTransaction[] = [];
  let skippedRows = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const fields = parseLine(lines[i]);
    if (fields.length <= Math.max(dateCol, amtCol)) {
      skippedRows++;
      continue;
    }

    const date = parseDate(fields[dateCol] ?? '');
    if (!date) { skippedRows++; continue; }

    const amtStr = (fields[amtCol] ?? '').replace(/[$,\s]/g, '');
    const amount = parseFloat(amtStr);
    if (isNaN(amount)) { skippedRows++; continue; }

    // Use description col if present, otherwise fall back to first non-date/amount col
    let description = descCol !== -1 ? (fields[descCol] ?? '') : '';
    if (!description) {
      description = fields.find((_, idx) => idx !== dateCol && idx !== amtCol) ?? 'Unknown';
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
