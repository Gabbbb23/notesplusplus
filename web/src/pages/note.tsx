import { useParams } from "react-router";
import { KindBadge, TagBadges } from "@/components/badges";
import { BreakableText } from "@/components/breakable-text";
import { Callout } from "@/components/callout";
import { LoadingCards } from "@/components/item-card";
import { MetaItem, MetaList } from "@/components/meta";
import { NoteBody, SourceBody } from "@/components/note-body";
import { NoteList } from "@/components/note-card";
import { PageHeader } from "@/components/page-header";
import { ErrorAlert, LoadingBlock, NotFoundState } from "@/components/page-state";
import { SectionHeading } from "@/components/section-heading";
import { TextLink } from "@/components/text-link";
import { Separator } from "@/components/ui/separator";
import { api, ApiError, fileUrl, noteUrl } from "@/lib/api";
import { useAsync } from "@/lib/use-async";

export function NotePage() {
  const { slug = "" } = useParams();
  const note = useAsync(() => api.getNote(slug), [slug]);
  const backlinks = useAsync(() => api.backlinks(slug), [slug]);

  if (note.loading) return <LoadingBlock lines={10} />;
  if (note.error) {
    if (note.error instanceof ApiError && note.error.status === 404) {
      return <NotFoundState title="Note not found" message="There is no note with the slug" value={slug} />;
    }
    return <ErrorAlert error={note.error} />;
  }
  if (!note.data) return null;

  const n = note.data;
  const fm = n.frontmatter;

  return (
    <article>
      <PageHeader title={n.title} badge={<KindBadge kind={n.type} />}>
        {n.summary && <Callout>{n.summary}</Callout>}
        <MetaList>
          {n.tags.length > 0 && (
            <MetaItem label="Tags">
              <TagBadges tags={n.tags} />
            </MetaItem>
          )}
          <MetaItem label="Created">{n.created}</MetaItem>
          <MetaItem label="Updated">{n.updated}</MetaItem>
          <MetaItem label="Path">
            <BreakableText as="code" className="font-mono" text={n.path} />
          </MetaItem>
          {fm.sources && fm.sources.length > 0 && (
            <MetaItem label="Sources">
              {fm.sources.map((s) => (
                <TextLink key={s} to={noteUrl(s)}>
                  {s}
                </TextLink>
              ))}
            </MetaItem>
          )}
          {fm.files && fm.files.length > 0 && (
            <MetaItem label="Files">
              {fm.files.map((f) => (
                <TextLink key={f} href={fileUrl(f)}>
                  {f}
                </TextLink>
              ))}
            </MetaItem>
          )}
        </MetaList>
      </PageHeader>

      {n.type === "source" ? <SourceBody text={n.body} /> : <NoteBody markdown={n.body} />}

      <Separator className="my-10" />

      <section aria-labelledby="backlinks-heading" className="space-y-4">
        <SectionHeading id="backlinks-heading">Backlinks</SectionHeading>
        {backlinks.loading && <LoadingCards count={2} />}
        {backlinks.error && <ErrorAlert error={backlinks.error} />}
        {backlinks.data && <NoteList notes={backlinks.data} empty="No notes link here." />}
      </section>
    </article>
  );
}
