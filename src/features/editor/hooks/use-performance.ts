/**
 * Performance hook for tracking core editor metrics
 */
import { useCallback, useRef } from "react";
import { frontendTrace } from "@/utils/frontend-trace";

export function usePerformanceMonitor(componentName: string) {
  const markStacksRef = useRef<Map<string, string[]>>(new Map());
  const sequenceRef = useRef(0);

  const startMeasure = useCallback(
    (metricName: string) => {
      const markName = `${componentName}:${metricName}:start:${sequenceRef.current++}`;
      performance.mark(markName);
      const metricStack = markStacksRef.current.get(metricName) ?? [];
      metricStack.push(markName);
      markStacksRef.current.set(metricName, metricStack);
    },
    [componentName],
  );

  const endMeasure = useCallback(
    (metricName: string) => {
      const measureName = `${componentName}:${metricName}`;
      const metricStack = markStacksRef.current.get(metricName);
      const startMarkName = metricStack?.pop();

      if (!startMarkName) {
        return;
      }

      const endMarkName = `${measureName}:end:${sequenceRef.current++}`;

      performance.mark(endMarkName);

      try {
        performance.measure(measureName, startMarkName, endMarkName);
        const entries = performance.getEntriesByName(measureName);
        const lastEntry = entries[entries.length - 1];
        if (lastEntry) {
          frontendTrace(
            lastEntry.duration >= 250 ? "warn" : "info",
            "bench:perf",
            `${componentName}:${metricName}`,
            {
              durationMs: Math.round(lastEntry.duration * 100) / 100,
            },
          );
          window.dispatchEvent(
            new CustomEvent("performance-metric", {
              detail: {
                component: componentName,
                metric: metricName,
                duration: lastEntry.duration,
                timestamp: Date.now(),
              },
            }),
          );
          return lastEntry.duration;
        }
      } catch (e) {
        console.warn(`Failed to measure ${measureName}`, e);
      } finally {
        performance.clearMarks(startMarkName);
        performance.clearMarks(endMarkName);
        performance.clearMeasures(measureName);
        if (metricStack && metricStack.length === 0) {
          markStacksRef.current.delete(metricName);
        }
      }
    },
    [componentName],
  );

  return {
    startMeasure,
    endMeasure,
  };
}
