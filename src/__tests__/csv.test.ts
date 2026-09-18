import { csvToObjects, parseCsv } from "@/lib/csv";

describe("CSV helpers", () => {
  it("parses quoted commas and new lines", () => {
    expect(parseCsv('name,supplier\n"Tepung, Premium","Supplier A"')).toEqual([
      ["name", "supplier"],
      ["Tepung, Premium", "Supplier A"],
    ]);
  });

  it("maps rows to normalized header keys", () => {
    expect(csvToObjects("Name,Purchase_Price\nTepung,14000")).toEqual([
      { name: "Tepung", purchase_price: "14000" },
    ]);
  });
});
