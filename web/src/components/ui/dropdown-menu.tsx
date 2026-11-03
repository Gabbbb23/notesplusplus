import * as React from "react"
import { Ripple } from "@/components/ui/ripple"
import { FOCUS_RING } from "@/lib/focus-ring"
import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"
import { DropdownMenu as DropdownMenuPrimitive, Slot } from "radix-ui"

/*
 * The M3 menu: surface-container, 4px corners, elevation level 2, 8px above and below the items, 112px
 * to 280px wide. Items are 48px, label-large, with 24px icons in on-surface-variant; a checked item is
 * secondary-container with a leading check.
 *
 * Radix highlights an item under the pointer as well as from the keyboard, so the highlight (a 10%
 * pseudo-element in the item's text colour, which also shows over a checked item's container) is the
 * hover layer too, and the Ripple only draws the press. The focus outline sits inside the item: the
 * menu clips its overflow, which would cut off an outline drawn outside the item's edges.
 */
const MENU_ITEM = cn(
  "relative flex h-12 cursor-pointer items-center gap-3 px-3 text-label-large text-on-surface outline-hidden select-none",
  "after:pointer-events-none after:absolute after:inset-0 after:bg-current after:opacity-0 data-[highlighted]:after:opacity-10 [&>md-ripple]:[--md-ripple-hover-opacity:0]",
  "data-[disabled]:pointer-events-none data-[disabled]:text-on-surface/38",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-6 [&_svg:not([class*='text-'])]:text-on-surface-variant data-[disabled]:*:[svg]:text-on-surface/38!",
  FOCUS_RING,
  "focus-visible:-outline-offset-3"
)

/** Checkbox and radio items: the check sits in the leading icon slot, so the label starts at 48px. */
const MENU_CHECK_ITEM = cn(
  MENU_ITEM,
  "pl-12 data-[state=checked]:bg-secondary-container data-[state=checked]:text-on-secondary-container"
)

const MENU_SURFACE =
  "z-50 min-w-28 max-w-70 origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-extra-small bg-surface-container py-2 text-on-surface shadow-level2 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:ease-emphasized-decelerate"

/** Material Symbols arrow_right, the trailing icon of an M3 item that opens a submenu. */
function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M10 17l5-5-5-5v10z" fill="currentColor" />
    </svg>
  )
}

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "max-h-(--radix-dropdown-menu-content-available-height)",
          MENU_SURFACE,
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        MENU_ITEM,
        "data-[inset]:pl-12 data-[variant=destructive]:text-error data-[variant=destructive]:*:[svg]:text-error!",
        className
      )}
      {...props}
    >
      <Slot.Slottable>{children}</Slot.Slottable>
      <Ripple disabled={props.disabled} />
    </DropdownMenuPrimitive.Item>
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(MENU_CHECK_ITEM, className)}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-3 flex size-6 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-6 text-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
      <Ripple disabled={props.disabled} />
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(MENU_CHECK_ITEM, className)}
      {...props}
    >
      <span className="pointer-events-none absolute left-3 flex size-6 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-6 text-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
      <Ripple disabled={props.disabled} />
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-3 py-2 text-title-small text-on-surface-variant data-[inset]:pl-12",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("my-2 h-px bg-outline-variant", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-label-large text-on-surface-variant",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        MENU_ITEM,
        "data-[inset]:pl-12 data-[state=open]:after:opacity-10",
        className
      )}
      {...props}
    >
      {children}
      <ArrowRightIcon className="ml-auto size-6" />
      <Ripple disabled={props.disabled} />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  // In a portal, as Radix recommends: inside the parent menu, whose box clips its overflow, the
  // submenu would be cut off at the parent's edge.
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        data-slot="dropdown-menu-sub-content"
        className={cn(MENU_SURFACE, className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
