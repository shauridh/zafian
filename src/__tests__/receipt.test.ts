import { buildReceiptLines } from "@/lib/receipt";

describe("receipt formatter", () => {
  const base = {
    items: [{ name: "Ayam", qty: 1, price: 10000 }],
    subtotal: 10000,
    total: 10000,
    amountPaid: 10000,
    change: 0,
    paymentMethod: "cash",
    cashierName: "Sabana",
    serviceMode: "Dine In",
    orderNumber: "1",
    date: "18/09/2026 10:00",
  };

  it("wraps long outlet address without exceeding receipt width", () => {
    const lines = buildReceiptLines({ ...base, outletName: "SABANA FRIED CHICKEN OUTLET UTAMA", outletAddress: "Jl. Panjang Sekali Nomor 123 Kecamatan Setiabudi Jakarta Selatan" }, 32);
    expect(lines.every((line) => line.length <= 32)).toBe(true);
    expect(lines.some((line) => line.includes("Kecamatan"))).toBe(true);
  });

  it("places configurable promo before the footer", () => {
    const lines = buildReceiptLines({ ...base, promoText: "Promo hemat hari ini" }, 32);
    const promoIndex = lines.findIndex((line) => line.includes("Promo hemat hari ini"));
    const footerIndex = lines.findIndex((line) => line.includes("Terima kasih"));
    expect(promoIndex).toBeGreaterThan(-1);
    expect(promoIndex).toBeLessThan(footerIndex);
  });
});
