import { AlertCircleIcon, CheckCircle2Icon, InfoIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/*
 * Every alert box in the app. This is the only module that imports the shadcn Alert.
 * Same padding (16px) and radius (8px) as a card; the tone sets the colours and default icon.
 */

export type NoticeTone = "info" | "success" | "warning" | "danger";

const SHELL_CLASS = "rounded-lg p-4 wrap-break-word";

const TONE_CLASS: Record<NoticeTone, string> = {
  info: "border-primary/40 bg-accent text-accent-foreground *:data-[slot=alert-description]:text-foreground/90",
  success: "border-success/40 bg-success-tint text-success *:data-[slot=alert-description]:text-success/90",
  warning:
    "border-status-warning-fg/40 bg-status-warning-bg text-status-warning-fg *:data-[slot=alert-description]:text-status-warning-fg/90",
  danger: "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90",
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
}

export function Notice({ tone = "info", title, children, icon }: NoticeProps) {
  const Icon = icon ?? TONE_ICON[tone];
  return (
    <Alert data-slot="notice" data-tone={tone} className={cn(SHELL_CLASS, TONE_CLASS[tone])}>
      <Icon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  );
}
