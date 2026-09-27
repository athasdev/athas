import type { ReactNode } from "react";
import { ControlSizeProvider } from "@/ui/control-size";
import { OverlaySideProvider } from "@/ui/overlay-side";

/**
 * The boundary at the top of every overlay surface: dialogs, menus, popovers and hover cards
 * start from the defaults instead of inheriting a rail's placement or a header's control size
 * from wherever they were opened.
 */
export function OverlayRoot({ children }: { children: ReactNode }) {
  return (
    <OverlaySideProvider>
      <ControlSizeProvider>{children}</ControlSizeProvider>
    </OverlaySideProvider>
  );
}
