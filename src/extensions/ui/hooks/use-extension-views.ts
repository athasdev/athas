import { useUIExtensionStore } from "../stores/ui-extension-store";

export function useExtensionViews() {
  return useUIExtensionStore.use.sidebarViews();
}
