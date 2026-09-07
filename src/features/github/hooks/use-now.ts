import { useEffect, useState } from "react";

export function useNow(intervalMs: number, enabled = true) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;

    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(intervalId);
  }, [enabled, intervalMs]);

  return now;
}
