"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Ripple } from "@/components/ui/ripple"
import { FOCUS_RING } from "@/lib/focus-ring"
import { cn } from "@/lib/utils"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"

/** The M3 drop-down arrow (Material Symbols arrow_drop_down), a filled triangle. */
function ArrowDropDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M7 10l5 5 5-5z" fill="currentColor" />
    </svg>
  )
}

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

/*
 * Two looks. "default" is an M3 outlined text field: 56px, a 1px outline border that turns on-surface
 * on hover and a 2px primary one (the border plus a 1px inset ring) while focused or open. "chip" is an
 * M3 chip that opens a menu: 32px, an outline-variant border, a label-large label, and a state layer.
 * Both end in the drop-down arrow, which turns over while the menu is open.
 */
const selectTriggerVariants = cva(
  `group/select-trigger relative flex w-fit max-w-full cursor-pointer items-center justify-between gap-2 border whitespace-nowrap transition-[border-color,box-shadow] duration-200 ease-standard select-none disabled:pointer-events-none disabled:border-on-surface/12 disabled:text-on-surface/38 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 ${FOCUS_RING}`,
  {
    variants: {
      size: {
        default:
          "h-14 rounded-extra-small border-outline pr-3 pl-4 text-body-large text-on-surface hover:border-on-surface focus-visible:border-primary focus-visible:inset-ring-1 focus-visible:inset-ring-primary data-[placeholder]:text-on-surface-variant data-[state=open]:border-primary data-[state=open]:inset-ring-1 data-[state=open]:inset-ring-primary aria-invalid:border-error aria-invalid:hover:border-on-error-container aria-invalid:focus-visible:inset-ring-error aria-invalid:data-[state=open]:inset-ring-error",
        chip: "h-8 rounded-small border-outline-variant pr-2 pl-4 text-label-large text-on-surface-variant aria-invalid:border-error",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> &
  VariantProps<typeof selectTriggerVariants>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(selectTriggerVariants({ size }), className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ArrowDropDownIcon
          className={cn(
            "text-on-surface-variant transition-transform duration-200 ease-standard group-data-[state=open]/select-trigger:rotate-180 group-disabled/select-trigger:text-on-surface/38",
            size === "chip" ? "size-[18px]" : "size-6"
          )}
        />
      </SelectPrimitive.Icon>
      {size === "chip" && <Ripple disabled={props.disabled} />}
    </SelectPrimitive.Trigger>
  )
}

/** The M3 menu: surface-container, 4px corners, elevation level 2, 8px above and below the items. */
function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "relative z-50 max-h-(--radix-select-content-available-height) min-w-28 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-extra-small bg-surface-container text-on-surface shadow-level2 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:ease-emphasized-decelerate",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "py-2",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-2"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-3 py-2 text-label-medium text-on-surface-variant", className)}
      {...props}
    />
  )
}

/*
 * An M3 menu item: 48px, label-large. The selected one is secondary-container with a trailing check.
 * The 10% layer for the highlighted item (pointer or keyboard) is a pseudo-element in the item's own
 * text colour, so it also shows over the selected item's container.
 */
function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex h-12 w-full cursor-pointer items-center gap-3 pr-12 pl-3 text-label-large text-on-surface outline-hidden select-none",
        "after:pointer-events-none after:absolute after:inset-0 after:bg-current after:opacity-0 data-[highlighted]:after:opacity-10",
        "data-[state=checked]:bg-secondary-container data-[state=checked]:text-on-secondary-container",
        "data-[disabled]:pointer-events-none data-[disabled]:text-on-surface/38",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-6 [&_svg:not([class*='text-'])]:text-on-surface-variant *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-3 flex size-6 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-6 text-current" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none my-2 h-px bg-outline-variant", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex h-6 cursor-default items-center justify-center text-on-surface-variant",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-5" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex h-6 cursor-default items-center justify-center text-on-surface-variant",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-5" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
