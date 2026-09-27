import { useEffect, useState } from "react";

const NARROW_WORKBENCH_WIDTH = 760;

export function getResponsiveWorkbenchLayout(width: number) {
  return { narrow: width < NARROW_WORKBENCH_WIDTH };
}

export function useResponsiveWorkbenchLayout() {
  const [layout, setLayout] = useState(() => getResponsiveWorkbenchLayout(window.innerWidth));

  useEffect(() => {
    // Keep the same object until the breakpoint is crossed, so resizing the window doesn't
    // re-render the layout shell on every resize event.
    const sync = () => {
      const next = getResponsiveWorkbenchLayout(window.innerWidth);
      setLayout((current) => (current.narrow === next.narrow ? current : next));
    };
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  return layout;
}
