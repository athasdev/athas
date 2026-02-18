/**
 * Scroll Debug Overlay - Shows real-time scroll metrics for debugging
 * Enable by setting localStorage.setItem('debug-scroll', 'true')
 */

import { useEffect, useState } from "react";
import { useEditorSettingsStore } from "../../stores/settings-store";
import { useEditorStateStore } from "../../stores/state-store";
import { getLineHeight } from "../../utils/position";

interface ScrollMetrics {
  scrollTop: number;
  scrollLeft: number;
  viewportHeight: number;
  visibleStartLine: number;
  visibleEndLine: number;
  fps: number;
  lastUpdate: number;
}

export function ScrollDebugOverlay() {
  const [enabled, setEnabled] = useState(false);
  const [metrics, setMetrics] = useState<ScrollMetrics>({
    scrollTop: 0,
    scrollLeft: 0,
    viewportHeight: 0,
    visibleStartLine: 0,
    visibleEndLine: 0,
    fps: 0,
    lastUpdate: Date.now(),
  });

  const scrollTop = useEditorStateStore.use.scrollTop();
  const scrollLeft = useEditorStateStore.use.scrollLeft();
  const viewportHeight = useEditorStateStore.use.viewportHeight();
  const fontSize = useEditorSettingsStore.use.fontSize();

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

    const lineHeight = getLineHeight(fontSize);
    const now = Date.now();
    const timeDelta = now - metrics.lastUpdate;
    const fps = timeDelta > 0 ? Math.round(1000 / timeDelta) : 0;

    setMetrics({
      scrollTop,
      scrollLeft,
      viewportHeight,
      visibleStartLine: Math.floor(scrollTop / lineHeight),
      visibleEndLine: Math.floor((scrollTop + viewportHeight) / lineHeight),
      fps,
      lastUpdate: now,
    });
  }, [enabled, scrollTop, scrollLeft, viewportHeight, fontSize, metrics.lastUpdate]);

  if (!enabled) return null;

  return (
    <div
      className="fixed right-4 bottom-4 rounded border border-border bg-primary-bg p-3 font-mono text-text text-xs shadow-lg"
      style={{
        zIndex: 9999,
        backdropFilter: "blur(8px)",
        backgroundColor: "rgba(0, 0, 0, 0.85)",
      }}
    >
      <div className="mb-2 font-bold text-accent">Scroll Debug</div>
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
      <div className="mt-2 border-border border-t pt-2 text-text-lighter">
        Disable: localStorage.removeItem(&apos;debug-scroll&apos;)
      </div>
    </div>
  );
}
