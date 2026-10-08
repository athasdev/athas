/**
 * Scroll Debug Overlay - Shows real-time scroll metrics for debugging
 * Enable by setting localStorage.setItem('debug-scroll', 'true')
 */

import { useEffect, useRef, useState } from "react";
import { subscribeToEditorScroll } from "../../services/editor-scroll-events";
import { useEditorStateStore } from "../../stores/state.store";
import { getLineHeight } from "../../services/position";
import { useSettingsStore } from "@/features/settings/stores/settings.store";

interface ScrollMetrics {
  scrollTop: number;
  scrollLeft: number;
  viewportHeight: number;
  visibleStartLine: number;
  visibleEndLine: number;
  fps: number;
}

export function ScrollDebugOverlay() {
  const [enabled, setEnabled] = useState(false);
  const lastUpdateRef = useRef(Date.now());
  const [metrics, setMetrics] = useState<ScrollMetrics>({
    scrollTop: 0,
    scrollLeft: 0,
    viewportHeight: 0,
    visibleStartLine: 0,
    visibleEndLine: 0,
    fps: 0,
  });

  const fontSize = useSettingsStore((state) => state.settings.fontSize);
  const editorLineHeight = useSettingsStore((state) => state.settings.editorLineHeight);

  useEffect(() => {
    const checkDebugMode = () => {
      const debugEnabled = localStorage.getItem("debug-scroll") === "true";
      setEnabled(debugEnabled);
    };

    checkDebugMode();

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "debug-scroll") {
        checkDebugMode();
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const lineHeight = getLineHeight(fontSize, editorLineHeight);
    const measure = () => {
      const { viewportHeight, actions } = useEditorStateStore.getState();
      const { scrollTop, scrollLeft } = actions.getScroll();
      const now = Date.now();
      const timeDelta = now - lastUpdateRef.current;
      const fps = timeDelta > 0 ? Math.round(1000 / timeDelta) : 0;
      lastUpdateRef.current = now;

      setMetrics({
        scrollTop,
        scrollLeft,
        viewportHeight,
        visibleStartLine: Math.floor(scrollTop / lineHeight),
        visibleEndLine: Math.floor((scrollTop + viewportHeight) / lineHeight),
        fps,
      });
    };

    let frame: number | null = null;
    measure();
    const unsubscribe = subscribeToEditorScroll(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    });
    return () => {
      unsubscribe();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [enabled, fontSize, editorLineHeight]);

  if (!enabled) return null;

  return (
    <div
      className="fixed right-4 bottom-4 rounded border border-border bg-background p-3 font-mono text-foreground ui-text-sm shadow-(--shadow-popover)"
      style={{
        zIndex: 9999,
        backdropFilter: "blur(8px)",
        backgroundColor: "rgba(0, 0, 0, 0.85)",
      }}
    >
      <div className="mb-2 font-bold text-primary">Scroll Debug</div>
      <div className="space-y-1">
        <div>
          ScrollTop: <span className="text-info">{metrics.scrollTop.toFixed(0)}px</span>
        </div>
        <div>
          ScrollLeft: <span className="text-info">{metrics.scrollLeft.toFixed(0)}px</span>
        </div>
        <div>
          Viewport: <span className="text-info">{metrics.viewportHeight.toFixed(0)}px</span>
        </div>
        <div>
          Visible Lines:{" "}
          <span className="text-success">
            {metrics.visibleStartLine} - {metrics.visibleEndLine}
          </span>
        </div>
        <div>
          Update Rate: <span className="text-warning">{metrics.fps} FPS</span>
        </div>
      </div>
      <div className="mt-2 border-border border-t pt-2 text-subtle-foreground">
        Disable: localStorage.removeItem(&apos;debug-scroll&apos;)
      </div>
    </div>
  );
}
