import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { IS_LINUX } from "@/utils/platform";

export function useNativeWindowChrome() {
  const [usesNativeWindowChrome, setUsesNativeWindowChrome] = useState(IS_LINUX);

  useEffect(() => {
    if (!IS_LINUX) {
      setUsesNativeWindowChrome(false);
      return;
    }

    let cancelled = false;

    void invoke<boolean>("uses_native_window_chrome")
      .then((value) => {
        if (!cancelled) {
          setUsesNativeWindowChrome(value);
        }
      })
      .catch((error) => {
        console.error("Failed to detect native window chrome:", error);
        if (!cancelled) {
          setUsesNativeWindowChrome(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return usesNativeWindowChrome;
}
