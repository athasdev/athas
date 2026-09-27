import { editor as monacoEditor } from "monaco-editor";
import { useEffect } from "react";

type FontLoader = Pick<FontFaceSet, "check" | "load" | "addEventListener">;

interface FontRemeasureDeps {
  fonts?: FontLoader;
  remeasure?: () => void;
}

const remeasureMonacoFonts = () => monacoEditor.remeasureFonts();
const watchedFontSets = new WeakSet<FontLoader>();

function defaultFonts(): FontLoader | undefined {
  return typeof document === "undefined" ? undefined : document.fonts;
}

/**
 * Monaco caches glyph widths the first time it measures a font. When an editor
 * is created before a web font such as the bundled JetBrains Mono finishes
 * loading, Monaco keeps the fallback font's widths while the text renders with
 * the real font, so the cursor and selection drift away from the text toward
 * the end of longer lines. Re-measure whenever the document finishes loading
 * font faces.
 */
export function watchFontLoadsForMonaco({
  fonts = defaultFonts(),
  remeasure = remeasureMonacoFonts,
}: FontRemeasureDeps = {}) {
  if (!fonts || watchedFontSets.has(fonts)) return;
  watchedFontSets.add(fonts);

  fonts.addEventListener("loadingdone", (event) => {
    if ((event as FontFaceSetLoadEvent).fontfaces?.length === 0) return;
    remeasure();
  });
}

/**
 * Starts loading the editor font right away and re-measures once it is ready,
 * instead of waiting for Monaco's first paint to request it lazily.
 */
export async function remeasureWhenFontLoads(
  fontFamily: string,
  fontSize: number,
  { fonts = defaultFonts(), remeasure = remeasureMonacoFonts }: FontRemeasureDeps = {},
) {
  if (!fonts) return;

  const font = `${fontSize}px ${fontFamily}`;
  try {
    if (fonts.check(font)) return;
    const loaded = await fonts.load(font);
    if (loaded.length > 0) remeasure();
  } catch (error) {
    console.warn(`Failed to load editor font ${font}:`, error);
  }
}

export function useMonacoFontRemeasure(fontFamily: string, fontSize: number) {
  useEffect(() => {
    watchFontLoadsForMonaco();
    void remeasureWhenFontLoads(fontFamily, fontSize);
  }, [fontFamily, fontSize]);
}
