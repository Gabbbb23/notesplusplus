import { describe, expect, it } from "vitest";
import {
  chooseStackArrangement,
  chooseTableLayout,
  FILL_MIN_REM,
  RETURN_SLACK_PX,
  STACK_GRID_MIN_REM,
  TEXT_MIN_REM,
  type TableMeasurements,
} from "../src/components/data-table";

const MIN_FILL = 160;
const MIN_TEXT = 96;

function inTable(overrides: Partial<TableMeasurements>): TableMeasurements {
  return {
    current: "table",
    availableWidth: 800,
    tableWidth: 800,
    fillColumnWidths: [],
    minFillWidth: MIN_FILL,
    textColumnWidths: [],
    minTextWidth: MIN_TEXT,
    requiredWidth: null,
    ...overrides,
  };
}

describe("chooseTableLayout", () => {
  it("uses 10rem for fill columns and 6rem for text columns", () => {
    expect(FILL_MIN_REM).toBe(10);
    expect(TEXT_MIN_REM).toBe(6);
  });

  it("keeps table layout when the table fits and fill columns are wide enough", () => {
    expect(chooseTableLayout(inTable({ fillColumnWidths: [300, 184] }))).toEqual({
      layout: "table",
      requiredWidth: null,
    });
  });

  it("stacks when the table is wider than its wrapper, recording the table's width plus slack", () => {
    expect(chooseTableLayout(inTable({ availableWidth: 766, tableWidth: 778 }))).toEqual({
      layout: "stacked",
      requiredWidth: 778 + RETURN_SLACK_PX,
    });
  });

  it("stacks when a fill column renders narrower than the minimum, recording the width it was short by", () => {
    expect(chooseTableLayout(inTable({ availableWidth: 400, tableWidth: 400, fillColumnWidths: [120, 200] }))).toEqual({
      layout: "stacked",
      requiredWidth: 400 + 40 + RETURN_SLACK_PX,
    });
  });

  it("adds the fill shortfall on top of an overflowing table", () => {
    expect(chooseTableLayout(inTable({ availableWidth: 400, tableWidth: 450, fillColumnWidths: [100] }))).toEqual({
      layout: "stacked",
      requiredWidth: 450 + 60 + RETURN_SLACK_PX,
    });
  });

  it("ignores sub-pixel differences in fill column widths", () => {
    expect(chooseTableLayout(inTable({ fillColumnWidths: [159.7] })).layout).toBe("table");
  });

  it("keeps table layout when every text column is at least the text minimum", () => {
    expect(chooseTableLayout(inTable({ textColumnWidths: [96, 120, 300] }))).toEqual({
      layout: "table",
      requiredWidth: null,
    });
  });

  it("stacks when a text column renders narrower than the text minimum, recording the width it was short by", () => {
    // A cramped note table: it still fits its box, but two columns are down to a word or two a line.
    expect(
      chooseTableLayout(inTable({ availableWidth: 440, tableWidth: 440, textColumnWidths: [80, 70, 150, 140] })),
    ).toEqual({
      layout: "stacked",
      requiredWidth: 440 + 16 + 26 + RETURN_SLACK_PX,
    });
  });

  it("adds text and fill shortfalls together", () => {
    expect(
      chooseTableLayout(
        inTable({ availableWidth: 500, tableWidth: 500, fillColumnWidths: [150], textColumnWidths: [90] }),
      ),
    ).toEqual({
      layout: "stacked",
      requiredWidth: 500 + 10 + 6 + RETURN_SLACK_PX,
    });
  });

  it("ignores sub-pixel differences in text column widths", () => {
    expect(chooseTableLayout(inTable({ textColumnWidths: [95.6] })).layout).toBe("table");
  });

  it("holds stacked layout until the wrapper reaches the recorded width (hysteresis)", () => {
    const stacked = chooseTableLayout(inTable({ availableWidth: 766, tableWidth: 778 }));
    expect(stacked.layout).toBe("stacked");

    // Wider than when it stacked, even wide enough for the table itself, but short of the
    // recorded width: stays stacked.
    for (const width of [767, 778, 801]) {
      expect(
        chooseTableLayout({
          current: "stacked",
          availableWidth: width,
          tableWidth: 0,
          fillColumnWidths: [],
          minFillWidth: MIN_FILL,
          textColumnWidths: [],
          minTextWidth: MIN_TEXT,
          requiredWidth: stacked.requiredWidth,
        }),
      ).toEqual({ layout: "stacked", requiredWidth: 802 });
    }
  });

  it("returns to table layout once the wrapper is at least the recorded width", () => {
    const back = (availableWidth: number) =>
      chooseTableLayout({
        current: "stacked",
        availableWidth,
        tableWidth: 0,
        fillColumnWidths: [],
        minFillWidth: MIN_FILL,
        textColumnWidths: [],
        minTextWidth: MIN_TEXT,
        requiredWidth: 802,
      });
    expect(back(801).layout).toBe("stacked");
    expect(back(802)).toEqual({ layout: "table", requiredWidth: null });
    expect(back(1200)).toEqual({ layout: "table", requiredWidth: null });
  });

  describe("note tables in the note column", () => {
    // layout.tsx: main is max-w-[52rem] with md:px-8, so a note body is 52rem - 2 * 2rem = 48rem wide.
    const REM = 16;
    const NOTE_COLUMN = (52 - 4) * REM;
    // A text column never renders narrower than its 6rem minimum plus the cell's px-3 padding.
    const MIN_TEXT_COLUMN = TEXT_MIN_REM * REM + 2 * 12;

    it("keeps a 5-column table with short cells as a table at 1280px", () => {
      // Subject | Day | Time | Room | Units, as the browser lays it out: the table fills the column.
      const widths = [260, 120, 148, 120, 120];
      expect(widths.reduce((a, b) => a + b)).toBe(NOTE_COLUMN);
      expect(Math.min(...widths)).toBeGreaterThanOrEqual(MIN_TEXT_COLUMN);
      expect(
        chooseTableLayout(inTable({ availableWidth: NOTE_COLUMN, tableWidth: NOTE_COLUMN, textColumnWidths: widths, minTextWidth: TEXT_MIN_REM * REM })),
      ).toEqual({ layout: "table", requiredWidth: null });
    });

    it("has room for 5 text columns at their minimum but not for 7, which stack", () => {
      expect(5 * MIN_TEXT_COLUMN).toBeLessThanOrEqual(NOTE_COLUMN);
      expect(7 * MIN_TEXT_COLUMN).toBeGreaterThan(NOTE_COLUMN);
      const seven = Array(7).fill(MIN_TEXT_COLUMN);
      expect(
        chooseTableLayout(
          inTable({ availableWidth: NOTE_COLUMN, tableWidth: 7 * MIN_TEXT_COLUMN, textColumnWidths: seven, minTextWidth: TEXT_MIN_REM * REM }),
        ).layout,
      ).toBe("stacked");
    });
  });

  it("keeps the current layout when the wrapper has no width (hidden)", () => {
    expect(chooseTableLayout(inTable({ availableWidth: 0, tableWidth: 500 }))).toEqual({
      layout: "table",
      requiredWidth: null,
    });
    expect(
      chooseTableLayout({
        current: "stacked",
        availableWidth: 0,
        tableWidth: 0,
        fillColumnWidths: [],
        minFillWidth: MIN_FILL,
        textColumnWidths: [],
        minTextWidth: MIN_TEXT,
        requiredWidth: 700,
      }),
    ).toEqual({ layout: "stacked", requiredWidth: 700 });
  });
});

describe("chooseStackArrangement", () => {
  const MIN_GRID = STACK_GRID_MIN_REM * 16;

  it("uses a grid of pairs from 36rem (576px) and one pair per line below", () => {
    expect(STACK_GRID_MIN_REM).toBe(36);
    expect(chooseStackArrangement("list", 768, MIN_GRID)).toBe("grid");
    expect(chooseStackArrangement("list", 576, MIN_GRID)).toBe("grid");
    expect(chooseStackArrangement("list", 575.8, MIN_GRID)).toBe("grid");
    expect(chooseStackArrangement("grid", 575, MIN_GRID)).toBe("list");
    expect(chooseStackArrangement("grid", 368, MIN_GRID)).toBe("list");
  });

  it("keeps the current arrangement when the box has no width (hidden)", () => {
    expect(chooseStackArrangement("grid", 0, MIN_GRID)).toBe("grid");
    expect(chooseStackArrangement("list", 0, MIN_GRID)).toBe("list");
  });
});
