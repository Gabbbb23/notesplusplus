import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/*
 * Toasts as M3 snackbars: inverse-surface with inverse-on-surface body-medium text, 4px corners,
 * elevation level 3, and actions as text buttons in inverse-primary. The colour roles switch with the
 * system scheme, so the snackbar is dark on the light theme and light on the dark one.
 *
 * Sonner's own stylesheet is not in a cascade layer, so it outranks Tailwind's utilities: colours go
 * through its CSS variables, and the rest of its look is replaced with important (!) utilities.
 * Sonner's theme only picks its built-in colours, all of which are replaced here, so it stays fixed.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--md-sys-color-inverse-surface)",
          "--normal-text": "var(--md-sys-color-inverse-on-surface)",
          "--normal-border": "var(--md-sys-color-inverse-surface)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // 48px for one line: 4px padding around the 40px action, the text's own 10px on the content.
          toast: "min-h-12 gap-3! rounded-extra-small! px-4! py-1! text-body-medium! shadow-level3!",
          content: "py-2.5!",
          title: "text-body-medium! font-medium!",
          description: "text-body-medium! text-inverse-on-surface!",
          actionButton:
            "-mr-2! h-10! rounded-full! bg-transparent! px-3! text-label-large! text-inverse-primary! hover:bg-inverse-primary/8! focus-visible:outline-solid! focus-visible:outline-3! focus-visible:outline-offset-2! focus-visible:outline-inverse-primary!",
          cancelButton:
            "h-10! rounded-full! bg-transparent! px-3! text-label-large! text-inverse-on-surface! hover:bg-inverse-on-surface/8! focus-visible:outline-solid! focus-visible:outline-3! focus-visible:outline-offset-2! focus-visible:outline-inverse-primary!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
