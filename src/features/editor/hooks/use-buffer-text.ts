import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useWorkspaceStoreScopeId } from "@/features/workspace/stores/create-workspace-scoped-store";
import { hasTextContent, type PaneContent } from "@/features/panes/types/pane-content.types";
import { getBufferText } from "../services/open-buffer-text";
import { getLiveDocumentRevision, subscribeLiveDocument } from "../services/live-document-registry";
import { useBufferStore } from "../stores/buffer.store";
import { getBufferById } from "../stores/buffer-index";

/**
 * A number that changes whenever the buffer's text does, including edits an editor view has not
 * written to the store yet. Reading it never copies the text.
 */
export function useBufferTextRevision(bufferId: string | null | undefined): number {
  const storeRevision = useBufferStore(
    useCallback(
      (state: { buffers: PaneContent[] }) => {
        const buffer = getBufferById(state.buffers, bufferId ?? null);
        return buffer?.type === "editor" ? (buffer.contentRevision ?? 0) : 0;
      },
      [bufferId],
    ),
  );
  const subscribe = useCallback(
    (onChange: () => void) => (bufferId ? subscribeLiveDocument(bufferId, onChange) : () => {}),
    [bufferId],
  );
  const getLiveRevision = useCallback(
    () => (bufferId ? (getLiveDocumentRevision(bufferId) ?? 0) : 0),
    [bufferId],
  );
  const liveRevision = useSyncExternalStore(subscribe, getLiveRevision, getLiveRevision);
  return Math.max(storeRevision, liveRevision);
}

/**
 * `value` once it has stayed the same for `delay` ms. A change of `resetKey` (another buffer)
 * settles at once.
 */
function useSettledValue<T>(value: T, delay: number, resetKey?: unknown): T {
  const [settled, setSettled] = useState({ value, resetKey });
  const settleNow = delay <= 0 || settled.resetKey !== resetKey;
  if (settleNow && (settled.resetKey !== resetKey || !Object.is(settled.value, value))) {
    setSettled({ value, resetKey });
  }

  useEffect(() => {
    if (settleNow || Object.is(settled.value, value)) return;
    const timer = setTimeout(() => setSettled({ value, resetKey }), delay);
    return () => clearTimeout(timer);
  }, [delay, resetKey, settleNow, settled.value, value]);

  return settleNow ? value : settled.value;
}

/**
 * The buffer's current text for rendering. It is read when the text revision changes, after edits
 * pause for `debounceMs`, so a component showing it never subscribes to the text itself. Another
 * buffer is read at once.
 */
export function useBufferText(
  bufferId: string | null | undefined,
  { debounceMs = 0 }: { debounceMs?: number } = {},
): string {
  const workspaceId = useWorkspaceStoreScopeId();
  const revision = useBufferTextRevision(bufferId);
  // Text kinds other than editor buffers have no revision; their text is the store's.
  const storedText = useBufferStore(
    useCallback(
      (state: { buffers: PaneContent[] }) => {
        const buffer = getBufferById(state.buffers, bufferId ?? null);
        return buffer && buffer.type !== "editor" && hasTextContent(buffer) ? buffer.content : null;
      },
      [bufferId],
    ),
  );
  const settledRevision = useSettledValue(revision, debounceMs, bufferId);
  return useMemo(
    () => {
      if (storedText !== null) return storedText;
      return bufferId ? (getBufferText(bufferId, workspaceId) ?? "") : "";
    },
    // The text is read again only when its settled revision moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bufferId, settledRevision, storedText, workspaceId],
  );
}

const TEXT_FIELDS = new Set(["content", "savedContent", "contentRevision"]);

function sameExceptText(left: PaneContent, right: PaneContent): boolean {
  if (left === right) return true;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  const leftRecord = left as unknown as Record<string, unknown>;
  const rightRecord = right as unknown as Record<string, unknown>;
  return leftKeys.every((key) => TEXT_FIELDS.has(key) || leftRecord[key] === rightRecord[key]);
}

/**
 * The open buffers, kept as the same array while only their text changes. Text read from these
 * objects can be stale; read it with `getBufferText` when it is needed.
 */
export function useOpenBuffersIgnoringText(enabled = true): PaneContent[] {
  const selector = useMemo(() => {
    let last: PaneContent[] = [];
    return (state: { buffers: PaneContent[] }) => {
      const next = enabled ? state.buffers : [];
      if (
        next !== last &&
        (next.length !== last.length ||
          next.some((buffer, index) => !sameExceptText(buffer, last[index])))
      ) {
        last = next;
      }
      return last;
    };
  }, [enabled]);
  return useBufferStore(selector);
}

const objectStamps = new WeakMap<object, number>();
let nextObjectStamp = 1;

function stampOf(value: object): number {
  let stamp = objectStamps.get(value);
  if (stamp === undefined) {
    stamp = nextObjectStamp++;
    objectStamps.set(value, stamp);
  }
  return stamp;
}

function splitIds(idsKey: string): string[] {
  return idsKey ? idsKey.split("\n") : [];
}

/**
 * A key that changes when the text of any of `bufferIds` changes, settled for `settleMs`, so a
 * caller can re-read those texts (with `getBufferText`) without subscribing to them.
 */
export function useBuffersTextRevision(bufferIds: ReadonlySet<string>, settleMs = 0): string {
  const idsKey = [...bufferIds].sort().join("\n");
  const storeKey = useBufferStore(
    useCallback(
      (state: { buffers: PaneContent[] }) =>
        splitIds(idsKey)
          .map((id) => {
            const buffer = getBufferById(state.buffers, id);
            if (!buffer) return "-";
            return buffer.type === "editor"
              ? String(buffer.contentRevision ?? 0)
              : `o${stampOf(buffer)}`;
          })
          .join(","),
      [idsKey],
    ),
  );
  const subscribe = useCallback(
    (onChange: () => void) => {
      const unsubscribers = splitIds(idsKey).map((id) => subscribeLiveDocument(id, onChange));
      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
    [idsKey],
  );
  const getLiveKey = useCallback(
    () =>
      splitIds(idsKey)
        .map((id) => getLiveDocumentRevision(id) ?? 0)
        .join(","),
    [idsKey],
  );
  const liveKey = useSyncExternalStore(subscribe, getLiveKey, getLiveKey);
  return useSettledValue(`${storeKey}|${liveKey}`, settleMs, idsKey);
}
