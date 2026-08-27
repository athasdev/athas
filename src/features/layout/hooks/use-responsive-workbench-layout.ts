import { useCallback, useEffect, useState } from "react";

const COMPACT_WORKBENCH_WIDTH = 900;
const NARROW_WORKBENCH_WIDTH = 760;

export function getResponsiveWorkbenchLayout(width: number) {
  return {
    compact: width < COMPACT_WORKBENCH_WIDTH,
    narrow: width < NARROW_WORKBENCH_WIDTH,
  };
}

export function useResponsiveWorkbenchLayout(preferredActivityBarExpanded: boolean) {
  const [layout, setLayout] = useState(() => getResponsiveWorkbenchLayout(window.innerWidth));
  const [compactActivityBarOverride, setCompactActivityBarOverride] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    const sync = () => {
      const next = getResponsiveWorkbenchLayout(window.innerWidth);
      setLayout((current) => {
        if (current.compact !== next.compact) setCompactActivityBarOverride(null);
        return next;
      });
    };

    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  const activityBarExpanded = layout.compact
    ? (compactActivityBarOverride ?? false)
    : preferredActivityBarExpanded;
  const setActivityBarExpanded = useCallback(
    (expanded: boolean) => {
      if (layout.compact) setCompactActivityBarOverride(expanded);
    },
    [layout.compact],
  );

  return { ...layout, activityBarExpanded, setActivityBarExpanded };
}
