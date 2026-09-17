// Format number as Indonesian Rupiah (plain space, locale-stable separators)
export function formatRupiah(amount: number, prefix = "Rp"): string {
  return `${prefix} ${Math.round(amount).toLocaleString("id-ID")}`;
}

// Format number with thousand separators (no currency symbol)
export function formatNumber(num: number): string {
  return new Intl.NumberFormat("id-ID").format(num);
}

// Format date to Indonesian locale
export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

// Format time
export function formatTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

// Format datetime
export function formatDateTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return `${formatDate(d)} ${formatTime(d)}`;
}

// Get order number prefix
export function getOrderPrefix(serviceMode: string): string {
  const prefixes: Record<string, string> = {
    dine_in: "DIN",
    take_away: "TAW",
    gofood: "GOF",
    grabfood: "GRA",
    shopeefood: "SHO",
    delivery: "DEL",
  };
  return prefixes[serviceMode] || "ORD";
}

// Generate order number
export function generateOrderNumber(orderNumber: number, serviceMode: string): string {
  const prefix = getOrderPrefix(serviceMode);
  const date = new Date();
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return `#${prefix}-${dateStr}-${String(orderNumber).padStart(4, "0")}`;
}

// Service mode labels
export const SERVICE_MODE_LABELS: Record<string, string> = {
  dine_in: "Dine In",
  take_away: "Take Away",
  gofood: "GoFood",
  grabfood: "GrabFood",
  shopeefood: "ShopeeFood",
  delivery: "Delivery",
};

// Service mode colors
export const SERVICE_MODE_COLORS: Record<string, string> = {
  dine_in: "#16A34A",
  take_away: "#EA580C",
  gofood: "#E11D48",
  grabfood: "#00B14F",
  shopeefood: "#EE4D2D",
  delivery: "#2563EB",
};

// Cash denomination helper
export const CASH_DENOMINATIONS = [
  { value: 100000, label: "100K" },
  { value: 50000, label: "50K" },
  { value: 20000, label: "20K" },
  { value: 10000, label: "10K" },
  { value: 5000, label: "5K" },
  { value: 2000, label: "2K" },
  { value: 1000, label: "1K" },
  { value: 500, label: "500" },
];

// Calculate expected cash from shift
export function calculateExpectedCash(
  openingFloat: number,
  totalCashSales: number,
  totalCashExpenses: number
): number {
  return openingFloat + totalCashSales - totalCashExpenses;
}

// Calculate cash difference
export function calculateCashDiff(actualCash: number, expectedCash: number): number {
  return actualCash - expectedCash;
}
