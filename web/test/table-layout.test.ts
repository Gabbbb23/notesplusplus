import { describe, expect, it } from "vitest";
import {
  chooseTableLayout,
  FILL_MIN_REM,
  RETURN_SLACK_PX,
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
