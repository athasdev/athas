import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { enableMapSet } from "immer";

enableMapSet();

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: vi.fn(),
    onDragDropEvent: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: vi.fn(),
  }),
}));

import { useVimStore } from "../../stores/vim-store";

describe("vim register system", () => {
  beforeEach(() => {
    useVimStore.getState().actions.reset();
  });

  it("writes to unnamed register by default", () => {
    const { writeToRegister, readFromRegister } = useVimStore.getState().actions;
    writeToRegister("hello", false, false);
    const reg = readFromRegister();
    expect(reg).toEqual({ content: "hello", linewise: false });
  });

  it("writes delete to numbered register 1 and shifts down", () => {
    const { writeToRegister, getNamedRegister } = useVimStore.getState().actions;
    writeToRegister("first", false, true);
    writeToRegister("second", false, true);

    expect(getNamedRegister("1")).toEqual({ content: "second", linewise: false });
    expect(getNamedRegister("2")).toEqual({ content: "first", linewise: false });
  });

  it("writes yank to register 0", () => {
    const { writeToRegister, getNamedRegister } = useVimStore.getState().actions;
    writeToRegister("yanked", false, false);
    expect(getNamedRegister("0")).toEqual({ content: "yanked", linewise: false });
  });

  it("writes to named register", () => {
    const { setCurrentRegister, writeToRegister, getNamedRegister } =
      useVimStore.getState().actions;
    setCurrentRegister("a");
    writeToRegister("named", false, false);
    expect(getNamedRegister("a")).toEqual({ content: "named", linewise: false });
  });

  it("appends to named register with uppercase", () => {
    const { setCurrentRegister, writeToRegister, getNamedRegister } =
      useVimStore.getState().actions;
    setCurrentRegister("a");
    writeToRegister("hello", false, false);

    setCurrentRegister("A");
    writeToRegister(" world", false, false);

    expect(getNamedRegister("a")).toEqual({ content: "hello world", linewise: false });
  });

  it.todo("does not clear currentRegister on read (BUG: readFromRegister clears currentRegister)", () => {
    const { setCurrentRegister, writeToRegister, readFromRegister, getNamedRegister } =
      useVimStore.getState().actions;
    setCurrentRegister("a");
    writeToRegister("hello", false, false);

    const firstRead = readFromRegister();
    expect(firstRead).toEqual({ content: "hello", linewise: false });

    // Second read should still use register "a", not fall back to unnamed
    const secondRead = readFromRegister();
    expect(secondRead).toEqual({ content: "hello", linewise: false });
  });
});
