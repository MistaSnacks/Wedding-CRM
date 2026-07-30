import { formatMoney } from "@/lib/format/money";
import type { PaymentView } from "@/lib/data/budget-rules";

/**
 * What's due, month by month, between now and the wedding.
 *
 * A budget total answers "can we afford this wedding". This answers the
 * question that actually keeps people up: "can we afford it *in March*". Every
 * commercial tool we looked at has the first and none has the second, because
 * none of them has a payment ledger to build it from.
 *
 * Two date rules run through this file and both have bitten this codebase:
 *
 * - A month is `due_date.slice(0, 7)`. `due_date` is a Postgres `date` — a
 *   calendar day with no instant and no zone — and `new Date(due_date)` makes
 *   it a UTC midnight, which reads as the previous month for anything due on
 *   the 1st once a timezone is applied.
 * - The month *label* is formatted from an explicit UTC midnight in UTC, so
 *   both ends of the conversion are pinned and the strip shows the same months
 *   on a laptop in California and on Vercel.
 *
 * The bars are `<div>`s on the same `#f0efe3` track as everything else here.
 */
export type CashFlowStripProps = {
  /** Every payment in the wedding, already viewed through the venue's calendar. */
  payments: PaymentView[];
  /** Today at the venue, `YYYY-MM-DD`. Never the server's day. */
  todayCalendarDay: string;
  /** `weddings.wedding_date`, so the strip always reaches the wedding itself. */
  weddingDay: string | null;
};

/** `"2026-07"` → `2026 * 12 + 6`. Integer month arithmetic, no `Date` anywhere. */
function monthIndex(monthKey: string): number {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return year * 12 + (month - 1);
}

/** The inverse of `monthIndex`. */
function monthKeyOf(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** `"2026-07"` → `"Jul"`, or `"Jul ’27"` when the strip crosses a new year. */
function monthLabel(monthKey: string, withYear: boolean): string {
  const ms = Date.parse(`${monthKey}-01T00:00:00Z`);
  if (Number.isNaN(ms)) return monthKey;
  const label = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
    new Date(ms),
  );
  return withYear ? `${label} ’${monthKey.slice(2, 4)}` : label;
}

/** At most eighteen columns; past that the bars are too thin to read. */
const MAX_MONTHS = 18;
const MIN_MONTHS = 6;

export function CashFlowStrip({ payments, todayCalendarDay, weddingDay }: CashFlowStripProps) {
  const scheduled = payments.filter((p) => !p.paid && p.due_date !== null);

  const thisMonth = monthIndex(todayCalendarDay.slice(0, 7));
  const dueIndexes = scheduled.map((p) => monthIndex((p.due_date as string).slice(0, 7)));
  const weddingIndex = weddingDay === null ? null : monthIndex(weddingDay.slice(0, 7));

  // Reach back far enough to show anything already late, and forward at least
  // as far as the wedding: a payment hidden off the end of this strip is the
  // one that gets missed.
  const start = Math.min(thisMonth, ...(dueIndexes.length > 0 ? dueIndexes : [thisMonth]));
  const wanted = Math.max(
    thisMonth + MIN_MONTHS - 1,
    weddingIndex ?? start,
    ...(dueIndexes.length > 0 ? dueIndexes : [start]),
  );
  const end = Math.min(wanted, start + MAX_MONTHS - 1);

  const months = [];
  for (let index = start; index <= end; index += 1) {
    const key = monthKeyOf(index);
    const mine = scheduled.filter((p) => (p.due_date as string).slice(0, 7) === key);
    months.push({
      key,
      dueCents: mine.reduce((sum, p) => sum + p.amount_cents, 0),
      overdue: mine.some((p) => p.status === "overdue"),
      isWedding: weddingIndex === index,
    });
  }

  const scaleMax = months.reduce((max, m) => Math.max(max, m.dueCents), 0);
  const crossesYear = months.length > 0 && months[0].key.slice(0, 4) !== months[months.length - 1].key.slice(0, 4);
  const heaviest = months.reduce<(typeof months)[number] | null>(
    (best, m) => (m.dueCents > 0 && (best === null || m.dueCents > best.dueCents) ? m : best),
    null,
  );

  const footer =
    heaviest === null
      ? "Nothing is scheduled yet. Add payments to a line and they’ll show up here."
      : `${monthLabel(heaviest.key, true)} is the heaviest — ${formatMoney(heaviest.dueCents)} falls due.`;

  return (
    <section className="rounded-xl border border-hairline p-5">
      <h2 className="text-[14.5px] font-semibold text-ink">{"What’s due, month by month"}</h2>

      <div className="mt-4 flex h-28 items-end gap-2 overflow-x-auto">
        {months.map((m) => (
          <div
            key={m.key}
            className={`flex min-w-[42px] flex-1 flex-col items-center gap-1.5 rounded-[4px] ${
              m.isWedding ? "ring-1 ring-inset ring-rose/40" : ""
            }`}
          >
            <span className="text-[11px] tabular-nums text-[#6b7167]">
              {m.dueCents > 0 ? formatMoney(m.dueCents) : ""}
            </span>
            <span className="flex w-full flex-1 items-end px-1">
              <span
                className={`w-full rounded-t-[3px] ${m.overdue ? "bg-rose" : "bg-olive"}`}
                style={{
                  height:
                    m.dueCents === 0
                      ? "0%"
                      : `${Math.max(4, scaleMax === 0 ? 0 : (m.dueCents / scaleMax) * 100)}%`,
                }}
              />
            </span>
            <span
              className={`text-[10.5px] font-medium uppercase tracking-[0.06em] ${
                m.isWedding ? "text-rose" : "text-[#6b7167]"
              }`}
            >
              {monthLabel(m.key, crossesYear)}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[12.5px] text-[#4a5147]">{footer}</p>
    </section>
  );
}
