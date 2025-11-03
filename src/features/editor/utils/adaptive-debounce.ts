/**
 * Calculates adaptive debounce time based on typing speed and file size
 * to optimize tokenization performance while maintaining responsiveness
 */

const MIN_DEBOUNCE = 50; // ms - for small files with slow typing
const MAX_DEBOUNCE = 150; // ms - for large files with fast typing
const FAST_TYPING_THRESHOLD = 100; // ms between keystrokes
const LARGE_FILE_THRESHOLD = 1000; // lines

interface AdaptiveDebounceConfig {
  fileSize: number; // number of lines
  lastKeystrokeTime?: number; // timestamp of last keystroke
  minDebounce?: number;
  maxDebounce?: number;
}

/**
 * Calculate optimal debounce time based on file size and typing speed
 */
export function calculateAdaptiveDebounce(config: AdaptiveDebounceConfig): number {
  const {
    fileSize,
    lastKeystrokeTime,
    minDebounce = MIN_DEBOUNCE,
    maxDebounce = MAX_DEBOUNCE,
  } = config;

  let debounceTime = minDebounce;

  // Adjust based on file size
  if (fileSize > LARGE_FILE_THRESHOLD) {
    const sizeMultiplier = Math.min(fileSize / LARGE_FILE_THRESHOLD, 2);
    debounceTime = minDebounce + (maxDebounce - minDebounce) * (sizeMultiplier - 1);
  }

  // Adjust based on typing speed
  if (lastKeystrokeTime) {
    const timeSinceLastKeystroke = Date.now() - lastKeystrokeTime;
    if (timeSinceLastKeystroke < FAST_TYPING_THRESHOLD) {
      // Fast typing - increase debounce slightly to batch updates
      debounceTime = Math.min(debounceTime + 25, maxDebounce);
    }
  }

  return Math.round(Math.max(minDebounce, Math.min(maxDebounce, debounceTime)));
}

/**
 * Hook-like wrapper for managing adaptive debounce state
 */
export class AdaptiveDebouncer {
  private lastKeystrokeTime = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private minDebounce = MIN_DEBOUNCE,
    private maxDebounce = MAX_DEBOUNCE,
  ) {}

  /**
   * Schedule a callback with adaptive debouncing
   */
  debounce(callback: () => void, fileSize: number): void {
    const now = Date.now();
    const debounceTime = calculateAdaptiveDebounce({
      fileSize,
      lastKeystrokeTime: this.lastKeystrokeTime,
      minDebounce: this.minDebounce,
      maxDebounce: this.maxDebounce,
    });

    this.lastKeystrokeTime = now;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      callback();
      this.timer = null;
    }, debounceTime);
  }

  /**
   * Cancel any pending debounced callback
   */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Clear the typing speed tracking
   */
  reset(): void {
    this.lastKeystrokeTime = 0;
    this.cancel();
  }
}
