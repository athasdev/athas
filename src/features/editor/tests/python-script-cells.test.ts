import { describe, expect, it } from "vite-plus/test";
import { getPythonScriptCellAtOffset, getPythonScriptCells } from "../notebook/python-script-cells";

describe("python script cells", () => {
  it("finds percent cells and carries previous cells as setup", () => {
    const content = [
      "# %% imports",
      "import math",
      "",
      "# %% compute",
      "value = math.sqrt(9)",
      "",
      "# %% display",
      "print(value)",
      "",
    ].join("\n");

    const cells = getPythonScriptCells(content);

    expect(cells).toHaveLength(3);
    expect(cells[0]).toMatchObject({
      index: 0,
      markerLine: 0,
      startLine: 1,
      title: "imports",
      code: "import math",
      setupCode: "",
    });
    expect(cells[1]).toMatchObject({
      index: 1,
      markerLine: 3,
      startLine: 4,
      title: "compute",
      code: "value = math.sqrt(9)",
      setupCode: "import math",
    });
    expect(cells[2]).toMatchObject({
      index: 2,
      markerLine: 6,
      startLine: 7,
      title: "display",
      code: "print(value)",
      setupCode: "import math\nvalue = math.sqrt(9)",
    });
  });

  it("returns the cell at the cursor offset", () => {
    const content = "# %%\na = 1\n# %% second\nprint(a)\n";
    const offset = content.indexOf("print");

    expect(getPythonScriptCellAtOffset(content, offset)).toMatchObject({
      index: 1,
      title: "second",
      code: "print(a)",
      setupCode: "a = 1",
    });
  });

  it("ignores scripts without cell markers", () => {
    expect(getPythonScriptCells("print('plain script')\n")).toEqual([]);
  });
});
