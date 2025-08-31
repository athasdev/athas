import { platform } from "@tauri-apps/plugin-os";
import { type ReactNode, useMemo } from "react";

interface Props {
  children?: ReactNode;
  shortcut?: string;
  onClick?: () => void;
  separator?: boolean;
}

const MenuItem = ({ children, shortcut, onClick, separator }: Props) => {
  const currentPlatform = platform();

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
    return <div className="my-1 border-border border-t" />;
  }

  return (
    <button
      className="flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-text text-xs hover:bg-hover"
      onClick={onClick}
    >
      <span>{children}</span>
      {shortcut && <span className="ml-8 text-text-lighter text-xs">{shortcutOsSpecific}</span>}
    </button>
  );
};

export default MenuItem;
