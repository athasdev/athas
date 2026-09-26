import { useEffect, useState } from "react";

const NARROW_WORKBENCH_WIDTH = 760;

export function getResponsiveWorkbenchLayout(width: number) {
  return { narrow: width < NARROW_WORKBENCH_WIDTH };
}

export function useResponsiveWorkbenchLayout() {
  const [layout, setLayout] = useState(() => getResponsiveWorkbenchLayout(window.innerWidth));

  useEffect(() => {
    const sync = () => setLayout(getResponsiveWorkbenchLayout(window.innerWidth));
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  return layout;
}
