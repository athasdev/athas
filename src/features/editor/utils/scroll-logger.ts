/**
 * Scroll event logger for debugging
 * Enable by setting localStorage.setItem('debug-scroll-log', 'true')
 */

interface ScrollLogEntry {
  timestamp: number;
  scrollTop: number;
  scrollLeft: number;
  deltaTop: number;
  deltaLeft: number;
  source: string;
}

class ScrollLogger {
  private enabled = false;
  private history: ScrollLogEntry[] = [];
  private maxHistory = 100;
  private lastScroll = { top: 0, left: 0 };
  private frameCount = 0;
  private frameStartTime = 0;

  constructor() {
    this.checkEnabled();

    if (typeof window !== "undefined") {
      window.addEventListener("storage", (e) => {
        if (e.key === "debug-scroll-log") {
          this.checkEnabled();
        }
      });
    }
  }

  private checkEnabled() {
    if (typeof window === "undefined") return;
    this.enabled = localStorage.getItem("debug-scroll-log") === "true";

    if (this.enabled) {
      console.log("[ScrollLogger] Enabled. Use scrollLogger.getStats() to see performance stats.");
    }
  }

  log(scrollTop: number, scrollLeft: number, source = "unknown") {
    if (!this.enabled) return;

    const now = performance.now();
    const deltaTop = scrollTop - this.lastScroll.top;
    const deltaLeft = scrollLeft - this.lastScroll.left;

    if (deltaTop !== 0 || deltaLeft !== 0) {
      const entry: ScrollLogEntry = {
        timestamp: now,
        scrollTop,
        scrollLeft,
        deltaTop,
        deltaLeft,
        source,
      };

      this.history.push(entry);

      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }

      this.lastScroll = { top: scrollTop, left: scrollLeft };

      if (Math.abs(deltaTop) > 1000 || Math.abs(deltaLeft) > 1000) {
        console.warn("[ScrollLogger] Large scroll jump detected:", entry);
      }
    }

    this.frameCount++;

    if (this.frameStartTime === 0) {
      this.frameStartTime = now;
    } else if (now - this.frameStartTime >= 1000) {
      const fps = Math.round((this.frameCount * 1000) / (now - this.frameStartTime));
      console.log(`[ScrollLogger] Scroll FPS: ${fps}`);
      this.frameCount = 0;
      this.frameStartTime = now;
    }
  }

  getStats() {
    if (this.history.length === 0) {
      return {
        totalEvents: 0,
        avgDeltaTop: 0,
        avgDeltaLeft: 0,
        maxDeltaTop: 0,
        maxDeltaLeft: 0,
        sources: {},
      };
    }

    const sources: Record<string, number> = {};
    let totalDeltaTop = 0;
    let totalDeltaLeft = 0;
    let maxDeltaTop = 0;
    let maxDeltaLeft = 0;

    for (const entry of this.history) {
      sources[entry.source] = (sources[entry.source] || 0) + 1;
      totalDeltaTop += Math.abs(entry.deltaTop);
      totalDeltaLeft += Math.abs(entry.deltaLeft);
      maxDeltaTop = Math.max(maxDeltaTop, Math.abs(entry.deltaTop));
      maxDeltaLeft = Math.max(maxDeltaLeft, Math.abs(entry.deltaLeft));
    }

    return {
      totalEvents: this.history.length,
      avgDeltaTop: totalDeltaTop / this.history.length,
      avgDeltaLeft: totalDeltaLeft / this.history.length,
      maxDeltaTop,
      maxDeltaLeft,
      sources,
      recentEvents: this.history.slice(-10),
    };
  }

  clear() {
    this.history = [];
    this.frameCount = 0;
    this.frameStartTime = 0;
    console.log("[ScrollLogger] History cleared");
  }
}

export const scrollLogger = new ScrollLogger();

// Make it available globally for debugging
if (typeof window !== "undefined") {
  (window as any).scrollLogger = scrollLogger;
}
