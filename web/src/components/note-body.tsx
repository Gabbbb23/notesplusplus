import type { Element, ElementContent } from "hast";
import { MessageSquareWarningIcon } from "lucide-react";
import { Children, cloneElement, isValidElement, useMemo, type CSSProperties, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ResponsiveTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type CellAlign,
} from "@/components/data-table";
import { Diagram } from "@/components/diagram";
import { FileLink } from "@/components/file-actions";
import { Notice } from "@/components/notice";
import { SectionHeading } from "@/components/section-heading";
import { TextLink } from "@/components/text-link";
import { isExternalHref, safeHref } from "@/lib/markdown";
import { CALLOUTS, isCalloutKind, rehypeCallouts } from "@/lib/rehype-callouts";
import { rehypeLocalPaths } from "@/lib/rehype-local-paths";
import { rehypeTableCellText } from "@/lib/rehype-table-cell-text";
import { rehypeTableLabels } from "@/lib/rehype-table-labels";
import { remarkWikilinks } from "@/lib/remark-wikilinks";

/** GFM column alignment arrives as an inline text-align style; map it onto the shared cell's align. */
function alignOf(style: CSSProperties | undefined): CellAlign | undefined {
  if (style?.textAlign === "right") return "end";
  if (style?.textAlign === "center") return "center";
  return undefined;
}

/** Mark the first cell of a row as the row's title (the primary cell in stacked layout). */
function withPrimaryFirstCell(children: ReactNode): ReactNode {
  return Children.map(children, (child, i) =>
    i === 0 && isValidElement(child) ? cloneElement(child as ReactElement<{ primary?: boolean }>, { primary: true }) : child,
  );
}

function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

/** The source of a fenced ```mermaid block (a pre holding code.language-mermaid), or null. */
function mermaidSource(pre: Element | undefined): string | null {
  const code = pre?.children.find((child): child is Element => child.type === "element");
  if (code?.tagName !== "code") return null;
  const classes = code.properties.className;
  if (!Array.isArray(classes) || !classes.includes("language-mermaid")) return null;
  return textOf(code).replace(/\n$/, "");
}

interface MarkdownCellProps {
  children?: ReactNode;
  style?: CSSProperties;
  primary?: boolean;
  "data-label"?: string;
}

const components: Components = {
  // Links render through the shared TextLink: external ones open in a new tab with the icon,
  // /notes/... and other in-app paths navigate in the same tab through the router.
  a({ href, children, node: _node, className: _className, style: _style, target: _target, rel: _rel, ...rest }) {
    const h = safeHref(href);
    if (!h) return <>{children}</>;
    return isExternalHref(h) ? (
      <TextLink href={h} {...rest}>
        {children}
      </TextLink>
    ) : (
      <TextLink to={h} {...rest}>
        {children}
      </TextLink>
    );
  },
  // Inline code holding one of the note's mentions (marked by rehype-local-paths.ts) becomes the
  // path plus View, Open, and Show in folder. Other code, code blocks included, is unchanged.
  code(props) {
    const { children, node: _node, ...rest } = props;
    const localPath = (props as { "data-local-path"?: string })["data-local-path"];
    if (localPath) return <FileLink path={localPath} code />;
    return <code {...rest}>{children}</code>;
  },
  // A fenced mermaid block becomes a figure; every other code block stays a code block.
  pre({ node, children, ...rest }) {
    const diagram = mermaidSource(node);
    if (diagram !== null) return <Diagram source={diagram} />;
    return <pre {...rest}>{children}</pre>;
  },
  // A GitHub alert (marked by rehype-callouts.ts) becomes a static Notice (role="note", never announced
  // on load); other blockquotes stay as they are.
  blockquote({ node: _node, children, ...rest }) {
    const kind = (rest as { "data-callout"?: string })["data-callout"];
    if (!isCalloutKind(kind)) return <blockquote {...rest}>{children}</blockquote>;
    const { tone, title } = CALLOUTS[kind];
    return (
      <Notice tone={tone} title={title} icon={kind === "important" ? MessageSquareWarningIcon : undefined} live={false}>
        {children}
      </Notice>
    );
  },
  h2({ children, node: _node, className: _className, style: _style, ...rest }) {
    return <SectionHeading {...rest}>{children}</SectionHeading>;
  },
  img({ src, alt, node: _node, ...rest }) {
    const h = safeHref(typeof src === "string" ? src : undefined);
    if (!h) return <span>{alt}</span>;
    return <img src={h} alt={alt ?? ""} loading="lazy" {...rest} />;
  },
  // Tables render through the shared table so they look and behave like page tables.
  table({ children }) {
    return <ResponsiveTable>{children}</ResponsiveTable>;
  },
  thead({ children }) {
    return <TableHeader>{children}</TableHeader>;
  },
  tbody({ children }) {
    return <TableBody>{children}</TableBody>;
  },
  tr({ children }) {
    return <TableRow>{withPrimaryFirstCell(children)}</TableRow>;
  },
  th(props) {
    const { children, style, primary } = props as MarkdownCellProps;
    return (
      <TableHead align={alignOf(style)} primary={primary}>
        {children}
      </TableHead>
    );
  },
  td(props) {
    const { children, style, primary, "data-label": label } = props as MarkdownCellProps;
    return (
      <TableCell align={alignOf(style)} primary={primary} label={label}>
        {children}
      </TableCell>
    );
  },
};

// remarkWikilinks runs on the tree remark-gfm builds, so a table's cells are split before it looks for links.
const remarkPlugins = [remarkGfm, remarkWikilinks];

/**
 * A note body: markdown with GFM, wikilinks in text (never in code) turned into router links,
 * raw HTML shown as text (react-markdown's default), unsafe hrefs dropped,
 * links through TextLink, h2 through SectionHeading, inline code holding one of the note's
 * `mentions` through FileLink, tables through the shared responsive table with the cell text step
 * from rehype-table-cell-text.ts, fenced mermaid blocks through Diagram, and GitHub alert
 * callouts through Notice.
 *
 * `mentions` comes from the server's note (`Note.mentions`); pass `[]` for markdown that is not a
 * note body. Only those spans get file actions, because only those paths will open.
 */
export function NoteBody({ markdown, mentions }: { markdown: string; mentions: readonly string[] }) {
  // rehypeLocalPaths reads code text before rehypeTableCellText rewrites the text in table cells.
  const rehypePlugins = useMemo<Options["rehypePlugins"]>(
    () => [[rehypeLocalPaths, { mentions }], rehypeTableLabels, rehypeTableCellText, rehypeCallouts],
    [mentions],
  );
  return (
    <div className="prose-note">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

/** A source note: raw material shown verbatim in monospace, wrapped. */
export function SourceBody({ text }: { text: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words rounded-lg border bg-muted p-4 font-mono text-[0.85rem] leading-relaxed">
      {text}
    </pre>
  );
}
