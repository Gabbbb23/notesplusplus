import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { FOCUS_RING } from "@/lib/focus-ring"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/*
 * A label pill: at least 24px (a minimum, so a tag chip can wrap and grow), 8px corners, 8px side
 * padding, label-medium. badges.tsx sets the kind and status colours over the variant's.
 */
const badgeVariants = cva(
  `relative inline-flex min-h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-small border border-transparent px-2 text-label-medium whitespace-nowrap transition-colors duration-200 ease-standard aria-invalid:border-error [&>svg]:pointer-events-none [&>svg]:size-3.5 ${FOCUS_RING}`,
  {
    variants: {
      variant: {
        default: "bg-primary text-on-primary",
        secondary: "bg-secondary-container text-on-secondary-container",
        destructive: "bg-error text-on-error",
        outline: "border-outline-variant text-on-surface-variant",
        ghost: "text-on-surface-variant",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
