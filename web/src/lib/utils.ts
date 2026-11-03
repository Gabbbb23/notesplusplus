import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const SIZES = ["large", "medium", "small"] as const;

/*
 * tailwind-merge only knows Tailwind's default scales, so it would read text-body-medium as a text
 * colour (and drop it beside text-on-surface) and would not let rounded-small replace rounded-full.
 * These are the M3 scales index.css defines.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "headline", "title", "body", "label"].flatMap((role) => SIZES.map((size) => `${role}-${size}`)),
      radius: ["extra-small", "small", "medium", "large", "extra-large"],
      shadow: ["level1", "level2", "level3", "level4", "level5"],
      ease: ["standard", "emphasized-decelerate", "emphasized-accelerate"],
      breakpoint: ["medium", "expanded", "large", "extra-large"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
