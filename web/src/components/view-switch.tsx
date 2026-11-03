import { AlignJustifyIcon, Grid2X2Icon, ListIcon, Rows3Icon } from "lucide-react";
import { useId } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type NoteView = "list" | "details" | "tiles" | "content";
const VIEWS = [{ value: "list", label: "List", icon: ListIcon }, { value: "details", label: "Details", icon: AlignJustifyIcon }, { value: "tiles", label: "Tiles", icon: Grid2X2Icon }, { value: "content", label: "Content", icon: Rows3Icon }] as const;

/** An M3 outlined segmented button of icon-only segments, named by its visible "View" label. One view is always selected. */
export function ViewSwitch({ value, onChange }: { value: NoteView; onChange: (value: NoteView) => void }) {
  const labelId = useId();
  return (
    <div className="flex items-center gap-2">
      <span id={labelId} className="text-body-medium text-on-surface-variant">View</span>
      <ToggleGroup
        type="single"
        variant="outline"
        value={value}
        // Clicking the selected segment again would clear the value; the view keeps it instead.
        onValueChange={(next) => {
          const picked = VIEWS.find((view) => view.value === next);
          if (picked) onChange(picked.value);
        }}
        aria-labelledby={labelId}
      >
        {VIEWS.map(({ value: option, label, icon: Icon }) => (
          <ToggleGroupItem key={option} value={option} aria-label={label}>
            <Icon aria-hidden="true" />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
