import { useEffect, useState } from "react";

export function useSessionTime() {
  const [seconds, setSeconds] = useState(0);
  const [enabled, setEnabled] = useState(
    () => localStorage.getItem("sessionTimeEnabled") === "true",
  );

  useEffect(() => {
    const checkSetting = () => {
      const val = localStorage.getItem("sessionTimeEnabled") === "true";
      setEnabled(val);
    };

    // re-check setting every second (in case changed in settings)
    const settingInterval = setInterval(checkSetting, 1000);

    return () => clearInterval(settingInterval);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setSeconds(0);
      return;
    }

    const start = Date.now();

    const interval = setInterval(() => {
      const now = Date.now();
      const diff = Math.floor((now - start) / 1000);
      setSeconds(diff);
    }, 1000);

    return () => clearInterval(interval);
  }, [enabled]);

  return { seconds, enabled };
}
