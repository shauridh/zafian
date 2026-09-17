/**
 * Receipt formatting — single source of truth.
 * Used by the on-screen receipt preview (PaymentReceiptModal)
 * and the ESC/POS thermal printer (lib/printer.ts).
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

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/** Truncate with ellipsis, never exceeding width. */
function trunc(s: string, w: number): string {
  return s.length > w ? s.slice(0, w - 1) + "\u2026" : s;
}

/** Left/right split line: "1x Burger        Rp 12.000" */
function padLine(left: string, right: string, w: number): string {
  const maxLeft = w - right.length - 1;
  const l = trunc(left, Math.max(1, maxLeft));
  const pad = Math.max(1, w - l.length - right.length);
  return `${l}${" ".repeat(pad)}${right}`;
}

/** Label/value line with colon: "  TOTAL:          Rp 27.000" */
function labelLine(label: string, value: string, w: number): string {
  return padLine(`  ${label}:`, value, w);
}

/**
 * Build receipt lines as monospace text.
 * w = character width (32 for 58mm, 48 for 80mm).
 */
export function buildReceiptLines(d: ReceiptData, w: number = RECEIPT_WIDTH_58): string[] {
  const sep = (c: string) => c.repeat(w);
  const center = (s: string) => {
    const t = trunc(s, w);
    const lead = Math.max(0, Math.floor((w - t.length) / 2));
    return " ".repeat(lead) + t;
  };

  const method = (d.paymentMethod || "").toUpperCase();
  const lines: string[] = [];

  lines.push(sep("="));
  lines.push(center(d.outletName || "SABANA FRIED CHICKEN"));
  if (d.outletAddress) lines.push(center(d.outletAddress));
  if (d.outletPhone) lines.push(center(`Telp: ${d.outletPhone}`));

  lines.push(sep("-"));
  lines.push(`  ${trunc(d.date, w - 2)}`);
  lines.push(`  ${trunc(d.orderNumber, w - 2)}`);
  lines.push(`  Kasir: ${trunc(d.cashierName || "Kasir", w - 9)}`);
  lines.push(`  ${trunc(d.serviceMode, w - 2)}`);

  lines.push(sep("-"));
  for (const i of d.items) {
    lines.push(padLine(`${i.qty}x ${i.name}`, rp(i.price * i.qty), w));
  }

  lines.push(sep("-"));
  lines.push(labelLine("Subtotal", rp(d.subtotal), w));
  if (d.discount && d.discount > 0) {
    lines.push(labelLine("Diskon", `-${rp(d.discount)}`, w));
  }
  lines.push(labelLine("TOTAL", rp(d.total), w));
  lines.push(labelLine("BAYAR", rp(d.amountPaid), w));
  lines.push(labelLine("KEMBALIAN", rp(d.change), w));

  lines.push(sep("-"));
  lines.push(`  Metode: ${method}`);
  lines.push(sep("="));

  lines.push(center(d.footer || "Terima kasih!"));
  lines.push(center("Sabana Fried Chicken"));

  return lines;
}
