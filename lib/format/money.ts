/**
 * The only place in the app that turns cents into text or text into cents.
 *
 * Every money column in this schema is a `bigint` of integer cents. That is
 * deliberate: a wedding budget is added up dozens of times per page render, and
 * floating-point dollars drift — `0.1 + 0.2` is famously not `0.3`, and a
 * fifteen-line category rollup can end up a cent or two off the sum of its own
 * children. Cents in, cents out; the only place a decimal point exists is in
 * the string a human reads or types.
 *
 * Two rules run through the whole file:
 *
 * 1. **`null` is not `0`.** A null amount means "we have not priced this yet";
 *    a zero means "we priced it and it is free". They render differently (`—`
 *    versus `$0`) and they behave differently in a delta. Conflating them turns
 *    every un-priced line into an imaginary saving and quietly distorts the
 *    benchmark comparison the whole budget page is built around.
 * 2. **Garbage is refused, never coerced.** `Number("abc")` is `NaN` and
 *    `parseFloat("abc") || 0` is `0`. A typo silently becoming `$0` is far
 *    worse than an error message: the error gets fixed in five seconds, the
 *    zero survives until someone reconciles a bank statement.
 *
 * No `Intl.NumberFormat` currency mode anywhere here — it emits `US$` under
 * some locales and `$` under others, so the `$` is prefixed by hand and only
 * the grouping is delegated to `Intl`.
 *
 * Pattern-mate: `lib/format/wedding-date.ts`.
 */

/** U+2014. The one glyph that means "no amount recorded" across the budget UI. */
const EM_DASH = "—";

/**
 * $1,000,000,000, in cents — the largest amount that can be typed in.
 *
 * Not a technical limit (a `bigint` column and a JS safe integer both hold far
 * more) but a typo guard. Nobody's wedding costs a billion dollars, so a number
 * that large is a stuck key or a paste of an account number, and accepting it
 * would blow out every bar chart on the page.
 */
const MAX_MONEY_CENTS = 100_000_000_000;

/** Grouping only — the `$`, the sign and the decimals are assembled by hand. */
const GROUPED = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Thrown by `parseMoneyInput` when the text is not an amount. Carries UI copy. */
export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyParseError";
  }
}

/**
 * The result of reading a human-typed amount.
 *
 * `ok: true` with `cents: null` is a real success — the field was left blank,
 * which is a legitimate "not priced yet" and must not be reported as an error
 * nor stored as `0`.
 */
export type MoneyParse = { ok: true; cents: number | null } | { ok: false; message: string };

/** Which side of the benchmark an amount falls on. `"unknown"` when either side is un-priced. */
export type DeltaTone = "over" | "under" | "even" | "unknown";

/** A benchmark comparison, ready to render: the words, the percentage, and the colour. */
export type MoneyDelta = { text: string; pct: string | null; tone: DeltaTone };

/**
 * Split cents into whole dollars and the 0–99 remainder, without touching a float.
 *
 * `Math.abs(c) / 100` looks equivalent and is not: for a non-round amount the
 * quotient is a double that may sit a hair either side of the true value, and
 * `toFixed(2)` on it can round the wrong way at the half-cent. Integer division
 * and `%` are exact for every value a `bigint` cents column can realistically
 * hold, so the two halves are assembled as strings instead.
 */
function splitCents(cents: number): { dollars: number; remainder: number } {
  const abs = Math.abs(cents);
  return { dollars: Math.floor(abs / 100), remainder: abs % 100 };
}

/**
 * `null` for anything that must render as `—`: absent, `NaN`, or `±Infinity`.
 *
 * `NaN` reaches here more often than it should — it is what a division by a
 * zero denominator or a `Number(undefined)` produces upstream — and `"$NaN"` on
 * the couple's dashboard reads as a broken app. Rendering `—` is honest: we do
 * not have a number for this.
 */
function usableCents(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  if (!Number.isFinite(cents)) return null;
  // Display-only rounding. Storage is always integer cents; this exists so a
  // value that arrived through some upstream arithmetic cannot render as
  // "$15,370.005".
  return Math.round(cents);
}

/** `-$1,200`, `$15,370`, `$15,369.99` — sign outside the `$`, ASCII hyphen. */
function render(cents: number, alwaysTwoDecimals: boolean): string {
  const { dollars, remainder } = splitCents(cents);
  const sign = cents < 0 ? "-" : "";
  const decimals =
    alwaysTwoDecimals || remainder !== 0 ? `.${String(remainder).padStart(2, "0")}` : "";
  return `${sign}$${GROUPED.format(dollars)}${decimals}`;
}

/**
 * The default way to show an amount: `1537000` → `"$15,370"`.
 *
 * Cents are hidden when they are zero, because a budget page is a wall of
 * numbers and a column of `.00`s is noise that makes the real cents harder to
 * spot. When there *are* cents they are always shown in full — rounding
 * `$15,369.99` up to `$15,370` on screen makes the page disagree with the
 * arithmetic behind it and invites someone to "fix" the total.
 *
 * `null` is `—`, never `$0`. See the module docblock: the distinction between
 * "not priced yet" and "costs nothing" is the one this whole file protects.
 *
 * Never abbreviates. `$1.25M` saves eleven characters and costs the reader the
 * ability to check the number against a contract.
 */
export function formatMoney(cents: number | null | undefined): string {
  const value = usableCents(cents);
  if (value === null) return EM_DASH;
  return render(value, false);
}

/**
 * Always two decimal places: `1537000` → `"$15,370.00"`.
 *
 * For the two places where a hidden `.00` would be read as truncation rather
 * than tidiness: the CSV export (where a spreadsheet column of mixed precision
 * looks like corrupted data) and the "you are about to record a payment of X"
 * confirmation, where the exact figure is the thing being confirmed.
 */
export function formatMoneyExact(cents: number | null | undefined): string {
  const value = usableCents(cents);
  if (value === null) return EM_DASH;
  return render(value, true);
}

/**
 * `formatMoney` with an explicit `+` on positive amounts: `240000` → `"+$2,400"`.
 *
 * Used for deltas, where the sign *is* the message. Without a leading `+`,
 * "$2,400 over the benchmark" and "$2,400 under" render identically and the
 * reader has to find the direction in surrounding prose or a colour — and
 * colour alone is not something everyone can read.
 *
 * Zero gets no sign: `"+$0"` implies a direction that a zero delta does not
 * have. Negatives keep the plain ASCII hyphen from `formatMoney` rather than a
 * typographic minus, so the string survives a copy-paste into a spreadsheet.
 */
export function formatMoneySigned(cents: number | null | undefined): string {
  const value = usableCents(cents);
  if (value === null) return EM_DASH;
  return value > 0 ? `+${render(value, false)}` : render(value, false);
}

/**
 * The bare number for a text input's `value`: `1537000` → `"15370"`.
 *
 * No `$`, no grouping commas, so that what the field shows is exactly what
 * `parseMoneyInput` will read back — the round trip has to be lossless or an
 * untouched field re-saves as a different number. (Grouping *is* tolerated on
 * the way in, because people paste `"$15,370"`; it is just never produced
 * here.) `null` gives `""`, so an un-priced line opens as an empty box rather
 * than as a `0` the user has to notice and delete.
 */
export function centsToInputValue(cents: number | null | undefined): string {
  const value = usableCents(cents);
  if (value === null) return "";
  const { dollars, remainder } = splitCents(value);
  const sign = value < 0 ? "-" : "";
  const decimals = remainder !== 0 ? `.${String(remainder).padStart(2, "0")}` : "";
  return `${sign}${dollars}${decimals}`;
}

/**
 * Read a human-typed amount, refusing anything that is not one.
 *
 * Returns a result rather than throwing so a server action can attach the
 * message to the offending field instead of failing the whole form.
 *
 * **The arithmetic is deliberately string-based and `parseFloat` is banned in
 * this function.** `Math.round(parseFloat("1.005") * 100)` is `100`, not `101`,
 * because `parseFloat("1.005") * 100` evaluates to `100.49999999999999` — the
 * classic way money loses a cent per row and a budget stops reconciling. So:
 * split on the decimal point, check each half is nothing but digits, right-pad
 * the fraction to exactly two characters, and compose the total with integer
 * arithmetic, applying the sign last. A future reader will be tempted to
 * "simplify" this back into one `parseFloat`; that is the bug, not the
 * simplification.
 *
 * What it tolerates, because this is what people actually type and paste:
 * a leading or trailing `$`, thousands commas, spaces of every stripe
 * (ordinary, non-breaking U+00A0, narrow no-break U+202F — the last two arrive
 * whenever a figure is copied out of a formatted spreadsheet or a web page),
 * a sign on either side of the `$`, and a bare `".5"`.
 *
 * What counts as blank — and therefore as `null`, not `0`: an empty or
 * whitespace-only string, and a lone dash. The dash is here so that a field
 * showing the app's own `—` placeholder can be submitted back unchanged
 * without inventing a zero.
 *
 * What counts as garbage: everything else. Notably `"$"` on its own is *not*
 * blank — the user started typing an amount and stopped, and telling them so
 * is more useful than silently storing nothing.
 */
export function tryParseMoney(raw: string | null | undefined): MoneyParse {
  if (raw === null || raw === undefined) return { ok: true, cents: null };

  // Trim the exotic spaces too; `String.prototype.trim` already covers U+00A0
  // and U+202F, but being explicit keeps the intent visible next to the strip.
  const trimmed = raw.replace(/^[\s\u00A0\u202F]+|[\s\u00A0\u202F]+$/g, "");
  if (trimmed === "") return { ok: true, cents: null };
  // A lone dash of any flavour, including the em dash this module renders.
  if (/^[-–—]$/.test(trimmed)) return { ok: true, cents: null };

  const garbage = { ok: false as const, message: "That doesn't look like an amount." };

  // Strip currency furniture: `$`, grouping commas, and every kind of space.
  const stripped = trimmed.replace(/[$,\s\u00A0\u202F]/g, "");
  if (stripped === "") return garbage;

  // Exactly one optional leading sign. `"--5"` and `"5-"` fall through to the
  // digit check below and are refused.
  const negative = stripped.startsWith("-");
  const unsigned = negative || stripped.startsWith("+") ? stripped.slice(1) : stripped;

  const parts = unsigned.split(".");
  if (parts.length > 2) return garbage; // "1.2.3"

  const [intPart, fracPart = ""] = parts;
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return garbage; // "abc", "12e5"
  if (intPart === "" && fracPart === "") return garbage; // a bare "."

  if (fracPart.length > 2) {
    // Refused rather than rounded. Money that quietly loses a fraction of a
    // cent per entry is how a reconciliation goes wrong months later, and the
    // user is right here and can say what they meant.
    return { ok: false, message: "Amounts can only go to the cent." };
  }

  const cents = Number(intPart || "0") * 100 + Number(fracPart.padEnd(2, "0"));
  if (cents > MAX_MONEY_CENTS) {
    return { ok: false, message: "That's larger than any wedding budget — check for a typo." };
  }

  // `+ 0` normalises `-0` (from `"-0"`) to `0`, so a parsed zero is `===` any
  // other zero and `Object.is` comparisons in tests behave.
  return { ok: true, cents: (negative ? -cents : cents) + 0 };
}

/**
 * `tryParseMoney` for callers that cannot present a per-field message.
 *
 * Used by `lib/data/*` internals, where a bad value is a programming error
 * rather than a user's typo and should surface loudly. Server actions call
 * `tryParseMoney` instead, so the message lands next to the input that caused
 * it. Blank still returns `null` — that is a value, not a failure.
 */
export function parseMoneyInput(raw: string | null | undefined): number | null {
  const result = tryParseMoney(raw);
  if (!result.ok) throw new MoneyParseError(result.message);
  return result.cents;
}

/**
 * A fraction as a whole-percent string: `0.184` → `"18%"`, `-0.05` → `"-5%"`.
 *
 * Whole percents only. `"18.4%"` on a summary card implies a precision the
 * underlying estimates do not have — half these numbers are a vendor's verbal
 * quote — and the extra characters make a row of cards harder to scan.
 *
 * Rounding is away from zero on the half, so `+0.5%` and `-0.5%` are treated
 * alike; `Math.round` alone rounds `-18.5` to `-18` and `18.5` to `19`, which
 * makes an over-budget figure look a point better than the mirrored
 * under-budget one.
 *
 * `null`, `NaN` and `Infinity` all render as `—`. `Infinity` is the important
 * one: it is what "we spent something against a benchmark of zero" produces,
 * and `"Infinity%"` is not an answer anyone can act on. Callers facing that
 * case should pass `null` and say it in words instead.
 */
export function formatPercent(
  fraction: number | null | undefined,
  opts?: { signed?: boolean },
): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return EM_DASH;

  const scaled = fraction * 100;
  const whole = Math.sign(scaled) * Math.round(Math.abs(scaled));
  const sign = opts?.signed && whole > 0 ? "+" : "";
  // `+ 0` collapses a `-0` from a tiny negative fraction, so it reads "0%".
  return `${sign}${whole + 0}%`;
}

/**
 * The signature feature's sentence: how this wedding compares to the benchmark.
 *
 * `benchmarkLabel` is a parameter and not a constant on purpose. Binding
 * decision 2 forbids the reference wedding's name from appearing anywhere in
 * `app/`, `components/` or `lib/`: it lives in `weddings.budget_benchmark_label`
 * so the couple can rename it, and so nobody's real name is baked into a
 * product that will be sold to other couples. Callers pass that column through;
 * the generic default only exists so a caller that has not loaded the wedding
 * row yet still renders a sentence rather than `undefined`.
 *
 * Two cases are load-bearing:
 *
 * - **Either side `null` → `"unknown"`.** An un-priced line is not a saving.
 *   Treating a missing forecast as `0` would report "100% under" on every row
 *   nobody has got a quote for yet, which is the single most misleading thing
 *   this page could say.
 * - **Benchmark exactly `0` with real spend → `pct: null`.** There is no
 *   percentage; the division is by zero. The words carry the meaning instead,
 *   because `"Infinity%"` or `"+∞%"` on a card is a bug report waiting to
 *   happen.
 */
export function formatDelta(
  benchmarkCents: number | null | undefined,
  actualCents: number | null | undefined,
  benchmarkLabel: string = "the benchmark",
): MoneyDelta {
  const benchmark = usableCents(benchmarkCents);
  const actual = usableCents(actualCents);
  if (benchmark === null || actual === null) return { text: EM_DASH, pct: null, tone: "unknown" };

  const diff = actual - benchmark;
  if (diff === 0) return { text: "same", pct: "0%", tone: "even" };

  const tone: DeltaTone = diff > 0 ? "over" : "under";
  if (benchmark === 0) {
    return { text: `${formatMoneySigned(diff)} (${benchmarkLabel} spent nothing)`, pct: null, tone };
  }

  // Denominator is the magnitude, so the percentage's sign always agrees with
  // the word next to it even if a benchmark somehow arrives negative.
  const pct = formatPercent(diff / Math.abs(benchmark), { signed: true });
  return { text: `${formatMoneySigned(diff)} ${tone} ${benchmarkLabel}`, pct, tone };
}
