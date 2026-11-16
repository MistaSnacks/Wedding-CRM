import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { listReadiness } from "@/lib/data/readiness";
import { groupAttention, type AttentionGroup, type AttentionRow } from "@/lib/domain/attention-groups";

export const dynamic = "force-dynamic";

/** Rows shown before the "Show all" fold. Enough to act on, short enough to read. */
const PREVIEW = 6;

function Row({ row }: { row: AttentionRow }) {
  return (
    <li>
      <Link
        href={row.href}
        className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-sage-band"
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${row.urgent ? "bg-rose" : "bg-[#c9cdbd]"}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-ink group-hover:text-olive-deep">
            {row.title}
          </span>
          <span className="block text-[12.5px] text-muted">{row.detail}</span>
        </span>
        <span aria-hidden className="text-muted group-hover:text-olive-deep">
          →
        </span>
      </Link>
    </li>
  );
}

function Group({ group }: { group: AttentionGroup }) {
  const first = group.rows.slice(0, PREVIEW);
  const rest = group.rows.slice(PREVIEW);
  return (
    <section
      id={group.kind}
      aria-labelledby={`${group.kind}-title`}
      className="scroll-mt-6 rounded-2xl border border-hairline bg-white/75 p-5 max-md:p-4"
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <p className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted">
            <span id={`${group.kind}-title`}>{group.title}</span>
            {group.urgent && (
              <span className="rounded-full bg-blush px-2 py-0.5 text-[10.5px] tracking-normal text-rose-deep normal-case">
                Do this first
              </span>
            )}
          </p>
          <p className="mt-1.5 text-[16px] font-semibold leading-snug text-ink">{group.summary}</p>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">{group.hint}</p>
        </div>
        {group.action && (
          <Link
            href={group.action.href}
            className="shrink-0 rounded-lg bg-olive-deep px-4 py-2.5 text-[13.5px] font-semibold text-cream transition-colors hover:bg-olive-deeper"
          >
            {group.action.label}
          </Link>
        )}
      </div>
      {first.length > 0 && (
        <ul className="mt-3 border-t border-hairline pt-2">
          {first.map((row) => (
            <Row key={row.key} row={row} />
          ))}
        </ul>
      )}
      {rest.length > 0 && (
        <details className="group/more">
          <summary className="mt-1 cursor-pointer list-none rounded-lg px-3 py-2 text-[13px] font-medium text-olive-deep underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
            <span className="group-open/more:hidden">Show all {group.rows.length}</span>
            <span className="hidden group-open/more:inline">Show fewer</span>
          </summary>
          <ul>
            {rest.map((row) => (
              <Row key={row.key} row={row} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export default async function AttentionPage() {
  const admin = await requireAdmin();
  const groups = groupAttention(await listReadiness(forWedding(admin.weddingId)));
  const main = groups.filter((g) => !g.technical);
  const checks = groups.filter((g) => g.technical);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-[22px] font-semibold text-ink">To do</h1>
        <p className="mt-0.5 text-[13.5px] text-muted">
          {groups.length
            ? "What still needs you, most pressing first. Each line clears by itself once it is done."
            : "Nothing needs you right now."}
        </p>
      </div>

      {main.length > 1 && (
        <nav aria-label="Jump to a section" className="flex flex-wrap gap-2">
          {main.map((g) => (
            <a
              key={g.kind}
              href={`#${g.kind}`}
              className="rounded-full border border-[#dddbd0] bg-white/70 px-3.5 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:border-olive hover:text-olive-deep"
            >
              {g.title}
              <span className="ml-1.5 text-muted">{g.rows.length || ""}</span>
            </a>
          ))}
        </nav>
      )}

      {main.map((g) => (
        <Group key={g.kind} group={g} />
      ))}

      {checks.map((g) => (
        <details key={g.kind} className="rounded-2xl border border-hairline bg-white/50 p-5 max-md:p-4" open={g.urgent}>
          <summary className="cursor-pointer text-[13.5px] font-semibold text-ink">
            {g.title} <span className="font-normal text-muted">· {g.summary} {g.hint}</span>
          </summary>
          <ul className="mt-2">
            {g.rows.map((row) => (
              <Row key={row.key} row={row} />
            ))}
          </ul>
        </details>
      ))}

      {!groups.length && (
        <p className="rounded-2xl bg-sage-band p-6 text-[14px] text-olive-deep">
          You are all caught up. Replies, meals, seats and payments are in order.
        </p>
      )}
    </div>
  );
}
