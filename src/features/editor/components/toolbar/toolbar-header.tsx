import type { ReactNode } from "react";

interface ToolbarHeaderProps {
  left: ReactNode;
  right?: ReactNode;
}

export function ToolbarHeader({ left, right }: ToolbarHeaderProps) {
  return (
    <div className="flex min-h-7 select-none items-center justify-between bg-terniary-bg px-3 py-1">
      <div className="ui-font flex min-w-0 items-center gap-0.5 text-text-lighter text-xs">
        {left}
      </div>
      {right ? <div className="flex items-center gap-1">{right}</div> : null}
    </div>
  );
}
