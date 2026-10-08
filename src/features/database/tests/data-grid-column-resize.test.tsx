// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import DataGrid from "../components/data-grid";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));

let root: Root;
let container: HTMLDivElement;

function renderGrid(onColumnWidthChange: (table: string, column: string, width: number) => void) {
  act(() => {
    root.render(
      <DataGrid
        queryResult={{ columns: ["id", "name"], rows: [[1, "a"]] }}
        tableMeta={[]}
        tableName="users"
        currentPage={1}
        pageSize={50}
        sortColumn={null}
        sortDirection="asc"
        showColumnTypes={false}
        onColumnSort={vi.fn()}
        onAddColumnFilter={vi.fn()}
        onRowContextMenu={vi.fn()}
        onCellEdit={vi.fn()}
        onCreateRow={vi.fn()}
        columnWidths={{ users: { name: 200 } }}
        onColumnWidthChange={onColumnWidthChange}
      />,
    );
  });
}

function pointer(target: Element, type: string, clientX: number) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX }));
  });
}

function nameHeader() {
  return Array.from(container.querySelectorAll("th")).find((th) =>
    th.textContent?.includes("name"),
  )!;
}

describe("DataGrid column resize", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    HTMLElement.prototype.setPointerCapture = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the in-progress width local and commits it once on pointerup", () => {
    const onColumnWidthChange = vi.fn();
    renderGrid(onColumnWidthChange);
    const header = nameHeader();
    const handle = header.querySelector(".cursor-col-resize")!;

    pointer(handle, "pointerdown", 100);
    pointer(handle, "pointermove", 130);
    pointer(handle, "pointermove", 160);

    expect(onColumnWidthChange).not.toHaveBeenCalled();
    expect(header.style.width).toBe("260px");

    pointer(handle, "pointerup", 160);

    expect(onColumnWidthChange).toHaveBeenCalledTimes(1);
    expect(onColumnWidthChange).toHaveBeenCalledWith("users", "name", 260);
  });

  it("clamps to the minimum width and skips the commit when the width is unchanged", () => {
    const onColumnWidthChange = vi.fn();
    renderGrid(onColumnWidthChange);
    const header = nameHeader();
    const handle = header.querySelector(".cursor-col-resize")!;

    pointer(handle, "pointerdown", 300);
    pointer(handle, "pointermove", 0);
    expect(header.style.width).toBe("60px");
    pointer(handle, "pointermove", 300);
    pointer(handle, "pointerup", 300);

    expect(onColumnWidthChange).not.toHaveBeenCalled();
    expect(header.style.width).toBe("200px");
  });
});
