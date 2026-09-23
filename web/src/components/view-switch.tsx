import { AlignJustifyIcon, Grid2X2Icon, ListIcon, Rows3Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

export type NoteView = "list" | "details" | "tiles" | "content";
const VIEWS = [{ value: "list", label: "List", icon: ListIcon }, { value: "details", label: "Details", icon: AlignJustifyIcon }, { value: "tiles", label: "Tiles", icon: Grid2X2Icon }, { value: "content", label: "Content", icon: Rows3Icon }] as const;

export function ViewSwitch({ value, onChange }: { value: NoteView; onChange: (value: NoteView) => void }) {
  return <div className="flex items-center gap-1" role="group" aria-label="View"><span className="mr-1 text-sm text-muted-foreground">View</span>{VIEWS.map(({ value: option, label, icon: Icon }) => <Button key={option} variant={value === option ? "secondary" : "ghost"} size="icon" aria-label={label} aria-pressed={value === option} onClick={() => onChange(option)}><Icon aria-hidden="true" /></Button>)}</div>;
}
