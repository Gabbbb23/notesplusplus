import { AlertCircleIcon, CheckCircle2Icon, InfoIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/*
 * Every alert box in the app. This is the only module that imports the shadcn Alert, which draws the
 * shape (12px corners, 16px padding, no border, title small over body medium). The tone sets the
 * container colour, its on-colour for the title and the message, and the default icon.
 */

export type NoticeTone = "info" | "success" | "warning" | "danger";

const TONE_CLASS: Record<NoticeTone, string> = {
  // The message uses the title colour at full strength. test/contrast.test.ts checks every tone at 4.5:1.
  info: "bg-secondary-container text-on-secondary-container *:data-[slot=alert-description]:text-on-secondary-container",
  success: "bg-success-container text-on-success-container *:data-[slot=alert-description]:text-on-success-container",
  warning: "bg-warning-container text-on-warning-container *:data-[slot=alert-description]:text-on-warning-container",
  danger: "bg-error-container text-on-error-container *:data-[slot=alert-description]:text-on-error-container",
};

const TONE_ICON: Record<NoticeTone, LucideIcon> = {
  info: InfoIcon,
  success: CheckCircle2Icon,
  warning: TriangleAlertIcon,
  danger: AlertCircleIcon,
};

export interface NoticeProps {
  /** Default "info". */
  tone?: NoticeTone;
  title: ReactNode;
  /** The explanation under the title. */
  children?: ReactNode;
  /** Replaces the tone's default icon. */
  icon?: LucideIcon;
  /**
   * Default true: role="alert", so screen readers announce it when it appears (errors, a missing
   * root hub). false: role="note", a static box read in place, for content that is part of the page,
   * such as a callout in a note body.
   */
  live?: boolean;
}

export function Notice({ tone = "info", title, children, icon, live = true }: NoticeProps) {
  const Icon = icon ?? TONE_ICON[tone];
  return (
    <Alert
      data-slot="notice"
      data-tone={tone}
      role={live ? "alert" : "note"}
      className={cn("wrap-break-word", TONE_CLASS[tone])}
    >
      <Icon aria-hidden="true" />
      {/* A long title wraps instead of being cut at one line. */}
      <AlertTitle className="line-clamp-none">{title}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  );
}
