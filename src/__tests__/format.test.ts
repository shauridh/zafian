import { formatRupiah, DENOMINATIONS } from "@/lib/format";

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

describe("DENOMINATIONS", () => {
  it("has 8 denominations", () => {
    expect(DENOMINATIONS).toHaveLength(8);
  });

  it("has correct values", () => {
    expect(DENOMINATIONS[0].value).toBe(100000);
    expect(DENOMINATIONS[1].value).toBe(50000);
    expect(DENOMINATIONS[2].value).toBe(20000);
    expect(DENOMINATIONS[3].value).toBe(10000);
    expect(DENOMINATIONS[4].value).toBe(5000);
    expect(DENOMINATIONS[5].value).toBe(2000);
    expect(DENOMINATIONS[6].value).toBe(1000);
    expect(DENOMINATIONS[7].value).toBe(500);
  });

  it("has correct labels", () => {
    expect(DENOMINATIONS[0].label).toBe("100.000");
    expect(DENOMINATIONS[7].label).toBe("500");
  });
});
