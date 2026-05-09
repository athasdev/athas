import { describe, expect, it } from "vite-plus/test";
import {
  formatGridSelection,
  getFullGridRange,
  getGridRowCells,
  getGridRowRange,
  isCellInRange,
  moveGridCellByTab,
  moveGridCell,
  normalizeGridRange,
} from "../utils/data-grid-selection";

describe("data grid selection", () => {
  it("normalizes an anchor and focus into an ordered range", () => {
    expect(normalizeGridRange({ row: 4, col: 3 }, { row: 1, col: 5 })).toEqual({
      startRow: 1,
      endRow: 4,
      startCol: 3,
      endCol: 5,
    });
  });

  it("normalizes invalid grid range positions", () => {
    expect(
      normalizeGridRange({ row: Number.NaN, col: -1 }, { row: 2.8, col: Number.POSITIVE_INFINITY }),
    ).toEqual({
      startRow: 0,
      endRow: 2,
      startCol: 0,
      endCol: 0,
    });
  });

  it("detects whether a cell is inside the selected range", () => {
    const range = normalizeGridRange({ row: 1, col: 1 }, { row: 3, col: 2 });

    expect(isCellInRange({ row: 2, col: 2 }, range)).toBe(true);
    expect(isCellInRange({ row: 4, col: 2 }, range)).toBe(false);
    expect(isCellInRange({ row: 2, col: 0 }, range)).toBe(false);
  });

  it("builds a full-grid range for visible rows and columns", () => {
    expect(getFullGridRange(3, 2)).toEqual({
      startRow: 0,
      endRow: 2,
      startCol: 0,
      endCol: 1,
    });

    expect(getFullGridRange(0, 2)).toBeNull();
    expect(getFullGridRange(3, 0)).toBeNull();
  });

  it("normalizes invalid full-grid range bounds", () => {
    expect(getFullGridRange(Number.NaN, 2)).toBeNull();
    expect(getFullGridRange(2, Number.POSITIVE_INFINITY)).toBeNull();
    expect(getFullGridRange(2.8, 3.2)).toEqual({
      startRow: 0,
      endRow: 1,
      startCol: 0,
      endCol: 2,
    });
    expect(getFullGridRange(0.5, 2)).toBeNull();
  });

  it("builds a full-row range for visible columns", () => {
    expect(getGridRowRange(2, 3)).toEqual({
      startRow: 2,
      endRow: 2,
      startCol: 0,
      endCol: 2,
    });

    expect(getGridRowRange(-1, 3)).toBeNull();
    expect(getGridRowRange(2, 0)).toBeNull();
  });

  it("normalizes invalid row range bounds", () => {
    expect(getGridRowRange(Number.NaN, 3)).toBeNull();
    expect(getGridRowRange(2, Number.NaN)).toBeNull();
    expect(getGridRowRange(2.8, 3.2)).toEqual({
      startRow: 2,
      endRow: 2,
      startCol: 0,
      endCol: 2,
    });
    expect(getGridRowRange(2, 0.5)).toBeNull();
  });

  it("aligns rendered row cells to the visible column count", () => {
    expect(getGridRowCells([1, "Ada"], 3)).toEqual([1, "Ada", undefined]);
    expect(getGridRowCells([1, "Ada", "extra"], 2)).toEqual([1, "Ada"]);
    expect(getGridRowCells([1], Number.NaN)).toEqual([]);
  });

  it("moves cells within grid bounds", () => {
    expect(moveGridCell({ row: 1, col: 1 }, 10, 10, { rowCount: 3, columnCount: 2 })).toEqual({
      row: 2,
      col: 1,
    });
    expect(moveGridCell({ row: 1, col: 1 }, -10, -10, { rowCount: 3, columnCount: 2 })).toEqual({
      row: 0,
      col: 0,
    });
    expect(moveGridCell(null, 1, 1, { rowCount: 3, columnCount: 2 })).toEqual({
      row: 0,
      col: 0,
    });
    expect(moveGridCell({ row: 0, col: 0 }, 1, 1, { rowCount: 0, columnCount: 2 })).toBeNull();
  });

  it("normalizes invalid cell movement inputs", () => {
    expect(
      moveGridCell({ row: Number.NaN, col: Number.POSITIVE_INFINITY }, 1.8, 1.2, {
        rowCount: 3,
        columnCount: 2,
      }),
    ).toEqual({ row: 1, col: 1 });

    expect(
      moveGridCell({ row: 0, col: 0 }, 1, 1, { rowCount: Number.NaN, columnCount: 2 }),
    ).toBeNull();
  });

  it("normalizes fractional cell movement bounds", () => {
    expect(
      moveGridCell({ row: 10, col: 10 }, 0, 0, {
        rowCount: 3.8,
        columnCount: 2.8,
      }),
    ).toEqual({ row: 2, col: 1 });

    expect(moveGridCell(null, 1, 1, { rowCount: 0.8, columnCount: 2 })).toBeNull();
  });

  it("supports page-sized row movement", () => {
    expect(moveGridCell({ row: 20, col: 1 }, -10, 0, { rowCount: 100, columnCount: 4 })).toEqual({
      row: 10,
      col: 1,
    });
    expect(moveGridCell({ row: 95, col: 1 }, 10, 0, { rowCount: 100, columnCount: 4 })).toEqual({
      row: 99,
      col: 1,
    });
  });

  it("moves cells by tab order across rows", () => {
    const bounds = { rowCount: 3, columnCount: 2 };

    expect(moveGridCellByTab({ row: 0, col: 0 }, 1, bounds)).toEqual({ row: 0, col: 1 });
    expect(moveGridCellByTab({ row: 0, col: 1 }, 1, bounds)).toEqual({ row: 1, col: 0 });
    expect(moveGridCellByTab({ row: 1, col: 0 }, -1, bounds)).toEqual({ row: 0, col: 1 });
    expect(moveGridCellByTab({ row: 0, col: 0 }, -1, bounds)).toEqual({ row: 0, col: 0 });
    expect(moveGridCellByTab({ row: 2, col: 1 }, 1, bounds)).toEqual({ row: 2, col: 1 });
    expect(moveGridCellByTab(null, 1, bounds)).toEqual({ row: 0, col: 0 });
    expect(moveGridCellByTab(null, -1, bounds)).toEqual({ row: 0, col: 0 });
    expect(moveGridCellByTab(null, 1, { rowCount: 0, columnCount: 2 })).toBeNull();
  });

  it("normalizes invalid tab navigation inputs", () => {
    expect(
      moveGridCellByTab({ row: Number.NaN, col: Number.POSITIVE_INFINITY }, 1, {
        rowCount: 3,
        columnCount: 2,
      }),
    ).toEqual({ row: 0, col: 1 });
  });

  it("normalizes fractional tab navigation bounds", () => {
    expect(
      moveGridCellByTab({ row: 0, col: 1 }, 1, {
        rowCount: 2.8,
        columnCount: 2.8,
      }),
    ).toEqual({ row: 1, col: 0 });

    expect(moveGridCellByTab(null, 1, { rowCount: 2, columnCount: 0.8 })).toBeNull();
  });

  it("formats selected cells as tab-separated rows", () => {
    const rows = [
      [1, "Ada", null],
      [2, "Linus", { active: true }],
      [3, "Grace", "ok"],
    ];

    expect(
      formatGridSelection(rows, {
        startRow: 0,
        endRow: 1,
        startCol: 1,
        endCol: 2,
      }),
    ).toBe('Ada\tNULL\nLinus\t{\n  "active": true\n}');
  });

  it("can include selected column headers when formatting a selection", () => {
    const rows = [
      [1, "Ada", null],
      [2, "Linus", "linux"],
    ];

    expect(
      formatGridSelection(
        rows,
        {
          startRow: 0,
          endRow: 1,
          startCol: 1,
          endCol: 2,
        },
        {
          columns: ["id", "name", "project"],
          includeHeaders: true,
        },
      ),
    ).toBe("name\tproject\nAda\tNULL\nLinus\tlinux");
  });

  it("keeps copied grid rows aligned with the selected column range", () => {
    expect(
      formatGridSelection(
        [[1, "Ada"]],
        {
          startRow: 0,
          endRow: 0,
          startCol: 0,
          endCol: 2,
        },
        {
          columns: ["id", "name", "email"],
          includeHeaders: true,
        },
      ),
    ).toBe("id\tname\temail\n1\tAda\tNULL");
  });

  it("keeps copied grid headers aligned when the selected range exceeds known columns", () => {
    expect(
      formatGridSelection(
        [[1, "Ada"]],
        {
          startRow: 0,
          endRow: 0,
          startCol: 0,
          endCol: 2,
        },
        {
          columns: ["id", "name"],
          includeHeaders: true,
        },
      ),
    ).toBe("id\tname\tcolumn_3\n1\tAda\tNULL");
  });

  it("keeps duplicate selected column headers distinct", () => {
    expect(
      formatGridSelection(
        [[1, 10, "Ada"]],
        {
          startRow: 0,
          endRow: 0,
          startCol: 0,
          endCol: 2,
        },
        {
          columns: ["id", "id", "name"],
          includeHeaders: true,
        },
      ),
    ).toBe("id\tid_2\tname\n1\t10\tAda");
  });

  it("uses stable fallback headers for blank copied grid columns", () => {
    expect(
      formatGridSelection(
        [[1, 2, 3, 4]],
        {
          startRow: 0,
          endRow: 0,
          startCol: 0,
          endCol: 3,
        },
        {
          columns: ["", " ", "column_1", ""],
          includeHeaders: true,
        },
      ),
    ).toBe("column_1\tcolumn_2\tcolumn_1_2\tcolumn_4\n1\t2\t3\t4");
  });

  it("normalizes malformed copied grid ranges", () => {
    expect(
      formatGridSelection(
        [
          [1, "Ada", "ada@example.com"],
          [2, "Linus", "linus@example.com"],
        ],
        {
          startRow: 1,
          endRow: 0,
          startCol: 2,
          endCol: 1,
        },
        {
          columns: ["id", "name", "email"],
          includeHeaders: true,
        },
      ),
    ).toBe("name\temail\nAda\tada@example.com\nLinus\tlinus@example.com");

    expect(
      formatGridSelection([[1, "Ada"]], {
        startRow: Number.NaN,
        endRow: Number.NaN,
        startCol: Number.NaN,
        endCol: Number.NaN,
      }),
    ).toBe("1");
  });

  it("clamps fractional and negative copied grid ranges", () => {
    expect(
      formatGridSelection(
        [
          [1, "Ada"],
          [2, "Linus"],
        ],
        {
          startRow: -1,
          endRow: 1.8,
          startCol: -2,
          endCol: 1.2,
        },
      ),
    ).toBe("1\tAda\n2\tLinus");
  });
});
