import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Ripple } from "@/components/ui/ripple"
import { FOCUS_RING } from "@/lib/focus-ring"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/*
 * The M3 common buttons and icon buttons. Variant is the emphasis (filled for the one action that moves
 * work forward, tonal, outlined, text, elevated; standard for an icon button with no container), size is
 * the shape: a 40px pill with a label-large label, a 32px small one, or a round 40px or 32px icon button.
 * Disabled follows M3: the container at 12% and the content at 38% of on-surface.
 */
const buttonVariants = cva(
  `relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full text-label-large whitespace-nowrap transition-[box-shadow,background-color,color] duration-200 ease-standard select-none disabled:pointer-events-none disabled:text-on-surface/38 disabled:shadow-none aria-disabled:pointer-events-none aria-disabled:text-on-surface/38 [&_svg]:pointer-events-none [&_svg]:shrink-0 ${FOCUS_RING}`,
  {
    variants: {
      variant: {
        filled: "bg-primary text-on-primary hover:shadow-level1 disabled:bg-on-surface/12",
        tonal: "bg-secondary-container text-on-secondary-container hover:shadow-level1 disabled:bg-on-surface/12",
        outlined: "border border-outline text-primary disabled:border-on-surface/12",
        text: "text-primary",
        elevated: "bg-surface-container-low text-primary shadow-level1 hover:shadow-level2 disabled:bg-on-surface/12",
        standard: "text-on-surface-variant",
      },
      size: {
        default: "h-10 px-6 has-[>svg]:pl-4 has-[>svg]:pr-6 [&_svg:not([class*='size-'])]:size-[18px]",
        small: "h-8 gap-1.5 px-4 has-[>svg]:pl-3 has-[>svg]:pr-4 [&_svg:not([class*='size-'])]:size-[18px]",
        icon: "size-10 [&_svg:not([class*='size-'])]:size-6",
        "icon-small": "size-8 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    compoundVariants: [
      { variant: "text", size: "default", className: "px-3 has-[>svg]:pl-3 has-[>svg]:pr-4" },
      { variant: "text", size: "small", className: "px-3 has-[>svg]:pl-2 has-[>svg]:pr-3" },
      { variant: "outlined", size: ["icon", "icon-small"], className: "border-outline-variant text-on-surface-variant" },
    ],
    defaultVariants: {
      variant: "filled",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "filled",
  size = "default",
  asChild = false,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      <Slot.Slottable>{children}</Slot.Slottable>
      <Ripple disabled={props.disabled} />
    </Comp>
  )
}

export { Button, buttonVariants }
