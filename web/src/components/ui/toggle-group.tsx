import * as React from "react"
import { type VariantProps } from "class-variance-authority"
import { Ripple } from "@/components/ui/ripple"
import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"
import { Slot, ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { toggleVariants } from "@/components/ui/toggle"

/*
 * With variant="outline" and no spacing, the items join into an M3 outlined segmented button: one
 * pill, outline borders between segments, and the selected segment in secondary-container with an
 * 18px check before its label. Icon-only items get no check; their container shows the state.
 */

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
  }
>({
  size: "default",
  variant: "default",
  spacing: 0,
})

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 0,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
  }) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      style={{ "--gap": spacing } as React.CSSProperties}
      className={cn(
        "group/toggle-group flex w-fit items-center gap-[--spacing(var(--gap))] rounded-full",
        className
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size, spacing }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function hasTextLabel(children: React.ReactNode) {
  return React.Children.toArray(children).some(
    (child) => typeof child === "string" || typeof child === "number"
  )
}

function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        "group/toggle-group-item w-auto min-w-12 shrink-0 px-3 focus:z-10 focus-visible:z-10",
        "data-[spacing=0]:rounded-none data-[spacing=0]:first:rounded-l-full data-[spacing=0]:last:rounded-r-full data-[spacing=0]:data-[variant=outline]:border-l-0 data-[spacing=0]:data-[variant=outline]:first:border-l",
        className
      )}
      {...props}
    >
      {hasTextLabel(children) && (
        <CheckIcon
          aria-hidden="true"
          className="hidden size-[18px] group-data-[state=on]/toggle-group-item:block"
        />
      )}
      <Slot.Slottable>{children}</Slot.Slottable>
      <Ripple disabled={props.disabled} />
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }
