"use client";

import { useState } from "react";
import type { ImportProblem } from "@/lib/csv";
import { FIX_LABEL, type ResolvedFix, type RowFix } from "./fixable";

type Item = { problem: ImportProblem; fix: RowFix | null };

/** Which palette a fix input is sitting in — outstanding, or already resolved. */
type Tone = "error" | "resolved";

/**
 * Errors and warnings as two separate, independently complete lists.
 *
 * The bug this replaces was a single `[...errors, ...warnings].slice(0, 8)`:
 * with 12 errors on the real sheet, every warning was unreachable — including
 * twelve "someone may be missing" warnings, each one a potentially absent
 * wedding guest. There is deliberately no cap here. Long lists scroll inside
 * their own box; scrolling is not truncation, and the header always states
 * the true total.
 *
 * Errors that name a cell we can write are repaired here rather than reported.
 * Eleven of the twelve on the real sheet are a missing surname; the old advice
 * — fix the spreadsheet and upload again — was a trap, because a second upload
 * duplicates every guest the first one imported. A text box is the whole fix.
 *
 * A repaired row does not vanish. It moves down into its own sage section with
 * the input still open and her own value in it, so everything she typed can be
 * read back — and corrected — before she imports. Removing the row used to
 * destroy the only evidence of what was typed, while the tally underneath it
 * said "12 of 12 fixed"; a misspelled surname was therefore vouched for by the
 * screen and went on to a place card. Resolved rows sit *below* the outstanding
 * ones and scroll inside their own box, so a long read-back list can never
 * bury the rows still waiting for her.
 */
export function ProblemList({
  errors,
  warnings,
  fixed,
  disabled,
  warningsAdded,
  fixFor,
  onFix,
  onDownload,
}: {
  errors: ImportProblem[];
  warnings: ImportProblem[];
  /** Rows already repaired here, still editable, in sheet order. */
  fixed: ResolvedFix[];
  /** True while an import is in flight — the data must not move underneath it. */
  disabled: boolean;
  /** Warnings the most recent repair *added*, so the count moving can be explained. */
  warningsAdded: number;
  fixFor: (problem: ImportProblem) => RowFix | null;
  onFix: (fix: RowFix, value: string) => void;
  onDownload: (problems: ImportProblem[], filename: string) => void;
}) {
  const items: Item[] = errors.map((problem) => ({ problem, fix: fixFor(problem) }));
  const fixable = items.filter((i) => i.fix);
  const stuck = items.filter((i) => !i.fix);
  const fixedCount = fixed.length;

  /* Announced once per repair, and deliberately not the record of it: the
     durable record is the resolved list below, which never expires. */
  const [justSaid, setJustSaid] = useState<string | null>(null);
  function announce(message: string) {
    setJustSaid(message);
    window.setTimeout(() => setJustSaid((m) => (m === message ? null : m)), 5000);
  }

  if (errors.length === 0 && warnings.length === 0 && fixedCount === 0) return null;

  return (
    <div className="mt-6 flex flex-col gap-3">
      {errors.length > 0 && (
        <ProblemSection
          tone="error"
          items={items}
          disabled={disabled}
          onFix={onFix}
          onAnnounce={announce}
          title={`${errors.length} ${errors.length === 1 ? "row" : "rows"} can't be imported`}
          progress={
            fixedCount > 0 || fixable.length > 0
              ? { done: fixedCount, total: fixedCount + fixable.length }
              : null
          }
          note={errorNote(fixable.length, stuck.length)}
          /* Only the rows that genuinely need the spreadsheet are worth
             downloading. Offering the file for rows fixable right here would
             point back at the re-upload path this screen exists to replace. */
          download={
            stuck.length > 0
              ? {
                  problems: stuck.map((i) => i.problem),
                  label:
                    fixable.length > 0
                      ? `Download the ${stuck.length === 1 ? "row" : `${stuck.length} rows`} you can't fix here`
                      : `Download ${stuck.length === 1 ? "this row" : `these ${stuck.length} rows`}`,
                  name: "rows-to-fix.csv",
                }
              : null
          }
          onDownload={onDownload}
        />
      )}

      {fixedCount > 0 && (
        <FixedSection
          fixed={fixed}
          outstanding={fixable.length}
          disabled={disabled}
          warningsAdded={warningsAdded}
          justSaid={justSaid}
          onFix={onFix}
          onAnnounce={announce}
        />
      )}

      {warnings.length > 0 && (
        <ProblemSection
          tone="warning"
          items={warnings.map((problem) => ({ problem, fix: null }))}
          disabled={disabled}
          onFix={onFix}
          onAnnounce={announce}
          title={`${warnings.length} ${warnings.length === 1 ? "thing" : "things"} worth a look`}
          progress={null}
          note="Nothing here blocks the import — these guests will all come through. They're just worth checking against your spreadsheet, in case someone was left off."
          download={{
            problems: warnings,
            label: `Download ${warnings.length === 1 ? "this row" : `these ${warnings.length} rows`}`,
            name: "rows-to-check.csv",
          }}
          onDownload={onDownload}
        />
      )}
    </div>
  );
}

/** The section's opening line changes with what can actually be done about it. */
function errorNote(fixable: number, stuck: number): string {
  if (fixable > 0 && stuck === 0) {
    return fixable === 1
      ? "This row is only missing a name. Type it in and that guest joins the import — there's no need to touch your spreadsheet."
      : "These rows are only missing a name. Type each one in and those guests join the import — there's no need to touch your spreadsheet.";
  }
  if (fixable > 0) {
    return "The rows with a blank to fill in are only missing a name — type it in and that guest joins the import. The rest need a change in your spreadsheet before they can come in.";
  }
  return "These rows are missing something we need, so they'll be left out and aren't counted in the totals above. You can add those guests by hand after importing, or start over with a corrected file.";
}

function ProblemSection({
  tone,
  items,
  disabled,
  title,
  progress,
  note,
  download,
  onFix,
  onAnnounce,
  onDownload,
}: {
  tone: "error" | "warning";
  items: Item[];
  disabled: boolean;
  title: string;
  progress: { done: number; total: number } | null;
  note: string;
  download: { problems: ImportProblem[]; label: string; name: string } | null;
  onFix: (fix: RowFix, value: string) => void;
  onAnnounce: (message: string) => void;
  onDownload: (problems: ImportProblem[], filename: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [downloaded, setDownloaded] = useState(false);
  const keys = listKeys(items);

  /* The last row that carries an input. Tab is only advertised on the rows it
     actually leads somewhere from — promising "the next one" on the final
     blank would teach the shortcut with a lie at the end of it. */
  const lastFixIndex = items.reduce((last, item, i) => (item.fix ? i : last), -1);

  const skin =
    tone === "error"
      ? {
          box: "border-blush-border bg-blush/60",
          heading: "text-rose-deep",
          rule: "border-blush-border",
          divide: "divide-[#f4e0dc]",
          name: "text-rose-deep",
          body: "text-[#7d5348]",
          row: "text-[#a58076]",
          button: "border-blush-border text-rose-deep hover:bg-white",
        }
      : {
          box: "border-[#e7dfc2] bg-[#fdf8e8]/70",
          heading: "text-[#6f5a15]",
          rule: "border-[#e7dfc2]",
          divide: "divide-[#efe6cd]",
          name: "text-[#6f5a15]",
          body: "text-[#7a6a3c]",
          row: "text-[#a3925f]",
          button: "border-[#e7dfc2] text-[#6f5a15] hover:bg-white",
        };

  return (
    <section className={`rounded-xl border ${skin.box}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Chevron open={open} className={skin.heading} />
          <span className={`text-[13.5px] font-semibold ${skin.heading}`}>{title}</span>
        </button>
        {progress && <Tally done={progress.done} total={progress.total} />}
      </div>

      {open && (
        <div className={`border-t px-4 py-3.5 ${skin.rule}`}>
          <p className={`max-w-[68ch] text-[12.5px] leading-relaxed ${skin.body}`}>{note}</p>

          <ul
            className={`mt-3 max-h-72 divide-y overflow-y-auto rounded-lg bg-white/70 ${skin.divide}`}
          >
            {items.map(({ problem: p, fix }, i) => (
              <li
                // Keyed on the problem, not its position: when one row is
                // repaired the list re-renders without it, and a positional key
                // would re-mount every input below — taking the caret with it
                // mid-edit.
                key={keys[i]}
                className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3 py-2 text-[12.5px] leading-relaxed ${skin.body}`}
              >
                <span className={`font-semibold ${skin.name}`}>{p.who}</span>
                {p.household && p.household !== p.who && (
                  <span className={skin.body}>in {p.household}</span>
                )}
                <span aria-hidden="true" className={skin.row}>
                  &mdash;
                </span>
                {fix ? (
                  <FixInput
                    fix={fix}
                    who={p.who}
                    tone="error"
                    hasNext={i < lastFixIndex}
                    disabled={disabled}
                    onApply={(value) => {
                      onFix(fix, value);
                      onAnnounce(`${wholeName(p.who, fix, value)} is in.`);
                    }}
                  />
                ) : (
                  <span>{phrase(p)}</span>
                )}
                {p.line > 1 && (
                  <span className={`ml-auto pl-3 text-[11.5px] tabular-nums ${skin.row}`}>
                    row {p.line}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {download && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  onDownload(download.problems, download.name);
                  setDownloaded(true);
                  window.setTimeout(() => setDownloaded(false), 4000);
                }}
                className={`rounded-lg border bg-white/60 px-3.5 py-2 text-[12.5px] font-medium transition-colors ${skin.button}`}
              >
                {download.label}
              </button>
              {downloaded && (
                <span role="status" className={`text-[12.5px] ${skin.body}`}>
                  Downloaded &mdash; check your Downloads folder.
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Stable list keys. Line + message is unique for every problem the engine can
 * emit today; the counter is belt and braces, so a future message that repeats
 * on one line degrades to a positional key instead of a duplicate one.
 */
function listKeys(items: Item[]): string[] {
  const seen = new Set<string>();
  return items.map(({ problem }, i) => {
    const base = `${problem.line}|${problem.message}`;
    if (seen.has(base)) return `${base}|${i}`;
    seen.add(base);
    return base;
  });
}

/** The repaired name in reading order, whichever half was missing. */
function wholeName(who: string, fix: RowFix, value: string): string {
  const added = value.trim();
  return (fix.field === "firstName" ? `${added} ${who}` : `${who} ${added}`).trim();
}

/**
 * The missing half of a name, written straight into the parsed row.
 *
 * Applies on blur and on Enter. Both routes funnel through the same handler,
 * and applying twice is harmless — the wizard ignores a value the cell already
 * holds. Escape abandons the edit, which is the only way out that doesn't
 * commit something typed by accident. Blurring an emptied box restores what
 * the cell holds rather than applying nothing: a box reading blank over a row
 * that is still repaired would be the same lie, inverted.
 *
 * The same input serves an outstanding row and a resolved one. Only the palette
 * and the hint differ, because it is the same act — the resolved copy is what
 * makes a typo correctable instead of permanent.
 */
function FixInput({
  fix,
  who,
  tone,
  hasNext,
  disabled,
  onApply,
}: {
  fix: RowFix;
  who: string;
  tone: Tone;
  /** Whether Tab from here lands on another blank worth advertising. */
  hasNext: boolean;
  disabled: boolean;
  onApply: (value: string) => void;
}) {
  const [value, setValue] = useState(fix.current);
  const [focused, setFocused] = useState(false);
  const label = FIX_LABEL[fix.field];
  const dirty = value.trim().length > 0 && value.trim() !== fix.current;

  const field =
    tone === "error"
      ? "border-[#e2c4bd] placeholder:text-[#c4a49b] focus:border-rose focus-visible:ring-rose/25"
      : "border-[#bcd3ab] placeholder:text-[#a8bd97] focus:border-olive focus-visible:ring-olive/25";

  function apply() {
    if (!dirty) return;
    onApply(value);
  }

  return (
    <span className="inline-flex items-baseline gap-2">
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (value.trim().length === 0) setValue(fix.current);
          apply();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          } else if (e.key === "Escape") {
            setValue(fix.current);
            e.currentTarget.blur();
          }
        }}
        aria-label={`${label} for ${who}, row ${fix.line}`}
        placeholder={label.toLowerCase()}
        autoComplete="off"
        spellCheck={false}
        size={12}
        className={`w-[11ch] rounded-t-sm border-b bg-white/70 px-1.5 py-0.5 text-[12.5px] text-olive-deep transition-colors placeholder:italic focus:bg-white focus:outline-none focus-visible:ring-2 disabled:opacity-50 motion-reduce:transition-none ${field}`}
      />
      {focused && (
        <span
          className={`text-[11px] whitespace-nowrap ${tone === "error" ? "text-[#a58076]" : "text-[#7d8a72]"}`}
        >
          {hint(tone, dirty, hasNext)}
        </span>
      )}
    </span>
  );
}

/**
 * Tab is the reason twelve rows take forty seconds rather than four minutes,
 * and nothing used to mention it — the hint taught Enter, the slower of the two
 * motions. It earns its place only once she has typed something, which is the
 * moment she is deciding how to commit, and only where there is a next blank.
 */
function hint(tone: Tone, dirty: boolean, hasNext: boolean): string {
  if (!dirty) return tone === "error" ? "type the missing name" : "";
  return hasNext ? "press Enter — or Tab for the next" : "press Enter";
}

function Check({ className }: { className?: string }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="m4 12.5 5.5 5.5L20 6.5" />
    </svg>
  );
}

/** Quiet progress: a rule that fills, and the count in words beside it. */
function Tally({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <span className="flex shrink-0 items-center gap-2">
      {/* Nothing to draw before the first repair — an empty rule at 0% reads as
          a stray mark rather than progress. */}
      {done > 0 && (
        <span aria-hidden="true" className="block h-[3px] w-14 rounded-full bg-white/80">
          <span
            className="block h-full rounded-full bg-rose transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
      <span role="status" className="text-[11.5px] font-medium text-[#7d5348] tabular-nums">
        {done} of {total} fixed
      </span>
    </span>
  );
}

/**
 * Everything she typed, still typed-in-able.
 *
 * The end of the list is a result, not an absence — but "12 of 12 fixed" over
 * an empty space was a result nobody could check. Each repaired row is printed
 * back as the whole name it now makes, with her half still sitting in an open
 * input: reading it back and correcting a typo are the same gesture, and
 * neither costs her the eleven rows she already did.
 */
function FixedSection({
  fixed,
  outstanding,
  disabled,
  warningsAdded,
  justSaid,
  onFix,
  onAnnounce,
}: {
  fixed: ResolvedFix[];
  /** Rows still waiting for a name — decides whether this is a tally or a finish line. */
  outstanding: number;
  disabled: boolean;
  warningsAdded: number;
  justSaid: string | null;
  onFix: (fix: RowFix, value: string) => void;
  onAnnounce: (message: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const count = fixed.length;
  const done = outstanding === 0;

  return (
    <section className="rounded-xl border border-[#cfe1c0] bg-sage-band/70">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Chevron open={open} className="text-olive-deep" />
          <span className="text-[13.5px] font-semibold text-olive-deep">
            {count === 1 ? "1 name you filled in" : `${count} names you filled in`}
          </span>
        </button>
        {done && <Check className="shrink-0 text-olive" />}
      </div>

      {open && (
        <div className="border-t border-[#cfe1c0] px-4 py-3.5">
          <p className="max-w-[68ch] text-[12.5px] leading-relaxed text-[#4a5147]">
            {fixedNote(count, done)}
          </p>

          {/* Above the list, not below it: this section sits directly under the
              blanks she is typing into, and a read-back list can be 300px tall.
              What just happened has to land beside where it happened. */}
          {(justSaid || warningsAdded > 0) && (
            <div className="mt-2.5 flex flex-col gap-1">
              {justSaid && (
                <span role="status" className="text-[12.5px] text-olive">
                  {justSaid}
                </span>
              )}
              {/* The count moving the wrong way is the moment she stops. It is
                  her own correction doing it — a household that had nobody in
                  it can't be short of anyone, and filling the name in brings it
                  back into scope — so say that rather than hiding the number. */}
              {warningsAdded > 0 && (
                <span className="max-w-[68ch] text-[12.5px] leading-relaxed text-[#6b7167]">
                  {warningsAddedNote(warningsAdded)}
                </span>
              )}
            </div>
          )}

          <ul className="mt-3 max-h-72 divide-y divide-[#dbead0] overflow-y-auto rounded-lg bg-white/70">
            {fixed.map((r) => (
              <li
                // Keyed on the sheet line: a correction re-renders this row in
                // place rather than re-mounting the input and taking the caret.
                key={r.line}
                className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3 py-2 text-[12.5px] leading-relaxed text-[#4a5147]"
              >
                {r.fix.field === "lastName" && (
                  <span className="font-semibold text-olive-deep">{r.kept}</span>
                )}
                <FixInput
                  fix={r.fix}
                  who={r.kept}
                  tone="resolved"
                  hasNext={false}
                  disabled={disabled}
                  onApply={(value) => {
                    onFix(r.fix, value);
                    onAnnounce(`Changed to ${wholeName(r.kept, r.fix, value)}.`);
                  }}
                />
                {r.fix.field === "firstName" && (
                  <span className="font-semibold text-olive-deep">{r.kept}</span>
                )}
                <span className="ml-auto pl-3 text-[11.5px] tabular-nums text-[#8a9484]">
                  row {r.line}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function fixedNote(count: number, done: boolean): string {
  if (done) {
    return count === 1
      ? "That row is fixed — the guest is counted in the totals above and comes in with everyone else. Nothing is being left behind. Read the name back here, and change it if it isn't right."
      : `All ${count} rows are fixed — those guests are counted in the totals above and come in with everyone else. Nothing is being left behind. Read the names back here, and change any that aren't right.`;
  }
  return count === 1
    ? "This guest is counted in the totals above and comes in with everyone else. Nothing is saved until you import, so change the name here if it isn't right."
    : "These guests are counted in the totals above and come in with everyone else. Nothing is saved until you import, so change any of the names here if they aren't right.";
}

function warningsAddedNote(added: number): string {
  return added === 1
    ? "Filling that name in brought a new invitation into play, so there’s one more note in “things worth a look” below. Nothing’s wrong — it’s just worth a glance."
    : `Filling that name in brought new invitations into play, so there are ${added} more notes in “things worth a look” below. Nothing’s wrong — they’re just worth a glance.`;
}

/**
 * Turns an engine message into a clause that reads on from the person's name.
 *
 * Presentation only — the engine's strings are untouched. Every rewrite below
 * keeps all of the original's information (counts, values, consequences); it
 * only removes the household name the engine repeats in quotes, which we have
 * already printed immediately to the left, and re-points the subject at the
 * invitation where the sentence would otherwise read as if the guest did it.
 */
function phrase(p: ImportProblem): string {
  const exact: Record<string, string> = {
    "Missing last name.": "no last name",
    "Missing first name.": "no first name",
    "Empty name — row skipped.": "no name in this row, so it was skipped",
    "Map both a First name and a Last name column.":
      "we couldn't tell which columns hold names",
  };
  if (exact[p.message]) return exact[p.message];

  // `"<invitation>" names N people but has only M rows — someone may be missing.`
  const envelope = p.message.match(
    /^".*" names (\d+) people but has only (\d+) rows? — someone may be missing\.$/,
  );
  if (envelope) {
    const named = Number(envelope[1]);
    const rows = Number(envelope[2]);
    return `this invitation is addressed to ${named} people but only ${rows} ${
      rows === 1 ? "guest is" : "guests are"
    } listed — someone may be missing`;
  }

  let text = p.message;
  // Drop a leading `"<household>"` / `"<household>":` we have already shown.
  text = text.replace(/^"[^"]*"\s*:?\s*/, "");
  return text.replace(/\.$/, "");
}

function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${className ?? ""} transition-transform duration-200 motion-reduce:transition-none ${
        open ? "rotate-90" : ""
      }`}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
