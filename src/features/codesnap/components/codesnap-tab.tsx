import { Aperture } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "@/ui/toast";
import { useSettingsStore } from "@/features/settings/store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { tokenizerWorkerClient } from "@/features/editor/lib/wasm-parser/tokenizer-worker-client";
import { getLanguageAssetConfig } from "@/features/editor/lib/wasm-parser/extension-assets";
import { getLanguageIdFromPath } from "@/features/editor/utils/language-id";
import { buildTokenSpans, type Line } from "../lib/build-token-spans";
import {
  buildSnapshotFromBuffer,
  buildSnapshotFromSelection,
} from "../lib/snapshot-from-selection";
import { renderPng } from "../lib/render-png";
import { copyToClipboard, saveToFile } from "../lib/export";
import { useCodesnapStore } from "../stores/codesnap-store";
import { PreviewFrame } from "./preview-frame";
import { WidthHandle } from "./width-handle";
import { ShutterBar } from "./shutter-bar";
import type {
  CodesnapContent,
  EditorContent,
  PaneContent,
} from "@/features/panes/types/pane-content";
import type { CodesnapShutterAction, SourceSnapshot } from "../types";

function readActiveEditorSourceFromGlobalState(): SourceSnapshot | null {
  const bufState = useBufferStore.getState();
  const buf = bufState.buffers.find((b: PaneContent) => b.id === bufState.activeBufferId);
  if (!buf || buf.type !== "editor") return null;
  const editor = buf as EditorContent;
  if (typeof editor.content !== "string") return null;
  // The editor's tokenizer derives the parser language from the file path
  // (see use-tokenizer.ts -> getLanguageIdFromPath), not from the buffer's
  // `language` UI field which can be set to "text" for many code files. Use
  // the same resolution so CodeSnap loads the same parser as the editor pane.
  const pathLang = editor.path ? getLanguageIdFromPath(editor.path) : null;
  const language = editor.languageOverride ?? pathLang ?? editor.language ?? "plaintext";
  const source = {
    content: editor.content,
    path: editor.path || null,
    language,
  };
  const sel = useEditorStateStore.getState().selection;
  const selInput = sel
    ? {
        start: { line: sel.start.line, column: sel.start.column },
        end: { line: sel.end.line, column: sel.end.column },
      }
    : null;
  return buildSnapshotFromSelection(selInput, source) ?? buildSnapshotFromBuffer(source);
}

export function CodesnapTab({ pane }: { pane: CodesnapContent }) {
  const settings = useSettingsStore((s) => s.settings.codesnap);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [measured, setMeasured] = useState({ w: 0, h: 0 });

  // Live-tracking snapshot. Initialized from the snapshot captured at trigger
  // time; updated whenever the user changes selection or buffer in the source
  // pane. When the active buffer is not an editor (e.g. user focused this
  // CodeSnap pane), the last snapshot persists rather than being cleared.
  const [snapshot, setSnapshot] = useState<SourceSnapshot>(pane.snapshot);

  useEffect(() => {
    const recompute = () => {
      const next = readActiveEditorSourceFromGlobalState();
      if (next) setSnapshot(next);
    };
    // Pick up any selection/buffer change that happened between trigger and mount.
    recompute();
    const unsubBuffer = useBufferStore.subscribe(recompute);
    const unsubEditor = useEditorStateStore.subscribe(recompute);
    return () => {
      unsubBuffer();
      unsubEditor();
    };
  }, []);

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
        const assets = getLanguageAssetConfig(snapshot.language);
        console.log("[CodeSnap] tokenize:", {
          language: snapshot.language,
          textLength: snapshot.text.length,
          wasmPath: assets.wasmPath,
          highlightQueryUrl: assets.highlightQueryUrl,
        });
        const tokens = await tokenizerWorkerClient.tokenizeSnippet(
          snapshot.text,
          snapshot.language,
          { wasmPath: assets.wasmPath, highlightQueryUrl: assets.highlightQueryUrl },
        );
        if (cancelled) return;
        console.log(
          `[CodeSnap] tokenizer returned ${tokens.length} tokens; first 5:`,
          tokens.slice(0, 5).map((t) => ({ type: t.type, range: [t.startIndex, t.endIndex] })),
        );
        if (tokens.length === 0) {
          console.warn(
            `[CodeSnap] 0 tokens. Likely: language not bundled, parser failed to load, or highlight query missing.`,
          );
        }
        // HighlightToken uses startIndex/endIndex/type; adapt to TokenLike shape.
        const adapted = tokens.map((t) => ({
          start: t.startIndex,
          end: t.endIndex,
          class_name: t.type,
        }));
        setLines(buildTokenSpans(snapshot.text, adapted));
      } catch (err) {
        console.warn(`[CodeSnap] tokenizeSnippet failed for language="${snapshot.language}":`, err);
        setLines(
          buildTokenSpans(snapshot.text, [
            { start: 0, end: snapshot.text.length, class_name: "token-text" },
          ]),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshot.text, snapshot.language]);

  // Observe the rendered preview frame to populate the width × height readout.
  // Depend on `tabState` so the observer re-attaches once the codesnap state
  // is initialized (first render returns null before the frame exists).
  useLayoutEffect(() => {
    if (!frameRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setMeasured({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(frameRef.current);
    return () => ro.disconnect();
  }, [tabState]);

  // Preview width is purely user-controlled via the drag handle and the
  // `codesnap.defaultWidth` setting. We deliberately don't clamp to the pane
  // size — clipping/wrapping long lines would destroy the visual structure of
  // the code. When the preview is wider than the pane, the canvas scrolls.

  const runShutter = async (action: CodesnapShutterAction) => {
    if (!frameRef.current) return;
    setExporting(tabId, true);
    try {
      const blob = await renderPng(frameRef.current, settings.pixelRatio);
      if (action === "copy") {
        await copyToClipboard(blob);
        toast.success("Copied to clipboard");
      } else {
        const saved = await saveToFile(blob, snapshot);
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
  }, [snapshot, settings.pixelRatio]);

  if (!tabState) return null;

  return (
    <div ref={containerRef} className="codesnap-tab" tabIndex={-1}>
      <div className="codesnap-canvas">
        <Aperture size={36} weight="duotone" className="codesnap-brand-icon" aria-hidden="true" />
        <div className="codesnap-preview-wrap" style={{ position: "relative" }}>
          <PreviewFrame
            ref={frameRef}
            snapshot={snapshot}
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
