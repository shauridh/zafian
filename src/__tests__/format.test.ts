import { formatRupiah, CASH_DENOMINATIONS } from "@/lib/format";

describe("formatRupiah", () => {
  it("formats zero correctly", () => {
    expect(formatRupiah(0)).toBe("Rp 0");
  });

  it("formats small amounts correctly", () => {
    expect(formatRupiah(5000)).toBe("Rp 5.000");
    expect(formatRupiah(10000)).toBe("Rp 10.000");
    expect(formatRupiah(15000)).toBe("Rp 15.000");
  });

  it("formats large amounts correctly", () => {
    expect(formatRupiah(100000)).toBe("Rp 100.000");
    expect(formatRupiah(350000)).toBe("Rp 350.000");
    expect(formatRupiah(1000000)).toBe("Rp 1.000.000");
  });

  it("formats with custom prefix", () => {
    expect(formatRupiah(5000, "IDR")).toBe("IDR 5.000");
  });
});

describe("CASH_DENOMINATIONS", () => {
  it("has 8 denominations", () => {
    expect(CASH_DENOMINATIONS).toHaveLength(8);
  });

  it("has correct values", () => {
    expect(CASH_DENOMINATIONS.map((d) => d.value)).toEqual([100000, 50000, 20000, 10000, 5000, 2000, 1000, 500]);
  });

  it("has correct labels", () => {
    expect(CASH_DENOMINATIONS[0].label).toBe("100K");
    expect(CASH_DENOMINATIONS[7].label).toBe("500");
  });
});
