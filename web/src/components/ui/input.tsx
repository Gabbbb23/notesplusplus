import * as React from "react"
import { FOCUS_RING } from "@/lib/focus-ring"
import { cn } from "@/lib/utils"

/*
 * The M3 outlined text field: 56px unless the caller sets a height, 4px corners, 16px side padding,
 * body-large text. The 1px outline border turns on-surface on hover and 2px primary while focused (the
 * border plus a 1px inset ring, so the text does not move); FOCUS_RING draws the keyboard outline too.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-14 w-full min-w-0 rounded-extra-small border border-outline bg-transparent px-4 text-body-large text-on-surface caret-primary transition-[border-color,box-shadow] duration-200 ease-standard placeholder:text-on-surface-variant hover:border-on-surface focus-visible:border-primary focus-visible:inset-ring-1 focus-visible:inset-ring-primary disabled:pointer-events-none disabled:border-on-surface/12 disabled:text-on-surface/38 disabled:placeholder:text-on-surface/38",
        "file:inline-flex file:h-8 file:border-0 file:bg-transparent file:text-label-large file:text-on-surface",
        FOCUS_RING,
        "aria-invalid:border-error aria-invalid:caret-error aria-invalid:hover:border-on-error-container aria-invalid:focus-visible:border-error aria-invalid:focus-visible:inset-ring-error",
        className
      )}
      {...props}
    />
  )
}

export { Input }
