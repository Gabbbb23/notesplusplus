import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Ripple } from "@/components/ui/ripple"
import { FOCUS_RING } from "@/lib/focus-ring"
import { cn } from "@/lib/utils"
import { Slot, Tabs as TabsPrimitive } from "radix-ui"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

/*
 * M3 tabs: a row of 48px tabs over an outline-variant divider. "primary" marks the active tab with
 * primary text and a 3px primary indicator under its label, rounded on top; "secondary" with on-surface
 * text and a 2px indicator the full width of the tab.
 */
const tabsListVariants = cva(
  "group/tabs-list inline-flex items-stretch text-on-surface-variant group-data-[orientation=horizontal]/tabs:h-12 group-data-[orientation=horizontal]/tabs:w-full group-data-[orientation=horizontal]/tabs:border-b group-data-[orientation=horizontal]/tabs:border-outline-variant group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col group-data-[orientation=vertical]/tabs:border-r group-data-[orientation=vertical]/tabs:border-outline-variant",
  {
    variants: {
      variant: {
        primary: "",
        secondary: "",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  }
)

function TabsList({
  className,
  variant = "primary",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 px-4 text-title-small whitespace-nowrap text-on-surface-variant transition-colors duration-200 ease-standard select-none group-data-[orientation=horizontal]/tabs:h-12 group-data-[orientation=vertical]/tabs:h-12 group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start disabled:pointer-events-none disabled:text-on-surface/38 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-6",
        "group-data-[variant=primary]/tabs-list:data-[state=active]:text-primary group-data-[variant=secondary]/tabs-list:data-[state=active]:text-on-surface",
        "after:pointer-events-none after:absolute after:bg-primary after:opacity-0 after:transition-opacity after:duration-200 data-[state=active]:after:opacity-100",
        "group-data-[orientation=horizontal]/tabs:after:bottom-0 group-data-[variant=primary]/tabs-list:group-data-[orientation=horizontal]/tabs:after:inset-x-4 group-data-[variant=primary]/tabs-list:group-data-[orientation=horizontal]/tabs:after:h-[3px] group-data-[variant=primary]/tabs-list:group-data-[orientation=horizontal]/tabs:after:rounded-t-full group-data-[variant=secondary]/tabs-list:group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[variant=secondary]/tabs-list:group-data-[orientation=horizontal]/tabs:after:h-0.5",
        "group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:right-0 group-data-[orientation=vertical]/tabs:after:w-[3px] group-data-[orientation=vertical]/tabs:after:rounded-l-full",
        FOCUS_RING,
        className
      )}
      {...props}
    >
      <Slot.Slottable>{children}</Slot.Slottable>
      <Ripple disabled={props.disabled} />
    </TabsPrimitive.Trigger>
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
