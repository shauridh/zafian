/**
 * Receipt formatting — single source of truth.
 * Used by the on-screen receipt preview (PaymentReceiptModal)
 * and the ESC/POS thermal printer (lib/printer.ts).
 *
 * Layout rules:
 * - Money lines (items, Subtotal/TOTAL/BAYAR/KEMBALIAN) and every separator
 *   are exactly `w` chars (32 = 58mm, 48 = 80mm), so their LEFT and RIGHT
 *   edges align pixel-perfect with each other.
 * - Info lines (date, order no, kasir, mode, metode) carry the same 2-space
 *   left margin but end naturally — they are metadata, not table rows.
 * - Centered lines are also indented 2 spaces so text optically aligns with
 *   the info lines' left edge.
 * - Trailing whitespace is trimmed; no line exceeds w.
 */

export interface ReceiptData {
  items: { name: string; qty: number; price: number }[];
  subtotal: number;
  discount?: number;
  total: number;
  amountPaid: number;
  change: number;
  paymentMethod: string; // "cash" | "qris" | "estimate" | ...
  cashierName: string;
  serviceMode: string; // already-localized label
  orderNumber: string;
  date: string; // pre-formatted date string
  outletName?: string;
  outletAddress?: string;
  outletPhone?: string;
  footer?: string;
}

export const RECEIPT_WIDTH_58 = 32; // 58mm ≈ 32 chars; 80mm ≈ 48

const MARGIN = "  ";

/**
 * Glyphs whose width ≠ 1 monospace column. Emoji render ~1.1–2 cols in web
 * fonts and 2 cols on thermal printers; ellipsis and NBSP also vary.
 * We strip them from width-critical (money/separator) lines and neutralize
 * them elsewhere so every consumer measures the same string.
 */
// eslint-disable-next-line no-misleading-character-class -- unicode property ranges need the u flag
const WIDE_GLYPHS = new RegExp("[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{FE0F}\\u{00A0}\\u{2026}]", "gu");
const stripWide = (s: string): string => s.replace(WIDE_GLYPHS, "").trimEnd();

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/** Truncate with ellipsis, never exceeding width. */
function trunc(s: string, w: number): string {
  return s.length > w ? s.slice(0, w - 1) + "\u2026" : s;
}

/** Left/right split on ONE line: left truncated, right flush to column w. */
function splitLine(left: string, right: string, w: number): string {
  const maxLeft = Math.max(0, w - right.length);
  const l = trunc(left, maxLeft);
  const pad = Math.max(1, w - l.length - right.length);
  return (l + " ".repeat(pad) + right).slice(0, w);
}

/**
 * Build receipt lines as monospace text.
 * w = character width (32 for 58mm, 48 for 80mm).
 */
export function buildReceiptLines(d: ReceiptData, w: number = RECEIPT_WIDTH_58): string[] {
  const sep = (c: string) => c.repeat(w);
  /** Centered but indented by the universal 2-space margin. */
  const center = (s: string) => {
    const t = trunc(s, w - MARGIN.length);
    const lead = Math.floor((w - MARGIN.length - t.length) / 2);
    return (MARGIN + " ".repeat(lead) + t).trimEnd();
  };
  /** Label in a fixed 11-char left column, value flush right. */
  const row = (label: string, value: string) =>
    splitLine(trunc(MARGIN + label + ":", w - value.length), value, w);

  const method = (d.paymentMethod || "").toUpperCase();
  const methodLabel = method === "CASH" ? "TUNAI" : method === "ESTIMATE" ? "ESTIMASI" : method;
  const footerText = stripWide(d.footer || "Terima kasih!");
  const lines: string[] = [];

  const trimEnd = (s: string) => s.trimEnd();

  lines.push(sep("="));
  lines.push(center(d.outletName || "SABANA FRIED CHICKEN"));
  if (d.outletAddress) lines.push(center(d.outletAddress));
  if (d.outletPhone) lines.push(center(`Telp: ${d.outletPhone}`));

  lines.push(sep("-"));
  lines.push(trimEnd(MARGIN + trunc(d.date, w - MARGIN.length)));
  lines.push(trimEnd(MARGIN + trunc(d.orderNumber, w - MARGIN.length)));
  lines.push(trimEnd(MARGIN + `Kasir: ${trunc(d.cashierName || "Kasir", w - MARGIN.length - 8)}`));
  lines.push(trimEnd(MARGIN + trunc(d.serviceMode, w - MARGIN.length)));

  lines.push(sep("-"));
  for (const i of d.items) {
    lines.push(splitLine(`${i.qty}x ${i.name}`, rp(i.price * i.qty), w));
  }

  lines.push(sep("-"));
  lines.push(row("Subtotal", rp(d.subtotal)));
  if (d.discount && d.discount > 0) {
    lines.push(row("Diskon", `-${rp(d.discount)}`));
  }
  lines.push(row("TOTAL", rp(d.total)));
  lines.push(row("BAYAR", rp(d.amountPaid)));
  lines.push(row("KEMBALIAN", rp(d.change)));

  lines.push(sep("-"));
  lines.push(trimEnd(MARGIN + `Metode: ${methodLabel}`));
  lines.push(sep("="));

  lines.push(center(footerText));
  lines.push(center("Sabana Fried Chicken"));

  return lines;
}
