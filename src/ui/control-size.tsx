import { createContext, useContext, type ReactNode } from "react";

type ControlSize = "sm";

const ControlSizeContext = createContext<ControlSize | undefined>(undefined);

/**
 * The size buttons and toggles take inside a dense bar when their consumer does not pick one, so
 * every control in a pane header lines up at the chrome control height. Overlays opened from such
 * a bar render a bare provider and get the normal sizes back.
 */
export function ControlSizeProvider({
  size,
  children,
}: {
  size?: ControlSize;
  children: ReactNode;
}) {
  return <ControlSizeContext.Provider value={size}>{children}</ControlSizeContext.Provider>;
}

export function useControlSize(): ControlSize | undefined {
  return useContext(ControlSizeContext);
}
