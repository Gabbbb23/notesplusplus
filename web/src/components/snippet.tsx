import { splitSnippet } from "@/lib/markdown";

/**
 * A search snippet. Text between « and » is wrapped in <mark>; everything is rendered
 * as text, so markup inside a note (e.g. <script>) shows up escaped, never executed.
 */
export function Snippet({ snippet, className }: { snippet: string; className?: string }) {
  const parts = splitSnippet(snippet);
  return (
    <p className={className}>
      {parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </p>
  );
}
