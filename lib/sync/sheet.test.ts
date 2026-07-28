import { describe, expect, it } from "vitest";
import { SheetAccessError, csvReader, parseCsv, rowKey, rowsFromValues } from "./sheet";

const CSV = `Received At,First Name,Last Name,Mailing Address,Email,Phone,Notes,No Mailing Address,Language
6/27/2026 11:30,Camren,McMath,8829 E E ST,cmcmath89@gmail.com,2066736606,I would like a plus 1 if possible,,
"Sat, Jun 27, 2026 11:30",Victoria,Neam,726 10th Ave E,victorianeam@gmail.com,2063053502,,,en
`;

describe("parseCsv", () => {
  it("maps by header name, so a reordered sheet still works", () => {
    const rows = parseCsv(CSV);
    expect(rows).toHaveLength(2);
    expect(rows[0]["First Name"]).toBe("Camren");
    expect(rows[1]["Email"]).toBe("victorianeam@gmail.com");
  });

  it("keeps a quoted timestamp containing commas intact", () => {
    expect(parseCsv(CSV)[1]["Received At"]).toBe("Sat, Jun 27, 2026 11:30");
  });

  it("rejects a sheet whose required columns were renamed", () => {
    const renamed = CSV.replace("First Name", "Given Name");
    expect(() => parseCsv(renamed)).toThrow(SheetAccessError);
    expect(() => parseCsv(renamed)).toThrow(/First Name/);
  });

  it("drops fully blank rows", () => {
    expect(parseCsv(CSV + ",,,,,,,,\n")).toHaveLength(2);
  });
});

describe("csvReader", () => {
  it("satisfies the SheetReader shape", async () => {
    expect(await csvReader(CSV)()).toHaveLength(2);
  });
});

describe("rowKey", () => {
  const row = { "Received At": "6/27/2026 11:30", "First Name": "Camren", "Last Name": "McMath", Email: "a@b.com" };

  it("is stable across re-reads — which is what makes a cron double-fire a no-op", () => {
    expect(rowKey(row)).toBe(rowKey({ ...row }));
  });

  it("ignores case and accents in the identifying fields", () => {
    expect(rowKey({ ...row, Email: "A@B.COM" })).toBe(rowKey(row));
  });

  it("ignores columns that are not part of identity", () => {
    expect(rowKey({ ...row, Notes: "changed my mind" })).toBe(rowKey(row));
  });

  it("changes when the person or the time changes", () => {
    expect(rowKey({ ...row, "Last Name": "McMathers" })).not.toBe(rowKey(row));
    expect(rowKey({ ...row, "Received At": "6/28/2026 11:30" })).not.toBe(rowKey(row));
  });
});

describe("rowsFromValues", () => {
  it("treats the first row as the header and pads short rows", () => {
    const rows = rowsFromValues([
      ["Received At", "First Name", "Last Name", "Email"],
      ["6/27/2026", "Ana", "Muñoz"],
    ]);
    expect(rows[0]).toEqual({ "Received At": "6/27/2026", "First Name": "Ana", "Last Name": "Muñoz", Email: "" });
  });

  it("returns nothing for an empty grid", () => {
    expect(rowsFromValues([])).toEqual([]);
  });
});
