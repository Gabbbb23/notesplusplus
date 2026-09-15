import { AppWindowIcon, FolderOpenIcon, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { BreakableText } from "@/components/breakable-text";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { fileNameOf, isFolderPath, isOpenable } from "@/lib/file-kinds";
import { cn } from "@/lib/utils";

/*
 * Every control that acts on a file a note mentions: Open in its default Windows app, and Show in
 * folder in File Explorer. Every page offers the same two actions the same way; no page shows a
 * file in a browser tab (DECISIONS.md, 2026-09-15, "File buttons are Open and Show in folder only").
 */

export type FileActionsSize = "default" | "compact";

type Action = "open" | "reveal";

/** The toast for a failed request: a friendlier line for 403 and 404, the server's message otherwise. */
function errorToast(err: unknown, path: string): { title: string; description?: string } {
  if (err instanceof ApiError && err.status === 403) {
    return { title: "Only files mentioned in a note can be opened", description: err.message };
  }
  if (err instanceof ApiError && err.status === 404) return { title: `File not found: ${path}` };
  return { title: err instanceof Error ? err.message : String(err) };
}

function ActionButton({
  icon: Icon,
  text,
  hint,
  accessibleName,
  compact,
  busy,
  onClick,
}: {
  icon: LucideIcon;
  /** The visible label in default size. */
  text: string;
  /** The tooltip in compact size, where only the icon shows. */
  hint: string;
  accessibleName: string;
  compact: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={compact ? "ghost" : "outline"}
      size={compact ? "icon-xs" : "sm"}
      aria-label={accessibleName}
      title={compact ? hint : undefined}
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      <Icon aria-hidden="true" className={compact ? "size-4" : undefined} />
      {!compact && text}
    </Button>
  );
}

export interface FileActionsProps {
  /** Brain-relative ("files/...") or an absolute Windows path ("C:\..."). */
  path: string;
  /** Names the file in accessible names and toasts. Default: the last segment of path. */
  name?: string;
  /** "default": outline buttons with a label. "compact": icon buttons with a tooltip, to sit after a line of text. */
  size?: FileActionsSize;
}

/**
 * Open (only for openable types and folders) and Show in folder (always). Each button is disabled
 * while its request runs and reports the result in a toast.
 */
export function FileActions({ path, name, size = "default" }: FileActionsProps) {
  const label = name ?? fileNameOf(path);
  const compact = size === "compact";
  const folder = isFolderPath(path);
  const [pending, setPending] = useState<Action | null>(null);

  const run = async (action: Action) => {
    setPending(action);
    try {
      if (action === "open") {
        await api.openFile(path);
        toast.success(`Opening ${label}`);
      } else {
        await api.revealFile(path);
        toast.success(`Showing ${label} in File Explorer`);
      }
    } catch (err) {
      const { title, description } = errorToast(err, path);
      toast.error(title, description ? { description } : undefined);
    } finally {
      setPending(null);
    }
  };

  // One unit that never breaks inside: after text it moves to the next line as a whole, and a
  // fit table column (w-px) sizes to it instead of stacking the controls.
  return (
    <span
      data-slot="file-actions"
      data-size={size}
      className={cn("inline-flex shrink-0 items-center whitespace-nowrap align-middle", compact ? "gap-1" : "gap-2")}
    >
      {isOpenable(path) && (
        <ActionButton
          icon={AppWindowIcon}
          text={folder ? "Open folder" : "Open"}
          hint={folder ? "Open folder in File Explorer" : "Open in its default app"}
          accessibleName={folder ? `Open folder ${label} in File Explorer` : `Open ${label} in its default app`}
          compact={compact}
          busy={pending === "open"}
          onClick={() => void run("open")}
        />
      )}
      <ActionButton
        icon={FolderOpenIcon}
        text="Show in folder"
        hint="Show in File Explorer"
        accessibleName={`Show ${label} in File Explorer`}
        compact={compact}
        busy={pending === "reveal"}
        onClick={() => void run("reveal")}
      />
    </span>
  );
}

export interface FileLinkProps {
  /** Brain-relative ("files/...") or an absolute Windows path ("C:\..."). */
  path: string;
  /** Shown instead of the path, and used in the actions' names. */
  name?: string;
  /** Show the text as code: a path quoted in a note body or a card's details. */
  code?: boolean;
}

/**
 * A file named in running text: the path (or name), wrapping at natural break points, then the
 * compact FileActions. The actions follow the last line of the text when they fit and move
 * below it as a group when they do not.
 */
export function FileLink({ path, name, code = false }: FileLinkProps) {
  return (
    <span data-slot="file-link" className="max-w-full min-w-0">
      <BreakableText as={code ? "code" : "span"} className={code ? "font-mono" : undefined} text={name ?? path} />{" "}
      <FileActions path={path} name={name} size="compact" />
    </span>
  );
}
