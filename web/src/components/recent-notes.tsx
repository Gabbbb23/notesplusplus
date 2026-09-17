import { useState, type ReactNode } from "react";
import { CardList, LoadingCards } from "@/components/item-card";
import { NoteActionsMenu } from "@/components/note-actions-menu";
import { NoteCard } from "@/components/note-card";
import { ErrorAlert } from "@/components/page-state";
import { SectionHeading } from "@/components/section-heading";
import { ShowMore, ShowMoreLimit, useFocusFirstNew } from "@/components/show-more";
import { api } from "@/lib/api";
import { isoDay, plural } from "@/lib/format";
import type { NoteSummary } from "@/lib/types";
import { useAsync } from "@/lib/use-async";

/*
 * Home's "Recent" section: what was filed lately, newest first, under the day it was created.
 * The day is the note's `created` date, so this answers "what is new" rather than "what changed";
 * a note edited today does not come back to the top.
 */

/** Notes fetched once for the section, enough to cover a busy week of filing. */
const FETCH = 50;
/** Notes shown at first, and how many each "Show more notes" adds. */
const STEP = 8;

interface DayGroup {
  /** The `created` date the notes share, YYYY-MM-DD. */
  date: string;
  notes: NoteSummary[];
}

/** Consecutive notes sharing a created date, in the order given, which is already newest first. */
export function groupByDay(notes: readonly NoteSummary[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const note of notes) {
    const open = groups.at(-1);
    if (open?.date === note.created) open.notes.push(note);
    else groups.push({ date: note.created, notes: [note] });
  }
  return groups;
}

/** "today" or "yesterday" for the two days a reader names instead of reading, nothing for the rest. */
export function dayName(date: string, now = new Date()): string | undefined {
  if (date === isoDay(now)) return "today";
  if (date === isoDay(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return "yesterday";
  return undefined;
}

/** The muted half of a day's heading: "today · 3 notes", or just the count on an older day. */
function dayDetail(group: DayGroup): string {
  return [dayName(group.date), plural(group.notes.length, "note")].filter(Boolean).join(" · ");
}

function Section({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="recent-heading" className="mb-8 space-y-4">
      <SectionHeading id="recent-heading">Recent</SectionHeading>
      {children}
    </section>
  );
}

/**
 * The newest notes, sources and hubs by created date, in day groups, as compact cards with their
 * menus. Nothing at all when the brain holds no notes, so a new brain shows only the root hub notice.
 */
export function RecentNotes() {
  const page = useAsync(() => api.listNotes({ sort: "created", limit: FETCH }), []);
  const [shown, setShown] = useState(STEP);
  const items = page.data?.items ?? [];
  const visible = items.slice(0, shown);
  const { listRef, expectMore } = useFocusFirstNew(visible.length, "recent");

  if (page.error) {
    return (
      <Section>
        <ErrorAlert error={page.error} onRetry={page.reload} />
      </Section>
    );
  }
  if (!page.data) {
    return (
      <Section>
        <LoadingCards count={3} />
      </Section>
    );
  }
  if (items.length === 0) return null;

  return (
    <Section>
      <div ref={listRef} className="space-y-4">
        {groupByDay(visible).map((group) => (
          <div key={group.date} className="space-y-2">
            <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-foreground">
              {group.date}
              <span className="font-normal text-muted-foreground">{dayDetail(group)}</span>
            </h3>
            <CardList>
              {group.notes.map((note) => (
                <NoteCard key={note.slug} compact note={note} actions={<NoteActionsMenu note={note} />} />
              ))}
            </CardList>
          </div>
        ))}
      </div>
      {shown < items.length && (
        <ShowMore
          label="Show more notes"
          loading={false}
          progress={`Showing ${visible.length} of ${items.length}`}
          onClick={() => {
            expectMore();
            setShown((n) => n + STEP);
          }}
        />
      )}
      {shown >= items.length && page.data.total > items.length && (
        <ShowMoreLimit>{`Showing the newest ${plural(items.length, "note")} of ${page.data.total}.`}</ShowMoreLimit>
      )}
    </Section>
  );
}
