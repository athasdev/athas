import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useLocalHistoryStore } from "@/features/local-history/store/local-history-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { toast } from "@/ui/toast";

export function openLocalHistoryForPath(path: string | null | undefined): void {
  if (!path || path.includes("://")) {
    toast.warning("Select a local file first.");
    return;
  }

  useLocalHistoryStore.getState().actions.setTargetPath(path);
  useUIState.getState().openCommandPaletteView("local-history");
}

export function openLocalHistoryForActiveFile(): void {
  const bufferStore = useBufferStore.getState();
  const activeBuffer = bufferStore.buffers.find(
    (buffer) => buffer.id === bufferStore.activeBufferId,
  );

  if (!activeBuffer || activeBuffer.type !== "editor" || activeBuffer.isVirtual) {
    toast.warning("Open a local file first.");
    return;
  }

  openLocalHistoryForPath(activeBuffer.path);
}
