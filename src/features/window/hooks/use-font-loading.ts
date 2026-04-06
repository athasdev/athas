import { useEffect } from "react";
import { useFontStore } from "@/features/settings/stores/font-store";

export function useFontLoading() {
  const { loadAvailableFonts } = useFontStore.use.actions();

  useEffect(() => {
    loadAvailableFonts();
  }, [loadAvailableFonts]);
}
