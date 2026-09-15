import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { EmptyState } from "@/components/page-state";
import {
  TableBody as BaseTableBody,
  TableCaption as BaseTableCaption,
  TableCell as BaseTableCell,
  TableHead as BaseTableHead,
  TableHeader as BaseTableHeader,
  TableRow as BaseTableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/*
 * Every table in the app, on list pages and inside note bodies, renders through this module.
 * It is the only module that imports the shadcn table primitives.
 *
 * Tables never scroll sideways. A table that fits is laid out as a normal table; one that
 * does not fit switches to a stacked layout where each row becomes a block of label and
 * value pairs. The choice is made by measuring, see chooseTableLayout.
 */

// ---------------------------------------------------------------------------
// Layout decision
// ---------------------------------------------------------------------------

export type TableLayout = "table" | "stacked";
/** "auto" measures and picks; "table" and "stacked" force a layout (tests, previews). */
export type TableLayoutMode = "auto" | TableLayout;

/** A "fill" column rendering narrower than this many rem makes the table stack. */
export const FILL_MIN_REM = 10;

/** A "text" column (note tables) rendering narrower than this many rem makes the table stack. */
export const TEXT_MIN_REM = 6;

/** Sub-pixel slack when comparing measured column widths. */
const EPSILON = 0.5;

/**
 * Added to the recorded width. Switching back to table layout can make the page taller and
 * bring in a vertical scrollbar (about 17px on Windows); without this slack that would make
 * the table overflow again and flip back to stacked.
 */
export const RETURN_SLACK_PX = 24;

export interface TableMeasurements {
  /** The layout currently on screen. */
  current: TableLayout;
  /** wrapper.clientWidth: the space the table has. */
  availableWidth: number;
  /** table.scrollWidth, measured in table layout. Ignored when current is "stacked". */
  tableWidth: number;
  /** Rendered widths of the "fill" columns, measured in table layout. Ignored when current is "stacked". */
  fillColumnWidths: number[];
  /** Minimum width of a fill column, in px. */
  minFillWidth: number;
  /** Rendered widths of the "text" columns, measured in table layout. Ignored when current is "stacked". */
  textColumnWidths: number[];
  /** Minimum width of a text column, in px. */
  minTextWidth: number;
  /** Width recorded when the table last switched to stacked, or null. */
  requiredWidth: number | null;
}

export interface TableLayoutState {
  layout: TableLayout;
  /** In stacked layout: how wide the wrapper must be before table layout is tried again. */
  requiredWidth: number | null;
}

/**
 * Decide between table and stacked layout.
 *
 * In table layout: stack when the table is wider than its wrapper, when any fill column is
 * narrower than minFillWidth, or when any text column is narrower than minTextWidth. Record the
 * width that would have been needed: the table's width (or the wrapper's, if larger) plus
 * whatever the narrow columns were short by, plus RETURN_SLACK_PX.
 *
 * In stacked layout: go back to table layout only once the wrapper is at least the recorded
 * width. The gap between the two thresholds keeps the table from flipping back and forth.
 *
 * A wrapper with no width (hidden, not laid out) keeps whatever layout it has.
 */
/** How many px the columns narrower than min are short by, in total. */
function shortBy(widths: number[], min: number): number {
  return widths.reduce((sum, w) => {
    const missing = min - w;
    return missing > EPSILON ? sum + missing : sum;
  }, 0);
}

export function chooseTableLayout(m: TableMeasurements): TableLayoutState {
  if (m.availableWidth <= 0) return { layout: m.current, requiredWidth: m.requiredWidth };

  if (m.current === "stacked") {
    if (m.requiredWidth !== null && m.availableWidth < m.requiredWidth) {
      return { layout: "stacked", requiredWidth: m.requiredWidth };
    }
    return { layout: "table", requiredWidth: null };
  }

  const overflows = m.tableWidth > m.availableWidth;
  const shortfall = shortBy(m.fillColumnWidths, m.minFillWidth) + shortBy(m.textColumnWidths, m.minTextWidth);
  if (!overflows && shortfall === 0) return { layout: "table", requiredWidth: null };

  return {
    layout: "stacked",
    requiredWidth: Math.ceil(Math.max(m.tableWidth, m.availableWidth) + shortfall + RETURN_SLACK_PX),
  };
}

function remInPx(): number {
  const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}

const INITIAL_STATE: TableLayoutState = { layout: "table", requiredWidth: null };

/**
 * Measure before paint (useLayoutEffect) and again whenever the wrapper or table resizes.
 * Without ResizeObserver (jsdom) the table stays in table layout.
 */
function useTableLayout(mode: TableLayoutMode) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [state, setState] = useState<TableLayoutState>(INITIAL_STATE);
  // The state that is actually on screen. Measurements only make sense against it.
  const onScreen = useRef<TableLayoutState>(INITIAL_STATE);
  const measuring = mode === "auto" && typeof ResizeObserver !== "undefined";

  const measure = useCallback(() => {
    const wrapper = wrapperRef.current;
    const table = tableRef.current;
    if (!wrapper || !table) return;
    const current = onScreen.current;
    const inTable = current.layout === "table";
    const headerCells = inTable ? Array.from(table.tHead?.rows[0]?.cells ?? []) : [];
    const widthsOf = (size: string) =>
      headerCells.filter((cell) => cell.dataset.size === size).map((cell) => cell.getBoundingClientRect().width);
    const rem = remInPx();
    const next = chooseTableLayout({
      current: current.layout,
      availableWidth: wrapper.clientWidth,
      tableWidth: inTable ? table.scrollWidth : 0,
      fillColumnWidths: widthsOf("fill"),
      minFillWidth: FILL_MIN_REM * rem,
      textColumnWidths: widthsOf("text"),
      minTextWidth: TEXT_MIN_REM * rem,
      requiredWidth: current.requiredWidth,
    });
    if (next.layout !== current.layout || next.requiredWidth !== current.requiredWidth) {
      setState(next);
    }
  }, []);

  // After every commit: note what is on screen, then check that it still fits.
  useLayoutEffect(() => {
    onScreen.current = state;
    if (measuring) measure();
  });

  useLayoutEffect(() => {
    if (!measuring) return;
    const observer = new ResizeObserver(() => measure());
    if (wrapperRef.current) observer.observe(wrapperRef.current);
    if (tableRef.current) observer.observe(tableRef.current);
    return () => observer.disconnect();
  }, [measuring, measure]);

  const layout: TableLayout = mode !== "auto" ? mode : measuring ? state.layout : "table";
  return { wrapperRef, tableRef, layout };
}

// ---------------------------------------------------------------------------
// Styles: the only table styles in the app. Stacked-layout rules hang off the
// wrapper's data-layout attribute through the named Tailwind group "table".
// ---------------------------------------------------------------------------

/**
 * Stacked layout: a hyphenated token kept whole by the note-table cell step
 * (data-cell-token="whole", nowrap) becomes an inline block no wider than its cell. It still
 * moves to the next line as a unit, but one wider than the value column wraps instead of
 * being cut off by the wrapper.
 */
const STACKED_WHOLE_TOKEN_CLASS =
  "data-[layout=stacked]:**:data-[cell-token=whole]:inline-block data-[layout=stacked]:**:data-[cell-token=whole]:max-w-full data-[layout=stacked]:**:data-[cell-token=whole]:whitespace-normal";

const WRAPPER_CLASS = `group/table relative w-full min-w-0 overflow-hidden rounded-lg border bg-card text-sm text-card-foreground wrap-break-word ${STACKED_WHOLE_TOKEN_CLASS}`;

const TABLE_CLASS = "w-full border-collapse group-data-[layout=stacked]/table:block";

const HEADER_CLASS = "bg-muted group-data-[layout=stacked]/table:sr-only";

const BODY_CLASS = "group-data-[layout=stacked]/table:block";

const ROW_CLASS =
  "group-data-[layout=stacked]/table:flex group-data-[layout=stacked]/table:flex-col group-data-[layout=stacked]/table:py-2";

const CELL_CLASS =
  "h-auto px-3 py-2 align-top group-data-[layout=stacked]/table:w-auto group-data-[layout=stacked]/table:py-1 group-data-[layout=stacked]/table:text-left group-data-[layout=stacked]/table:whitespace-normal";

const SIZE_CLASS = {
  /** Sizes to its content on one line and takes no spare width. */
  fit: "w-px whitespace-nowrap",
  /** Takes the remaining width and wraps; breaks long values anywhere as a last resort. */
  fill: "whitespace-normal wrap-anywhere",
  /**
   * Note-body cells: wrap at spaces, so numbers and words are never split. The cell text step
   * (lib/rehype-table-cell-text.ts) keeps hyphenated words and "≥ 20" whole and gives long
   * values their own break points.
   */
  text: "whitespace-normal wrap-break-word [word-break:normal]",
} as const;

const ALIGN_CLASS = {
  start: "text-left",
  center: "text-center",
  end: "text-right tabular-nums",
} as const;

const PRIMARY_CLASS =
  "font-medium group-data-[layout=stacked]/table:order-first group-data-[layout=stacked]/table:block";

/** Stacked layout: muted label (from data-label) on the left, value on the right. */
const LABELLED_CLASS =
  "group-data-[layout=stacked]/table:grid group-data-[layout=stacked]/table:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] group-data-[layout=stacked]/table:items-baseline group-data-[layout=stacked]/table:gap-x-3 group-data-[layout=stacked]/table:before:content-[attr(data-label)] group-data-[layout=stacked]/table:before:text-xs group-data-[layout=stacked]/table:before:font-normal group-data-[layout=stacked]/table:before:text-muted-foreground";

/** Stacked layout without a label (an action column): the value takes the full row. */
const UNLABELLED_CLASS = "group-data-[layout=stacked]/table:block";

// ---------------------------------------------------------------------------
// Primitives. Used by DataTable below and by the markdown renderer (note-body.tsx),
// so page tables and note tables share the same markup, classes, and behaviour.
// ---------------------------------------------------------------------------

export type CellSize = "fill" | "fit";
export type CellAlign = "start" | "center" | "end";

interface CellProps {
  /** "fill" takes the remaining width and wraps; "fit" sizes to content. Omit for note text (6rem minimum). */
  size?: CellSize;
  align?: CellAlign;
  /** The row's title in stacked layout. */
  primary?: boolean;
  children?: ReactNode;
}

function cellClass({ size, align = "start", primary }: CellProps) {
  return cn(CELL_CLASS, SIZE_CLASS[size ?? "text"], ALIGN_CLASS[align], primary && PRIMARY_CLASS);
}

function cellData({ size, align = "start", primary }: CellProps) {
  return {
    "data-size": size ?? "text",
    "data-align": align,
    "data-primary": primary ? "" : undefined,
  };
}

export function TableHeader({ children }: { children?: ReactNode }) {
  return (
    <BaseTableHeader role="rowgroup" className={HEADER_CLASS}>
      {children}
    </BaseTableHeader>
  );
}

export function TableBody({ children }: { children?: ReactNode }) {
  return (
    <BaseTableBody role="rowgroup" className={BODY_CLASS}>
      {children}
    </BaseTableBody>
  );
}

export function TableRow({ children }: { children?: ReactNode }) {
  return (
    <BaseTableRow role="row" className={ROW_CLASS}>
      {children}
    </BaseTableRow>
  );
}

/** The minimum readable width of a column, by size. "fit" columns size to their content. */
const MIN_COLUMN_REM: Record<CellSize | "text", number | undefined> = {
  fill: FILL_MIN_REM,
  text: TEXT_MIN_REM,
  fit: undefined,
};

/** A column header. visuallyHidden keeps the text for screen readers only (an "Open" action column). */
export function TableHead({ visuallyHidden, ...props }: CellProps & { visuallyHidden?: boolean }) {
  let content = visuallyHidden ? <span className="sr-only">{props.children}</span> : props.children;
  // Fill and text columns are never laid out narrower than their minimum, even when their
  // values are short. chooseTableLayout stacks the table when that minimum cannot fit.
  const minRem = MIN_COLUMN_REM[props.size ?? "text"];
  if (minRem !== undefined) {
    content = (
      <span data-slot="column-min-width" className="block" style={{ minWidth: `${minRem}rem` }}>
        {content}
      </span>
    );
  }
  return (
    <BaseTableHead
      role="columnheader"
      scope="col"
      className={cn(cellClass(props), "text-foreground")}
      {...cellData(props)}
    >
      {content}
    </BaseTableHead>
  );
}

/** Stacked layout: an empty cell is skipped so no label appears with nothing beside it. */
const EMPTY_CLASS = "group-data-[layout=stacked]/table:hidden";

/** True when a cell renders nothing visible: null, false, blank strings, or arrays of those. */
export function isEmptyCellContent(children: ReactNode): boolean {
  if (children === null || children === undefined || typeof children === "boolean") return true;
  if (typeof children === "string") return children.trim() === "";
  if (Array.isArray(children)) return children.every(isEmptyCellContent);
  return false;
}

/** A body cell. label is shown beside the value in stacked layout; omit it for no label. */
export function TableCell({ label, ...props }: CellProps & { label?: string }) {
  const labelled = Boolean(label);
  const empty = isEmptyCellContent(props.children);
  return (
    <BaseTableCell
      role="cell"
      className={cn(
        cellClass(props),
        !props.primary && (labelled ? LABELLED_CLASS : UNLABELLED_CLASS),
        empty && !props.primary && EMPTY_CLASS,
      )}
      data-label={label || undefined}
      data-empty={empty ? "" : undefined}
      {...cellData(props)}
    >
      <div data-slot="cell-value" className="min-w-0">
        {props.children}
      </div>
    </BaseTableCell>
  );
}

export interface ResponsiveTableProps {
  /** A TableHeader and a TableBody built from the primitives above. */
  children: ReactNode;
  /** Visually hidden caption for screen readers. */
  caption?: string;
  /** Default "auto": measure and pick. */
  layout?: TableLayoutMode;
}

/** The bordered card, the table element, and the table-or-stacked switch. */
export function ResponsiveTable({ children, caption, layout = "auto" }: ResponsiveTableProps) {
  const { wrapperRef, tableRef, layout: rendered } = useTableLayout(layout);
  return (
    <div ref={wrapperRef} data-slot="responsive-table" data-layout={rendered} className={WRAPPER_CLASS}>
      <table ref={tableRef} role="table" data-slot="table" className={TABLE_CLASS}>
        {caption && <BaseTableCaption className="sr-only">{caption}</BaseTableCaption>}
        {children}
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DataTable: what pages use.
// ---------------------------------------------------------------------------

export interface Column<T> {
  id: string;
  /** Header text. Also the label shown beside the value in stacked layout. */
  header: string;
  cell: (row: T) => ReactNode;
  /** "fill" takes the remaining width and wraps; "fit" sizes to content and never wraps. Default "fit". */
  size?: CellSize;
  align?: "start" | "end";
  /** The row's title in stacked layout. Default: the first column. */
  primary?: boolean;
  /** Visually hide the header (kept for screen readers) and omit the stacked label, e.g. an "Open" action column. */
  hideHeader?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Shown instead of the table when there are no rows. Default "Nothing here yet." */
  empty?: ReactNode;
  /** Visually hidden caption. */
  caption?: string;
  /** Default "auto". Tests force a layout. */
  layout?: TableLayoutMode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = "Nothing here yet.",
  caption,
  layout = "auto",
}: DataTableProps<T>) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  const primaryIndex = Math.max(
    0,
    columns.findIndex((c) => c.primary),
  );
  return (
    <ResponsiveTable caption={caption} layout={layout}>
      <TableHeader>
        <TableRow>
          {columns.map((c, i) => (
            <TableHead
              key={c.id}
              size={c.size ?? "fit"}
              align={c.align}
              primary={i === primaryIndex}
              visuallyHidden={c.hideHeader}
            >
              {c.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={rowKey(row)}>
            {columns.map((c, i) => (
              <TableCell
                key={c.id}
                size={c.size ?? "fit"}
                align={c.align}
                primary={i === primaryIndex}
                label={c.hideHeader ? undefined : c.header}
              >
                {c.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </ResponsiveTable>
  );
}
