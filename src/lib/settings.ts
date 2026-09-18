/**
 * Receipt settings — single owner of the "sabana-receipt-settings" key.
 * Written by admin settings (Struk tab), read by the payment modal preview
 * and the thermal printer.
 */

export interface ReceiptSettings {
  outletName?: string;
  outletAddress?: string;
  outletPhone?: string;
  footer?: string;
  promoText?: string;
  showLogo?: boolean;
  showTime?: boolean;
  showQR?: boolean;
  autoPrint?: boolean;
  paperWidth?: "58" | "80";
}

const KEY = "sabana-receipt-settings";

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  outletName: "SABANA FRIED CHICKEN",
  footer: "Terima kasih!",
  promoText: "",
  showLogo: true,
  showTime: true,
  showQR: false,
  autoPrint: false,
  paperWidth: "58",
};

export function getReceiptSettings(): ReceiptSettings {
  if (typeof window === "undefined") return DEFAULT_RECEIPT_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_RECEIPT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_RECEIPT_SETTINGS;
  } catch {
    return DEFAULT_RECEIPT_SETTINGS;
  }
}

export function saveReceiptSettings(settings: ReceiptSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
