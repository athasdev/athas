import {
  selectActiveBufferId,
  selectIsBufferPinned,
  selectIsBufferPreview,
} from "../stores/pane-selectors";
import { usePaneStore } from "../stores/pane.store";

export function useActiveBufferId(): string | null {
  return usePaneStore(selectActiveBufferId);
}

export function useIsBufferActive(bufferId: string | null | undefined): boolean {
  return usePaneStore((state) => !!bufferId && selectActiveBufferId(state) === bufferId);
}

export function useIsBufferPinned(bufferId: string | null | undefined): boolean {
  return usePaneStore((state) => !!bufferId && selectIsBufferPinned(state, bufferId));
}

export function useIsBufferPreview(bufferId: string | null | undefined): boolean {
  return usePaneStore((state) => !!bufferId && selectIsBufferPreview(state, bufferId));
}

/** `bufferId` when given, else the active buffer; only subscribes to tab changes when needed. */
export function useBufferIdOrActive(bufferId: string | null | undefined): string | null {
  return usePaneStore((state) => bufferId ?? selectActiveBufferId(state));
}
