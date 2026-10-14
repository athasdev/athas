import { createContext, useContext, type ReactNode } from "react";

type ControlSize = "sm" | "lg";

const ControlSizeContext = createContext<ControlSize | undefined>(undefined);

/**
 * The size buttons and toggles take inside a bar when their consumer does not pick one, so every
 * control in it lines up: the chrome control height in a pane header, the activity rail's size in
 * a title bar row above the rail. Overlays opened from such a bar render a bare provider and get
 * the normal sizes back.
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
