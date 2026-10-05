// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const io = vi.hoisted(() => ({
  handler: null as null | ((action: { action: string; value?: string | null }) => void),
  unlisten: vi.fn(),
}));

vi.mock("../lib/menu-actions", () => ({
  listenToMenuActions: async (handler: typeof io.handler) => {
    io.handler = handler;
    return io.unlisten;
  },
}));

const { useMenuEvents } = await import("../hooks/use-menu-events");

type Props = Parameters<typeof useMenuEvents>[0];

function handlers(): Props {
  return new Proxy({} as Props, {
    get: (target, key: string) => (target[key as keyof Props] ??= vi.fn() as never),
  });
}

function Harness({ props }: { props: Props }) {
  useMenuEvents(props);
  return null;
}

let container: HTMLDivElement;
let root: Root;

describe("menu events", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    io.handler = null;
    io.unlisten.mockClear();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("dispatches every menu action from one listener", async () => {
    const props = handlers();
    await act(async () => root.render(<Harness props={props} />));

    act(() => io.handler?.({ action: "save" }));
    act(() => io.handler?.({ action: "execute_command", value: "editor.format" }));
    act(() => io.handler?.({ action: "theme_change", value: "athas-light" }));
    act(() => io.handler?.({ action: "unknown_action" }));

    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onExecuteCommand).toHaveBeenCalledWith("editor.format");
    expect(props.onThemeChange).toHaveBeenCalledWith("athas-light");
  });

  it("uses the latest handlers and stops listening on unmount", async () => {
    const first = handlers();
    const second = handlers();
    await act(async () => root.render(<Harness props={first} />));
    await act(async () => root.render(<Harness props={second} />));

    act(() => io.handler?.({ action: "new_file" }));
    expect(first.onNewFile).not.toHaveBeenCalled();
    expect(second.onNewFile).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    expect(io.unlisten).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });
});
