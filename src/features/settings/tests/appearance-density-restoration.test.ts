// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  APPEARANCE_BOOTSTRAP_CACHE_KEY,
  DEFAULT_APPEARANCE_BOOTSTRAP_CACHE,
  cacheUiDensityForBootstrap,
  cacheThemeForBootstrap,
  ensureStartupAppearanceApplied,
  readAppearanceBootstrapCache,
} from "../lib/appearance-bootstrap";
import { getAthasDefaultCssVariables } from "@/extensions/themes/default-theme";
beforeEach(() => window.localStorage.clear());
afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-ui-density");
});
describe("density startup restoration", () => {
  it("restores comfortable density before the settings store loads", () => {
    cacheUiDensityForBootstrap("comfortable");
    cacheThemeForBootstrap({
      id: "athas-light",
      name: "Athas Light",
      description: "Default",
      category: "Light",
      isDark: false,
      cssVariables: getAthasDefaultCssVariables("light"),
    });
    ensureStartupAppearanceApplied();
    expect(document.documentElement.getAttribute("data-ui-density")).toBe("comfortable");
    expect(readAppearanceBootstrapCache()?.themeType).toBe("light");
  });
  it.each([undefined, "invalid"])(
    "defaults an old or invalid cache density %s to compact",
    (density) => {
      window.localStorage.setItem(
        APPEARANCE_BOOTSTRAP_CACHE_KEY,
        JSON.stringify({ ...DEFAULT_APPEARANCE_BOOTSTRAP_CACHE, uiDensity: density }),
      );
      ensureStartupAppearanceApplied();
      expect(document.documentElement.getAttribute("data-ui-density")).toBe("compact");
    },
  );
});
