/**
 * OFX / QFX Parser
 *
 * Supports both legacy SGML-style OFX (most bank exports) and XML-style OFX 2.x.
 * Extracts STMTTRN blocks and normalizes them into ParsedTransaction objects.
 *
 * OFX TRNTYPE values: DEBIT, CREDIT, INT, DIV, FEE, SRVCHG, DEP, ATM, POS,
 *   XFER, CHECK, PAYMENT, CASH, DIRECTDEP, DIRECTDEBIT, REPEATPMT, OTHER
 */

export interface ParsedTransaction {
  fitId: string;
  date: Date;
  amount: number;
  description: string;
  memo: string | null;
  transactionType: string | null;
}

export interface OFXParseResult {
  transactions: ParsedTransaction[];
  accountId: string | null;
  currency: string | null;
}

/**
 * Extract a tag value from OFX SGML. Returns the value between <TAG> and the
 * next closing tag or start of next sibling tag. OFX SGML does not require
 * closing tags for leaf elements.
 */
function extractLeaf(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<]*)`, 'i');
  const m = re.exec(block);
  return m ? m[1].trim() : null;
}

/**
 * Parse an OFX date string into a JS Date.
 * Formats: YYYYMMDD, YYYYMMDDHHMMSS, YYYYMMDDHHMMSS.XXX[offset:tz]
 */
function parseOFXDate(raw: string): Date {
  const digits = raw.replace(/[^0-9]/g, '');
  const year = parseInt(digits.slice(0, 4), 10);
  const month = parseInt(digits.slice(4, 6), 10) - 1;
  const day = parseInt(digits.slice(6, 8), 10);
  return new Date(Date.UTC(year, month, day));
}

/**
 * Extract all STMTTRN blocks from an OFX document (handles both SGML and XML).
 */
function extractTrnBlocks(raw: string): string[] {
  const blocks: string[] = [];
  // Match both self-closing XML <STMTTRN>...</STMTTRN> and SGML (no closing tag)
  const xmlRe = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match: RegExpExecArray | null;

  // Try XML style first
  let found = false;
  while ((match = xmlRe.exec(raw)) !== null) {
    blocks.push(match[1]);
    found = true;
  }
  if (found) return blocks;

  // SGML style: split on <STMTTRN> and take up to next <STMTTRN> or </BANKTRANLIST>
  const parts = raw.split(/<STMTTRN>/i);
  for (let i = 1; i < parts.length; i++) {
    const end = parts[i].search(/<\/?STMTTRN>|<\/BANKTRANLIST>/i);
    blocks.push(end === -1 ? parts[i] : parts[i].slice(0, end));
  }
  return blocks;
}

export function parseOFX(content: string): OFXParseResult {
  // Strip OFX header section (lines before the first <OFX> or <ofx> tag)
  const ofxStart = content.search(/<OFX>/i);
  const body = ofxStart !== -1 ? content.slice(ofxStart) : content;

  const accountId = extractLeaf(body, 'ACCTID');
  const currency = extractLeaf(body, 'CURDEF');

  const blocks = extractTrnBlocks(body);
  const transactions: ParsedTransaction[] = [];

  for (const block of blocks) {
    const fitId = extractLeaf(block, 'FITID');
    const dateRaw = extractLeaf(block, 'DTPOSTED');
    const amountRaw = extractLeaf(block, 'TRNAMT');
    const name = extractLeaf(block, 'NAME');
    const memo = extractLeaf(block, 'MEMO');
    const trnType = extractLeaf(block, 'TRNTYPE');

    if (!fitId || !dateRaw || amountRaw === null) continue;

    const amount = parseFloat(amountRaw);
    if (isNaN(amount)) continue;

    transactions.push({
      fitId,
      date: parseOFXDate(dateRaw),
      amount,
      description: name ?? memo ?? 'Unknown',
      memo: memo ?? null,
      transactionType: trnType,
    });
  }

  return { transactions, accountId, currency };
}
