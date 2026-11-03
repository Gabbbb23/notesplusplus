"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Ripple } from "@/components/ui/ripple"
import { FOCUS_RING } from "@/lib/focus-ring"
import { cn } from "@/lib/utils"
import { Slot, Toggle as TogglePrimitive } from "radix-ui"

/*
 * A toggle in the M3 segmented-button style: label-large, an 18px icon, and secondary-container while on.
 * "outline" draws the 1px outline border of an outlined segmented button; "default" has no container
 * until it is on. ToggleGroup joins outline items into one segmented button.
 */
const toggleVariants = cva(
  `relative inline-flex cursor-pointer items-center justify-center gap-2 text-label-large whitespace-nowrap transition-colors duration-200 ease-standard select-none disabled:pointer-events-none disabled:text-on-surface/38 data-[state=on]:bg-secondary-container data-[state=on]:text-on-secondary-container data-[state=on]:disabled:bg-on-surface/12 data-[state=on]:disabled:text-on-surface/38 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px] ${FOCUS_RING}`,
  {
    variants: {
      variant: {
        default: "rounded-full text-on-surface-variant",
        outline: "rounded-full border border-outline text-on-surface disabled:border-on-surface/12",
      },
      size: {
        default: "h-10 min-w-10 px-3",
        small: "h-8 min-w-8 px-2",
        large: "h-12 min-w-12 px-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  children,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    >
      <Slot.Slottable>{children}</Slot.Slottable>
      <Ripple disabled={props.disabled} />
    </TogglePrimitive.Root>
  )
}

export { Toggle, toggleVariants }
