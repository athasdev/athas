import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "@/ui/toast";
import { useSettingsStore } from "@/features/settings/store";
import { tokenizerWorkerClient } from "@/features/editor/lib/wasm-parser/tokenizer-worker-client";
import { buildTokenSpans, type Line } from "../lib/build-token-spans";
import { renderPng } from "../lib/render-png";
import { copyToClipboard, saveToFile } from "../lib/export";
import { useCodesnapStore } from "../stores/codesnap-store";
import { PreviewFrame } from "./preview-frame";
import { WidthHandle } from "./width-handle";
import { ShutterBar } from "./shutter-bar";
import type { CodesnapContent } from "@/features/panes/types/pane-content";
import type { CodesnapShutterAction } from "../types";

export function CodesnapTab({ pane }: { pane: CodesnapContent }) {
  const settings = useSettingsStore((s) => s.settings.codesnap);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [measured, setMeasured] = useState({ w: 0, h: 0 });

  const tabId = pane.id;
  const ensure = useCodesnapStore((s) => s.ensure);
  const setWidth = useCodesnapStore((s) => s.setWidth);
  const setShutterAction = useCodesnapStore((s) => s.setShutterAction);
  const setExporting = useCodesnapStore((s) => s.setExporting);
  const drop = useCodesnapStore((s) => s.drop);
  const tabState = useCodesnapStore((s) => s.tabs[tabId]);

  useEffect(() => {
    ensure(tabId, { width: settings.defaultWidth, shutterAction: settings.shutterAction });
    return () => drop(tabId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tokens = await tokenizerWorkerClient.tokenizeSnippet(
          pane.snapshot.text,
          pane.snapshot.language,
        );
        if (cancelled) return;
        // HighlightToken uses startIndex/endIndex/type; adapt to TokenLike shape.
        const adapted = tokens.map((t) => ({
          start: t.startIndex,
          end: t.endIndex,
          class_name: t.type,
        }));
        setLines(buildTokenSpans(pane.snapshot.text, adapted));
      } catch {
        setLines(
          buildTokenSpans(pane.snapshot.text, [
            { start: 0, end: pane.snapshot.text.length, class_name: "token-text" },
          ]),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pane.snapshot.text, pane.snapshot.language]);

  useLayoutEffect(() => {
    if (!frameRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setMeasured({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(frameRef.current);
    return () => ro.disconnect();
  }, []);

  const runShutter = async (action: CodesnapShutterAction) => {
    if (!frameRef.current) return;
    setExporting(tabId, true);
    try {
      const blob = await renderPng(frameRef.current, settings.pixelRatio);
      if (action === "copy") {
        await copyToClipboard(blob);
        toast.success("Copied to clipboard");
      } else {
        const saved = await saveToFile(blob, pane.snapshot);
        if (saved) toast.success(`Saved to ${saved}`);
      }
    } catch (err) {
      console.error("[CodeSnap] export failed:", err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : typeof err === "string" && err
            ? err
            : `Snapshot failed (${typeof err === "object" && err ? Object.prototype.toString.call(err) : typeof err})`;
      toast.error(message);
    } finally {
      setExporting(tabId, false);
    }
  };

  // Auto-focus the container on mount so keyboard shortcuts work without a click.
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Keyboard shortcuts when tab is focused.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      // Only respond if this tab's DOM is part of the focused subtree.
      if (!containerRef.current?.contains(document.activeElement)) return;
      if (e.key === "c") {
        e.preventDefault();
        void runShutter("copy");
      } else if (e.key === "s") {
        e.preventDefault();
        void runShutter("save");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.snapshot, settings.pixelRatio]);

  if (!tabState) return null;

  return (
    <div ref={containerRef} className="codesnap-tab" tabIndex={-1}>
      <div className="codesnap-canvas">
        <div className="codesnap-preview-wrap" style={{ position: "relative" }}>
          <PreviewFrame
            ref={frameRef}
            snapshot={pane.snapshot}
            settings={settings}
            width={tabState.width}
            lines={lines}
          />
          <WidthHandle width={tabState.width} onChange={(w) => setWidth(tabId, w)} />
        </div>
        <ShutterBar
          width={measured.w}
          height={measured.h}
          action={tabState.shutterAction}
          exporting={tabState.exporting}
          onActionChange={(a) => setShutterAction(tabId, a)}
          onShutter={() => void runShutter(tabState.shutterAction)}
        />
      </div>
    </div>
  );
}
