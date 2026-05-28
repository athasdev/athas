import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import Keybinding from "@/ui/keybinding";

interface Props {
  children?: ReactNode;
  shortcut?: string;
  onClick?: () => void;
  separator?: boolean;
}

const MenuItem = ({ children, shortcut, onClick, separator }: Props) => {
  if (separator) {
    return <div className="my-1 border-border/70 border-t" />;
  }

  return (
    <Button
      role="menuitem"
      variant="ghost"
      onClick={onClick}
      className="ui-font ui-text-sm flex h-auto w-full cursor-pointer items-center justify-between gap-3 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-text transition-colors hover:bg-hover"
      compact
    >
      <span className="min-w-0 flex-1 truncate whitespace-nowrap">{children}</span>
      {shortcut && <Keybinding binding={shortcut} className="ml-8 shrink-0" />}
    </Button>
  );
};

export default MenuItem;
