import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { syncEffectiveWindowTransparency } from "@/features/settings/lib/settings-effects";

interface SystemAccessibilityPreferences {
  reduceTransparency: boolean;
  increaseContrast: boolean;
  differentiateWithoutColor: boolean;
  reduceMotion: boolean;
}

function setBooleanAttribute(name: string, enabled: boolean) {
  document.documentElement.setAttribute(name, enabled ? "true" : "false");
}

export function useSystemAccessibility() {
  useEffect(() => {
    const contrastQuery = window.matchMedia("(prefers-contrast: more)");
    const transparencyQuery = window.matchMedia("(prefers-reduced-transparency: reduce)");

    const sync = async () => {
      let nativePreferences: SystemAccessibilityPreferences = {
        reduceTransparency: false,
        increaseContrast: false,
        differentiateWithoutColor: false,
        reduceMotion: false,
      };

      try {
        nativePreferences = await invoke<SystemAccessibilityPreferences>(
          "get_system_accessibility_preferences",
        );
      } catch {
        nativePreferences.reduceTransparency = transparencyQuery.matches;
        nativePreferences.increaseContrast = contrastQuery.matches;
      }

      setBooleanAttribute(
        "data-reduce-transparency",
        nativePreferences.reduceTransparency || transparencyQuery.matches,
      );
      setBooleanAttribute(
        "data-increase-contrast",
        nativePreferences.increaseContrast || contrastQuery.matches,
      );
      setBooleanAttribute(
        "data-differentiate-without-color",
        nativePreferences.differentiateWithoutColor,
      );
      setBooleanAttribute("data-reduce-motion", nativePreferences.reduceMotion);
      syncEffectiveWindowTransparency();
    };

    void sync();
    const unlistenPromise = listen("system_accessibility_changed", sync);
    window.addEventListener("focus", sync);
    contrastQuery.addEventListener("change", sync);
    transparencyQuery.addEventListener("change", sync);

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
      window.removeEventListener("focus", sync);
      contrastQuery.removeEventListener("change", sync);
      transparencyQuery.removeEventListener("change", sync);
    };
  }, []);
}
