import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { appendTrafficEntries } from "../lib/acp-traffic-messages";
import type {
  AcpInitializeExchange,
  AcpTrafficBacklog,
  AcpTrafficEntry,
  AcpTrafficEvent,
  AcpTrafficProcess,
} from "../types/acp-traffic.types";

const FLUSH_INTERVAL_MS = 150;
const EMPTY_INITIALIZE: AcpInitializeExchange = { request: null, response: null };

function upsertProcess(
  processes: AcpTrafficProcess[],
  process: AcpTrafficProcess,
): AcpTrafficProcess[] {
  const rest = processes.filter((item) => item.processKey !== process.processKey);
  return [process, ...rest].sort(
    (a, b) => Number(b.running) - Number(a.running) || b.startedAtMs - a.startedAtMs,
  );
}

/**
 * The agent processes the inspector can show and the traffic of the selected one. Live lines
 * arrive as batched `acp-traffic` events while the inspector is mounted and are applied on a
 * timer so a streaming agent does not re-render the log for every batch.
 */
export function useAcpTraffic() {
  const [processes, setProcesses] = useState<AcpTrafficProcess[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [entries, setEntries] = useState<AcpTrafficEntry[]>([]);
  const [initialize, setInitialize] = useState<AcpInitializeExchange>(EMPTY_INITIALIZE);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedKeyRef = useRef<string | null>(null);
  const pendingRef = useRef<AcpTrafficEntry[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const loadingRef = useRef(false);

  const loadBacklog = useCallback(async (processKey: string) => {
    setIsLoading(true);
    loadingRef.current = true;
    pendingRef.current = [];
    try {
      const backlog = await invoke<AcpTrafficBacklog | null>("get_acp_traffic", { processKey });
      if (selectedKeyRef.current !== processKey) return;
      startedAtRef.current = backlog?.process.startedAtMs ?? null;
      setEntries(appendTrafficEntries(backlog?.entries ?? [], pendingRef.current));
      pendingRef.current = [];
      setInitialize(backlog?.initialize ?? EMPTY_INITIALIZE);
      setError(null);
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    selectedKeyRef.current = selectedKey;
    setEntries([]);
    setInitialize(EMPTY_INITIALIZE);
    startedAtRef.current = null;
    if (selectedKey) void loadBacklog(selectedKey);
  }, [loadBacklog, selectedKey]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      const stopListening = await listen<AcpTrafficEvent>("acp-traffic", ({ payload }) => {
        if (payload.type === "process") {
          setProcesses((current) => upsertProcess(current, payload.process));
          const { process } = payload;
          setSelectedKey((current) => current ?? process.processKey);
          if (
            process.processKey === selectedKeyRef.current &&
            startedAtRef.current !== null &&
            process.startedAtMs !== startedAtRef.current
          ) {
            void loadBacklog(process.processKey);
          }
          return;
        }
        if (payload.processKey !== selectedKeyRef.current) return;
        if (payload.type === "initialize") {
          setInitialize(payload.initialize);
          return;
        }
        pendingRef.current.push(...payload.entries);
      });
      if (disposed) {
        stopListening();
        return;
      }
      unlisten = stopListening;
      await invoke("subscribe_acp_traffic");
      const initial = await invoke<AcpTrafficProcess[]>("get_acp_traffic_processes");
      if (disposed) return;
      setProcesses(initial);
      setSelectedKey((current) => current ?? initial[0]?.processKey ?? null);
    })().catch((listenError) => setError(String(listenError)));

    const flush = window.setInterval(() => {
      // While a backlog loads, live lines wait so they merge after it instead of being replaced.
      if (loadingRef.current || pendingRef.current.length === 0) return;
      const batch = pendingRef.current;
      pendingRef.current = [];
      setEntries((current) => appendTrafficEntries(current, batch));
    }, FLUSH_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(flush);
      if (unlisten) {
        unlisten();
        void invoke("unsubscribe_acp_traffic");
      }
    };
  }, [loadBacklog]);

  const clear = useCallback(async () => {
    if (!selectedKey) return;
    await invoke("clear_acp_traffic", { processKey: selectedKey });
    pendingRef.current = [];
    setEntries([]);
  }, [selectedKey]);

  const exportTo = useCallback(
    async (path: string) => {
      if (!selectedKey) return;
      await invoke("export_acp_traffic", { processKey: selectedKey, path });
    },
    [selectedKey],
  );

  const selectedProcess = processes.find((process) => process.processKey === selectedKey) ?? null;

  return {
    processes,
    selectedProcess,
    selectProcess: setSelectedKey,
    entries,
    initialize,
    isLoading,
    error,
    clear,
    exportTo,
  };
}
