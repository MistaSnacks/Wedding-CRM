import { describe, expect, test } from "vitest";
import {
  MoneyParseError,
  centsToInputValue,
  formatDelta,
  formatMoney,
  formatMoneyExact,
  formatMoneySigned,
  formatPercent,
  parseMoneyInput,
  tryParseMoney,
} from "./money";

/**
 * Every number on the budget screens comes out of this module, so a defect
 * here is invisible in code review and glaring on Juliet's dashboard.
 *
 * The label used in the delta tests is deliberately a placeholder. Binding
 * decision 2 requires that the real benchmark wedding's name appear nowhere in
 * `app/`, `components/` or `lib/` — it is a column on `weddings`, not a
 * constant — and a grep does not exempt test files.
 */
const BENCHMARK = "the reference wedding";

/**
 * `formatMoney` is the default renderer, and its two edges are the ones that
 * lie quietly rather than crash: a `null` that renders as `$0` invents a
 * priced-at-nothing line out of an un-priced one, and a `NaN` that renders as
 * `$NaN` makes the whole page look broken. Both must come out as an em dash.
 */
describe("formatMoney", () => {
  test("renders null as an em dash, because 'not priced yet' is not '$0'", () => {
    expect(formatMoney(null)).toBe("—");
  });

  test("renders undefined the same way as null", () => {
    expect(formatMoney(undefined)).toBe("—");
  });

  test("renders an explicit zero as $0 — a real, different answer", () => {
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(0)).not.toBe(formatMoney(null));
  });

  test("hides the cents on a round dollar figure", () => {
    expect(formatMoney(1537000)).toBe("$15,370");
  });

  test("shows exactly two decimals when the cents are not zero", () => {
    expect(formatMoney(1536999)).toBe("$15,369.99");
  });

  test("pads a single-digit cent rather than rendering $10.5", () => {
    expect(formatMoney(1050)).toBe("$10.50");
    expect(formatMoney(5)).toBe("$0.05");
  });

  test("puts a negative sign outside the dollar sign, as an ASCII hyphen", () => {
    expect(formatMoney(-120000)).toBe("-$1,200");
  });

  test("handles a one-cent overspend without losing the sign", () => {
    expect(formatMoney(-1)).toBe("-$0.01");
    expect(formatMoney(1)).toBe("$0.01");
  });

  test("never abbreviates a large amount to $1.25M", () => {
    expect(formatMoney(125000000)).toBe("$1,250,000");
  });

  test("keeps grouping correct past a billion dollars", () => {
    expect(formatMoney(100000000000)).toBe("$1,000,000,000");
  });

  test("renders NaN and both infinities as an em dash, never as $NaN", () => {
    expect(formatMoney(Number.NaN)).toBe("—");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatMoney(Number.NEGATIVE_INFINITY)).toBe("—");
  });

  test("prefixes a bare $, not the locale-dependent US$ that currency mode emits", () => {
    expect(formatMoney(1537000).startsWith("$")).toBe(true);
    expect(formatMoney(1537000)).not.toContain("US$");
  });
});

/**
 * The CSV export and the payment confirmation are the two places where a
 * hidden `.00` reads as a truncated number rather than a tidy one.
 */
describe("formatMoneyExact", () => {
  test("keeps the .00 on a round figure", () => {
    expect(formatMoneyExact(1537000)).toBe("$15,370.00");
  });

  test("matches formatMoney whenever there are real cents", () => {
    expect(formatMoneyExact(1536999)).toBe("$15,369.99");
  });

  test("renders zero and negatives with two decimals too", () => {
    expect(formatMoneyExact(0)).toBe("$0.00");
    expect(formatMoneyExact(-120000)).toBe("-$1,200.00");
  });

  test("still refuses to turn null into a number", () => {
    expect(formatMoneyExact(null)).toBe("—");
    expect(formatMoneyExact(Number.NaN)).toBe("—");
  });
});

/**
 * Deltas are where the sign carries the meaning. "$2,400 over" and "$2,400
 * under" render identically without one, and colour alone is not readable by
 * everyone.
 */
describe("formatMoneySigned", () => {
  test("adds a leading + above zero", () => {
    expect(formatMoneySigned(240000)).toBe("+$2,400");
    expect(formatMoneySigned(1)).toBe("+$0.01");
  });

  test("adds no sign at zero, because a zero delta has no direction", () => {
    expect(formatMoneySigned(0)).toBe("$0");
  });

  test("leaves an existing negative sign alone", () => {
    expect(formatMoneySigned(-120000)).toBe("-$1,200");
  });

  test("renders null as an em dash rather than +—", () => {
    expect(formatMoneySigned(null)).toBe("—");
  });
});

/**
 * The value that goes into a text input. If this does not round-trip through
 * the parser, opening a drawer and saving it untouched changes the number.
 */
describe("centsToInputValue", () => {
  test("gives an empty box for an un-priced line, not a 0 to delete", () => {
    expect(centsToInputValue(null)).toBe("");
    expect(centsToInputValue(undefined)).toBe("");
    expect(centsToInputValue(Number.NaN)).toBe("");
  });

  test("omits the currency symbol and the grouping commas", () => {
    expect(centsToInputValue(1537000)).toBe("15370");
    expect(centsToInputValue(1536999)).toBe("15369.99");
  });

  test("writes sub-dollar amounts with a leading zero", () => {
    expect(centsToInputValue(1)).toBe("0.01");
    expect(centsToInputValue(99)).toBe("0.99");
    expect(centsToInputValue(100)).toBe("1");
    expect(centsToInputValue(0)).toBe("0");
  });

  test("keeps a negative readable and re-parseable", () => {
    expect(centsToInputValue(-50000)).toBe("-500");
  });

  test("round-trips losslessly through parseMoneyInput", () => {
    for (const cents of [0, 1, 99, 100, 1537000, 1536999, -50000, 100000000000]) {
      expect(parseMoneyInput(centsToInputValue(cents))).toBe(cents);
    }
  });
});

/**
 * The parser. Two behaviours here matter more than everything else in the
 * module put together:
 *
 * - blank is `null` and `"0"` is `0`. Collapsing the two turns "we haven't
 *   priced the band yet" into "the band is free", which shows up as a saving
 *   against the benchmark and as a wrong total on the Overview card.
 * - garbage is refused, not coerced. `parseFloat("abc") || 0` would store a
 *   typo as `$0` and nobody would notice until the money was due.
 *
 * The float tests at the bottom exist because `Math.round(parseFloat("1.005")
 * * 100)` is `100`, not `101` — a future "simplification" back to `parseFloat`
 * would pass every other test in this file.
 */
describe("tryParseMoney", () => {
  test("treats a missing value as not-entered, not as zero", () => {
    expect(tryParseMoney(null)).toEqual({ ok: true, cents: null });
    expect(tryParseMoney(undefined)).toEqual({ ok: true, cents: null });
  });

  test("treats an empty or whitespace-only field as not-entered", () => {
    expect(tryParseMoney("")).toEqual({ ok: true, cents: null });
    expect(tryParseMoney("   ")).toEqual({ ok: true, cents: null });
    expect(tryParseMoney("\t\n ")).toEqual({ ok: true, cents: null });
  });

  test("treats a lone dash as not-entered, so the app's own placeholder round-trips", () => {
    expect(tryParseMoney("-")).toEqual({ ok: true, cents: null });
    expect(tryParseMoney("—")).toEqual({ ok: true, cents: null });
    expect(tryParseMoney(" — ")).toEqual({ ok: true, cents: null });
  });

  test("reads a typed zero as a real zero, distinct from blank", () => {
    expect(tryParseMoney("0")).toEqual({ ok: true, cents: 0 });
    expect(tryParseMoney("$0.00")).toEqual({ ok: true, cents: 0 });
    expect(tryParseMoney("0")).not.toEqual(tryParseMoney(""));
  });

  test("normalises a typed -0 to plain zero", () => {
    const result = tryParseMoney("-0");
    expect(result).toEqual({ ok: true, cents: 0 });
    expect(Object.is(result.ok && result.cents, -0)).toBe(false);
  });

  test("strips the dollar sign and the thousands commas people paste", () => {
    expect(tryParseMoney("$15,370")).toEqual({ ok: true, cents: 1537000 });
    expect(tryParseMoney("$1,277")).toEqual({ ok: true, cents: 127700 });
    expect(tryParseMoney("1,277.50")).toEqual({ ok: true, cents: 127750 });
  });

  test("tolerates surrounding whitespace from a sloppy copy-paste", () => {
    expect(tryParseMoney("   $1,277   ")).toEqual({ ok: true, cents: 127700 });
  });

  test("treats ordinary, non-breaking and narrow no-break spaces as separators", () => {
    // U+00A0 and U+202F are what a figure copied out of a formatted spreadsheet
    // or a web page actually contains; a plain-space-only strip lets them
    // through and the whole amount is then rejected as garbage.
    expect(tryParseMoney("1 234")).toEqual({ ok: true, cents: 123400 });
    expect(tryParseMoney("1\u00A0234")).toEqual({ ok: true, cents: 123400 });
    expect(tryParseMoney("1\u202F234.50")).toEqual({ ok: true, cents: 123450 });
  });

  test("accepts the sign on either side of the dollar sign", () => {
    expect(tryParseMoney("-$500")).toEqual({ ok: true, cents: -50000 });
    expect(tryParseMoney("$-500")).toEqual({ ok: true, cents: -50000 });
  });

  test("accepts the leading + that formatMoneySigned produces", () => {
    expect(tryParseMoney("+$2,400")).toEqual({ ok: true, cents: 240000 });
  });

  test("pads a single decimal place instead of reading it as cents", () => {
    expect(tryParseMoney("15370.5")).toEqual({ ok: true, cents: 1537050 });
    expect(tryParseMoney("15370.50")).toEqual({ ok: true, cents: 1537050 });
    expect(tryParseMoney(".5")).toEqual({ ok: true, cents: 50 });
  });

  test("refuses a third decimal place rather than silently rounding money", () => {
    expect(tryParseMoney("15370.005")).toEqual({
      ok: false,
      message: "Amounts can only go to the cent.",
    });
    expect(tryParseMoney("12.345")).toEqual({
      ok: false,
      message: "Amounts can only go to the cent.",
    });
  });

  test("refuses garbage instead of coercing it to zero", () => {
    for (const raw of ["abc", "$", "1.2.3", "12e5", "--5", "1,2,3.4.5", ".", "5-", "1-2", "4o0"]) {
      expect(tryParseMoney(raw)).toEqual({
        ok: false,
        message: "That doesn't look like an amount.",
      });
    }
  });

  test("a lone $ is a half-typed amount, not a blank field", () => {
    expect(tryParseMoney("$")).toEqual({ ok: false, message: "That doesn't look like an amount." });
    expect(tryParseMoney("$").ok).not.toBe(tryParseMoney("").ok);
  });

  test("accepts exactly one billion dollars and refuses anything above it", () => {
    expect(tryParseMoney("$1,000,000,000")).toEqual({ ok: true, cents: 100000000000 });
    const typo = { ok: false, message: "That's larger than any wedding budget — check for a typo." };
    expect(tryParseMoney("1000000001")).toEqual(typo);
    expect(tryParseMoney("1000000000.01")).toEqual(typo);
    expect(tryParseMoney("-1000000001")).toEqual(typo);
  });

  test("is string arithmetic, not parseFloat — 1.005 is refused, never 100 cents", () => {
    // parseFloat("1.005") * 100 === 100.49999999999999, so the tempting
    // one-liner both accepts this and silently loses half a cent.
    const result = tryParseMoney("1.005");
    expect(result.ok).toBe(false);
    expect(result).not.toEqual({ ok: true, cents: 100 });
  });

  test("is exact on the classic binary-fraction cases", () => {
    expect(tryParseMoney("0.29")).toEqual({ ok: true, cents: 29 });
    expect(tryParseMoney("1.10")).toEqual({ ok: true, cents: 110 });
    expect(tryParseMoney("0.07")).toEqual({ ok: true, cents: 7 });
    expect(tryParseMoney("8.20")).toEqual({ ok: true, cents: 820 });
  });
});

/**
 * The throwing wrapper, for `lib/data/*` internals where a bad value is a
 * programming error rather than something a person just typed.
 */
describe("parseMoneyInput", () => {
  test("returns the cents for a good value", () => {
    expect(parseMoneyInput("$15,370")).toBe(1537000);
    expect(parseMoneyInput("0")).toBe(0);
  });

  test("returns null for blank rather than throwing — blank is a value", () => {
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("   ")).toBeNull();
    expect(parseMoneyInput("-")).toBeNull();
    expect(parseMoneyInput(null)).toBeNull();
  });

  test("throws a MoneyParseError carrying the copy the UI would show", () => {
    expect(() => parseMoneyInput("abc")).toThrow(MoneyParseError);
    expect(() => parseMoneyInput("abc")).toThrow("That doesn't look like an amount.");
    expect(() => parseMoneyInput("1.005")).toThrow("Amounts can only go to the cent.");
    expect(() => parseMoneyInput("1000000001")).toThrow("check for a typo");
  });

  test("round-trips everything formatMoney can produce", () => {
    for (const cents of [0, 1, -1, 99, 127700, 1536999, 1537000, -120000, 125000000, 100000000000]) {
      expect(parseMoneyInput(formatMoney(cents))).toBe(cents);
    }
  });

  test("round-trips the em dash that formatMoney gives a null back to null", () => {
    expect(parseMoneyInput(formatMoney(null))).toBeNull();
  });

  test("round-trips a signed delta string", () => {
    for (const cents of [240000, -120000, 0]) {
      expect(parseMoneyInput(formatMoneySigned(cents))).toBe(cents);
    }
  });
});

/**
 * Percentages on cards. Whole numbers only — the underlying figures are vendor
 * estimates, and "18.4%" claims a precision they do not have.
 */
describe("formatPercent", () => {
  test("renders a missing fraction as an em dash", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
  });

  test("renders a division-by-zero result as an em dash, never Infinity%", () => {
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });

  test("rounds to a whole percent", () => {
    expect(formatPercent(0.184)).toBe("18%");
    expect(formatPercent(0.186)).toBe("19%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
  });

  test("adds a + only when asked and only above zero", () => {
    expect(formatPercent(0.184, { signed: true })).toBe("+18%");
    expect(formatPercent(0, { signed: true })).toBe("0%");
    expect(formatPercent(-0.05, { signed: true })).toBe("-5%");
  });

  test("keeps the minus sign without being asked", () => {
    expect(formatPercent(-0.05)).toBe("-5%");
  });

  test("rounds away from zero symmetrically, so over and under match", () => {
    // Math.round alone sends 18.5 to 19 and -18.5 to -18, which makes an
    // over-budget figure look a point better than the mirrored under-budget one.
    expect(formatPercent(0.005)).toBe("1%");
    expect(formatPercent(-0.005)).toBe("-1%");
  });

  test("never renders a negative zero", () => {
    expect(formatPercent(-0.001)).toBe("0%");
    expect(formatPercent(-0.001, { signed: true })).toBe("0%");
  });
});

/**
 * The benchmark comparison — the feature the budget page is built around.
 *
 * The two dangerous cases are an un-priced side (which must read "unknown",
 * not "100% under", or every line nobody has quoted yet becomes an imaginary
 * saving) and a zero benchmark (where the percentage is a division by zero and
 * has to be dropped rather than rendered as Infinity).
 */
describe("formatDelta", () => {
  test("reports unknown when either side has not been priced", () => {
    const unknown = { text: "—", pct: null, tone: "unknown" };
    expect(formatDelta(null, 500000, BENCHMARK)).toEqual(unknown);
    expect(formatDelta(500000, null, BENCHMARK)).toEqual(unknown);
    expect(formatDelta(null, null, BENCHMARK)).toEqual(unknown);
    expect(formatDelta(undefined, undefined, BENCHMARK)).toEqual(unknown);
  });

  test("does not treat an un-priced line as a saving", () => {
    expect(formatDelta(500000, null, BENCHMARK).tone).not.toBe("under");
  });

  test("says 'same' when the two match exactly", () => {
    expect(formatDelta(500000, 500000, BENCHMARK)).toEqual({
      text: "same",
      pct: "0%",
      tone: "even",
    });
    expect(formatDelta(0, 0, BENCHMARK).tone).toBe("even");
  });

  test("names the overspend, the percentage and the direction", () => {
    expect(formatDelta(810100, 1539200, BENCHMARK)).toEqual({
      text: `+$7,291 over ${BENCHMARK}`,
      pct: "+90%",
      tone: "over",
    });
  });

  test("names the underspend the same way", () => {
    expect(formatDelta(127700, 0, BENCHMARK)).toEqual({
      text: `-$1,277 under ${BENCHMARK}`,
      pct: "-100%",
      tone: "under",
    });
  });

  test("drops the percentage rather than dividing by a zero benchmark", () => {
    const delta = formatDelta(0, 50000, BENCHMARK);
    expect(delta).toEqual({
      text: `+$500 (${BENCHMARK} spent nothing)`,
      pct: null,
      tone: "over",
    });
    expect(JSON.stringify(delta)).not.toContain("Infinity");
    expect(JSON.stringify(delta)).not.toContain("NaN");
  });

  test("takes the benchmark's name from the caller, never from a constant", () => {
    // `weddings.budget_benchmark_label` is renameable, and no real person's
    // name belongs in a product sold to other couples.
    expect(formatDelta(100000, 200000, "Sam and Ada's wedding").text).toBe(
      "+$1,000 over Sam and Ada's wedding",
    );
    expect(formatDelta(100000, 200000, "Reference wedding").text).toBe(
      "+$1,000 over Reference wedding",
    );
  });

  test("falls back to a generic label when the caller has no wedding row yet", () => {
    expect(formatDelta(100000, 200000).text).toBe("+$1,000 over the benchmark");
  });
});
