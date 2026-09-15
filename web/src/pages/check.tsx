import type { ReactNode } from "react";
import { BreakableText } from "@/components/breakable-text";
import { SectionCard } from "@/components/item-card";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { ErrorAlert, LoadingBlock } from "@/components/page-state";
import { TextLink } from "@/components/text-link";
import { api, noteUrl } from "@/lib/api";
import type { LinkReport } from "@/lib/types";
import { useAsync } from "@/lib/use-async";

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <SectionCard title={title} count={count}>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        <ul className="space-y-2 text-sm">{children}</ul>
      )}
    </SectionCard>
  );
}

function From({ slug }: { slug: string }) {
  return (
    <TextLink to={noteUrl(slug)} variant="strong">
      {slug}
    </TextLink>
  );
}

function Arrow() {
  return <span className="text-muted-foreground"> → </span>;
}

function Report({ r }: { r: LinkReport }) {
  const total = r.brokenLinks.length + r.missingFiles.length + r.missingSources.length + r.invalidNotes.length;
  if (total === 0) {
    return (
      <Notice tone="success" title="All clear">
        No broken links, missing files, missing sources, or invalid notes.
      </Notice>
    );
  }
  return (
    <div className="space-y-4">
      <Section title="Broken links" count={r.brokenLinks.length}>
        {r.brokenLinks.map((b, i) => (
          <li key={i}>
            <From slug={b.from} />
            <Arrow />
            <BreakableText as="code" className="font-mono" text={`[[${b.to}]]`} />
          </li>
        ))}
      </Section>
      <Section title="Missing files" count={r.missingFiles.length}>
        {r.missingFiles.map((m, i) => (
          <li key={i}>
            <From slug={m.from} />
            <Arrow />
            <BreakableText as="code" className="font-mono" text={m.file} />
          </li>
        ))}
      </Section>
      <Section title="Missing sources" count={r.missingSources.length}>
        {r.missingSources.map((m, i) => (
          <li key={i}>
            <From slug={m.from} />
            <Arrow />
            <BreakableText as="code" className="font-mono" text={m.source} />
          </li>
        ))}
      </Section>
      <Section title="Invalid notes" count={r.invalidNotes.length}>
        {r.invalidNotes.map((n, i) => (
          <li key={i}>
            <BreakableText as="code" className="font-mono" text={n.path} />
            <span className="text-muted-foreground">: {n.error}</span>
          </li>
        ))}
      </Section>
    </div>
  );
}

export function CheckPage() {
  const { data, error, loading } = useAsync(() => api.checkLinks(), []);
  return (
    <>
      <PageHeader
        title="Check"
        description={
          <>
            Problems the agent should fix. Run the <code className="font-mono">garden</code> prompt or fix by hand.
          </>
        }
      />
      {loading && <LoadingBlock lines={6} />}
      {error && <ErrorAlert error={error} />}
      {data && <Report r={data} />}
    </>
  );
}
