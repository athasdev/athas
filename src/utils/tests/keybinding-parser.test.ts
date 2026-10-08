import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const os = vi.hoisted(() => ({ platform: "macos" }));

vi.mock("@tauri-apps/plugin-os", () => ({
  arch: () => "aarch64",
  platform: () => os.platform,
}));

async function loadParser(platform: string) {
  os.platform = platform;
  vi.resetModules();
  vi.stubGlobal("window", {});
  const { parseKeybinding } = await import("@/utils/keyboard/keybinding-parser");
  return parseKeybinding;
}

const parseKeybinding = await loadParser("macos");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("keybinding parser", () => {
  it("sorts and deduplicates modifiers so equivalent spellings compare equal", () => {
    expect(parseKeybinding("shift+cmd+P")).toEqual({
      parts: [{ modifiers: ["cmd", "shift"], key: "p" }],
      isChord: false,
    });
    expect(parseKeybinding("cmd+shift+cmd+p")).toEqual(parseKeybinding("shift+cmd+p"));
  });

  it("maps named keys and their aliases to KeyboardEvent key values", () => {
    expect(parseKeybinding("enter").parts[0].key).toBe("Enter");
    expect(parseKeybinding("return").parts[0].key).toBe("Enter");
    expect(parseKeybinding("esc").parts[0].key).toBe("Escape");
    expect(parseKeybinding("ctrl+space").parts[0]).toEqual({ modifiers: ["ctrl"], key: " " });
    expect(parseKeybinding("alt+up").parts[0]).toEqual({ modifiers: ["alt"], key: "ArrowUp" });
    expect(parseKeybinding("cmd+PageDown").parts[0].key).toBe("PageDown");
  });

  it("splits space separated combinations into a chord", () => {
    expect(parseKeybinding("cmd+k   cmd+shift+t")).toEqual({
      parts: [
        { modifiers: ["cmd"], key: "k" },
        { modifiers: ["cmd", "shift"], key: "t" },
      ],
      isChord: true,
    });
  });

  it("keeps cmd on macOS", () => {
    expect(parseKeybinding("cmd+s").parts[0].modifiers).toEqual(["cmd"]);
  });

  it.each(["windows", "linux"])("maps cmd to ctrl on %s, including inside chords", async (name) => {
    const parse = await loadParser(name);

    expect(parse("cmd+k cmd+t").parts).toEqual([
      { modifiers: ["ctrl"], key: "k" },
      { modifiers: ["ctrl"], key: "t" },
    ]);
    expect(parse("cmd+ctrl+s").parts[0].modifiers).toEqual(["ctrl"]);
  });
});
