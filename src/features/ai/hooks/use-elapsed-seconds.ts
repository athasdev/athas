import { useEffect, useState } from "react";
import { elapsedSeconds } from "@/features/ai/lib/elapsed-time";

/** Seconds since `since`, ticking once a second while mounted and `active`. */
export function useElapsedSeconds(since: Date | string | number | null, active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [active]);
  return since === null ? 0 : elapsedSeconds(new Date(since), now);
}
