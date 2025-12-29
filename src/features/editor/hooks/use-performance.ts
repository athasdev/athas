/**
 * Performance hook for tracking core editor metrics
 */
import { useCallback, useRef } from "react";

export interface PerformanceMetric {
  name: string;
  startTime: number;
  duration: number;
}

export function usePerformanceMonitor(componentName: string) {
  const marksRef = useRef<Set<string>>(new Set());

  const startMeasure = useCallback(
    (metricName: string) => {
      const markName = `${componentName}:${metricName}:start`;
      performance.mark(markName);
      marksRef.current.add(markName);
    },
    [componentName],
  );

  const endMeasure = useCallback(
    (metricName: string) => {
      const startMarkName = `${componentName}:${metricName}:start`;
      const endMarkName = `${componentName}:${metricName}:end`;
      const measureName = `${componentName}:${metricName}`;

      if (marksRef.current.has(startMarkName)) {
        performance.mark(endMarkName);
        try {
          performance.measure(measureName, startMarkName, endMarkName);
          const entries = performance.getEntriesByName(measureName);
          const lastEntry = entries[entries.length - 1];
          if (lastEntry) {
            console.info(
              `[Performance] [${componentName}] ${metricName}: ${lastEntry.duration.toFixed(2)}ms`,
            );
            // Optional: Dispatch event for automated benchmark collection
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
          }
        } catch (e) {
          console.warn(`Failed to measure ${measureName}`, e);
        }
        // Cleanup marks
        performance.clearMarks(startMarkName);
        performance.clearMarks(endMarkName);
        performance.clearMeasures(measureName);
        marksRef.current.delete(startMarkName);

        return performance.getEntriesByName(measureName).pop()?.duration;
      }
    },
    [componentName],
  );

  return {
    startMeasure,
    endMeasure,
  };
}

export function useThrottledCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number,
): T {
  const lastRun = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  return useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      if (now - lastRun.current >= delay) {
        lastRun.current = now;
        callback(...args);
      } else {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(
          () => {
            lastRun.current = Date.now();
            callback(...args);
          },
          delay - (now - lastRun.current),
        );
      }
    },
    [callback, delay],
  ) as T;
}
