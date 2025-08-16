import { useCallback, useRef } from "react";
import { useDebounce, useDebouncedCallback } from "use-debounce";

/**
 * Performance-optimized hooks collection
 */

// Debounced value hook
export function useDebouncedValue<T>(value: T, delay: number) {
  return useDebounce(value, delay);
}

// Debounced callback hook
export function useDebouncedFunction<T extends (...args: any[]) => any>(
  callback: T,
  delay: number,
  options?: {
    leading?: boolean;
    trailing?: boolean;
    maxWait?: number;
  },
) {
  return useDebouncedCallback(callback, delay, options);
}

// Throttled callback hook
export function useThrottledCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number,
) {
  const lastCall = useRef<number>(0);

  return useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      if (now - lastCall.current >= delay) {
        lastCall.current = now;
        return callback(...args);
      }
    },
    [callback, delay],
  ) as T;
}

// RAF callback hook for smooth animations
export function useRAFCallback<T extends (...args: any[]) => any>(callback: T) {
  const rafId = useRef<number | undefined>(undefined);

  return useCallback(
    (...args: Parameters<T>) => {
      if (rafId.current !== undefined) {
        cancelAnimationFrame(rafId.current);
      }

      rafId.current = requestAnimationFrame(() => {
        callback(...args);
      });
    },
    [callback],
  ) as T;
}

// Memoized expensive calculation hook
export function useExpensiveCalculation<T>(fn: () => T, deps: React.DependencyList, delay = 0) {
  const [debouncedDeps] = useDebounce(deps, delay);

  return useCallback(() => {
    return fn();
  }, debouncedDeps);
}

// Performance monitoring hook
export function usePerformanceMonitor(name: string) {
  const startTime = useRef<number | undefined>(undefined);

  const start = useCallback(() => {
    startTime.current = performance.now();
  }, []);

  const end = useCallback(() => {
    if (startTime.current !== undefined) {
      const elapsed = performance.now() - startTime.current;
      console.debug(`[Performance] ${name}: ${elapsed.toFixed(2)}ms`);
      startTime.current = undefined;
    }
  }, [name]);

  return { start, end };
}
