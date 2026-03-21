import { type ReactNode, useMemo } from "react";
import { currentPlatform } from "@/utils/platform";

interface Props {
  children?: ReactNode;
  shortcut?: string;
  onClick?: () => void;
  separator?: boolean;
}

const MenuItem = ({ children, shortcut, onClick, separator }: Props) => {
  // Convert shortcut to user's OS
  const shortcutOsSpecific = useMemo(() => {
    if (currentPlatform !== "macos" || !shortcut) return shortcut;

    // Order matters
    return shortcut
      .replace(/Ctrl\+Alt\+Shift\+/g, "⌘⌥⇧")
      .replace(/Ctrl\+Shift\+/g, "⌘⇧")
      .replace(/Ctrl\+Alt\+/g, "⌘⌥")
      .replace(/Alt\+Shift\+/g, "⌥⇧")
      .replace(/Ctrl\+/g, "⌘")
      .replace(/Alt\+/g, "⌥")
      .replace(/Shift\+/g, "⇧")
      .replace(/Right/g, "→")
      .replace(/Left/g, "←")
      .replace(/Up/g, "↑")
      .replace(/Down/g, "↓");
  }, [currentPlatform, shortcut]);

  if (separator) {
    return <div className="my-1 border-border/70 border-t" />;
  }

  return (
    <button
      role="menuitem"
      className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-text text-xs transition-colors hover:bg-hover"
      onClick={onClick}
    >
      <span>{children}</span>
      {shortcut && <span className="ml-8 text-text-lighter/90 text-xs">{shortcutOsSpecific}</span>}
    </button>
  );
};

export default MenuItem;
