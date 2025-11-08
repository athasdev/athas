/**
 * Performance hook stub for backward compatibility
 */

export function usePerformanceMonitor() {
  return {
    startMeasure: () => {},
    endMeasure: () => {},
    getMeasurements: () => ({}),
  };
}

export function useThrottledCallback<T extends (...args: any[]) => any>(
  callback: T,
  _delay: number,
): T {
  return callback;
}
