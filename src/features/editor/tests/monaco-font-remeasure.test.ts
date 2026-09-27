import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("monaco-editor", () => ({ editor: { remeasureFonts: vi.fn() } }));

import { remeasureWhenFontLoads, watchFontLoadsForMonaco } from "../engines/monaco/font-remeasure";

function createFonts({ loaded = false, faces = 1 } = {}) {
  const listeners: Array<(event: Event) => void> = [];
  const fonts = {
    check: vi.fn(() => loaded),
    load: vi.fn(async () => Array.from({ length: faces }, () => ({}) as FontFace)),
    addEventListener: vi.fn((_type: string, listener: (event: Event) => void) => {
      listeners.push(listener);
    }),
  };
  const emitLoadingDone = (fontfaces: FontFace[]) => {
    for (const listener of listeners) {
      listener(Object.assign(new Event("loadingdone"), { fontfaces }));
    }
  };
  return { fonts, emitLoadingDone };
}

describe("remeasureWhenFontLoads", () => {
  it("re-measures after the editor font finishes loading", async () => {
    const { fonts } = createFonts();
    const remeasure = vi.fn();

    await remeasureWhenFontLoads('"JetBrains Mono", Consolas, monospace', 14, {
      fonts,
      remeasure,
    });

    expect(fonts.load).toHaveBeenCalledWith('14px "JetBrains Mono", Consolas, monospace');
    expect(remeasure).toHaveBeenCalledTimes(1);
  });

  it("skips work when the font is already available", async () => {
    const { fonts } = createFonts({ loaded: true });
    const remeasure = vi.fn();

    await remeasureWhenFontLoads("Menlo", 13, { fonts, remeasure });

    expect(fonts.load).not.toHaveBeenCalled();
    expect(remeasure).not.toHaveBeenCalled();
  });

  it("does not re-measure when no font face was loaded", async () => {
    const { fonts } = createFonts({ faces: 0 });
    const remeasure = vi.fn();

    await remeasureWhenFontLoads("Missing Font", 13, { fonts, remeasure });

    expect(remeasure).not.toHaveBeenCalled();
  });
});

describe("watchFontLoadsForMonaco", () => {
  it("re-measures once per finished font load and subscribes only once", () => {
    const { fonts, emitLoadingDone } = createFonts();
    const remeasure = vi.fn();

    watchFontLoadsForMonaco({ fonts, remeasure });
    watchFontLoadsForMonaco({ fonts, remeasure });
    emitLoadingDone([{} as FontFace]);
    emitLoadingDone([]);

    expect(fonts.addEventListener).toHaveBeenCalledTimes(1);
    expect(remeasure).toHaveBeenCalledTimes(1);
  });
});
