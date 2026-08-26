import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { syncEffectiveWindowTransparency } from "@/features/settings/lib/settings-effects";

interface SystemAccessibilityPreferences {
  reduceTransparency: boolean;
  increaseContrast: boolean;
  differentiateWithoutColor: boolean;
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
      syncEffectiveWindowTransparency();
    };

    void sync();
    window.addEventListener("focus", sync);
    contrastQuery.addEventListener("change", sync);
    transparencyQuery.addEventListener("change", sync);

    return () => {
      window.removeEventListener("focus", sync);
      contrastQuery.removeEventListener("change", sync);
      transparencyQuery.removeEventListener("change", sync);
    };
  }, []);
}
