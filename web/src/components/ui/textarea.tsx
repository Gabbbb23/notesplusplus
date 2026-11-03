import * as React from "react"
import { FOCUS_RING } from "@/lib/focus-ring"
import { cn } from "@/lib/utils"

/** The M3 outlined text field over several lines; the same borders and states as Input. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-14 w-full rounded-extra-small border border-outline bg-transparent px-4 py-4 text-body-large text-on-surface caret-primary transition-[border-color,box-shadow] duration-200 ease-standard placeholder:text-on-surface-variant hover:border-on-surface focus-visible:border-primary focus-visible:inset-ring-1 focus-visible:inset-ring-primary disabled:cursor-not-allowed disabled:border-on-surface/12 disabled:text-on-surface/38 disabled:placeholder:text-on-surface/38",
        "aria-invalid:border-error aria-invalid:caret-error aria-invalid:hover:border-on-error-container aria-invalid:focus-visible:border-error aria-invalid:focus-visible:inset-ring-error",
        FOCUS_RING,
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
