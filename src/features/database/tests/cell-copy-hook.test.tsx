// @vitest-environment jsdom
import { act, createElement, type MouseEvent as ReactMouseEvent } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const clipboard = vi.hoisted(() => ({ write: vi.fn(async () => true) }));

vi.mock("@/utils/clipboard", () => ({ tryWriteClipboardText: clipboard.write }));

import { formatCellValue, useCellCopy } from "../hooks/use-cell-copy";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function renderCellCopy() {
  const result = {} as { current: ReturnType<typeof useCellCopy> };
  function Probe() {
    result.current = useCellCopy();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return result;
}

function contextMenuEvent() {
  return {
    clientX: 12,
    clientY: 34,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as ReactMouseEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  clipboard.write.mockClear();
});

describe("useCellCopy", () => {
  it("opens the cell menu at the pointer without the native menu", () => {
    const result = renderCellCopy();
    const event = contextMenuEvent();

    act(() => result.current.handleCellContextMenu(event, 42, "id"));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(result.current.cellMenu).toEqual({
      position: { x: 12, y: 34 },
      value: 42,
      columnName: "id",
      copyText: undefined,
      copyTextWithHeaders: undefined,
    });

    act(() => result.current.closeCellMenu());
    expect(result.current.cellMenu).toBeNull();
  });

  it("copies the formatted value and closes the menu", async () => {
    const result = renderCellCopy();
    act(() => result.current.handleCellContextMenu(contextMenuEvent(), { a: 1 }, "data"));

    await act(async () => result.current.copyValue());

    expect(clipboard.write).toHaveBeenCalledWith('{\n  "a": 1\n}');
    expect(result.current.cellMenu).toBeNull();
  });

  it("prefers prepared copy text and copies with headers when offered", async () => {
    const result = renderCellCopy();
    act(() =>
      result.current.handleCellContextMenu(contextMenuEvent(), null, "name", "Ada", "name\nAda"),
    );

    await act(async () => result.current.copyValueWithHeaders());
    expect(clipboard.write).toHaveBeenLastCalledWith("name\nAda");

    act(() => result.current.handleCellContextMenu(contextMenuEvent(), null, "name", "Ada"));
    await act(async () => result.current.copyValueWithHeaders());
    expect(clipboard.write).toHaveBeenCalledOnce();
    expect(result.current.cellMenu).not.toBeNull();

    await act(async () => result.current.copyValue());
    expect(clipboard.write).toHaveBeenLastCalledWith("Ada");
  });

  it("does nothing without an open menu", async () => {
    const result = renderCellCopy();

    await act(async () => result.current.copyValue());
    await act(async () => result.current.copyValueWithHeaders());

    expect(clipboard.write).not.toHaveBeenCalled();
  });

  it("formats NULL, objects and primitives for the clipboard", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(formatCellValue(null)).toBe("NULL");
    expect(formatCellValue(undefined)).toBe("NULL");
    expect(formatCellValue(true)).toBe("true");
    expect(formatCellValue([1, 2])).toBe("[\n  1,\n  2\n]");
    expect(formatCellValue(circular)).toBe("[object Object]");
  });
});
