import { platform } from "@tauri-apps/plugin-os";
import type { ReactNode } from "react";

interface Props {
  children?: ReactNode;
  shortcut?: string;
  onClick?: () => void;
  separator?: boolean;
}

const MenuItem = ({ children, shortcut, onClick, separator }: Props) => {
  const currentPlatform = platform();

  // Convert shortcut to Windows/Linux if not on MacOS
  const shortcutOsSpecific =
    currentPlatform === "macos"
      ? shortcut
      : shortcut
          ?.replace(/⇧⌘/g, "Ctrl+Shift+")
          .replace(/⌥⌘/g, "Ctrl+Alt+")
          .replace(/⌘⌥/g, "Ctrl+Alt+")
          .replace(/⌘⌃/g, "Ctrl+")
          .replace(/⌘/g, "Ctrl+")
          .replace(/⌥/g, "Alt+")
          .replace(/⇧/g, "Shift+")
          .replace(/→/g, "Right")
          .replace(/←/g, "Left");

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
