import { Fragment } from "react";
import { Kbd, KbdGroup } from "@/ui/kbd";
import { keybindingToDisplayParts, keysToDisplayParts } from "@/utils/keyboard/keybinding-display";
import { IS_MAC } from "@/utils/platform";

interface KeybindingProps {
  keys?: string[];
  binding?: string;
  className?: string;
  /**
   * `keys` draws each key as a keycap. `menu` is the quiet form a menu row ends with: plain muted
   * text, as native menus show shortcuts.
   */
  variant?: "keys" | "menu";
}

export default function Keybinding({
  keys,
  binding,
  className,
  variant = "keys",
}: KeybindingProps) {
  const displayParts = binding ? keybindingToDisplayParts(binding) : keysToDisplayParts(keys ?? []);
  const chords = displayParts.filter((part) => part.length > 0);

  if (chords.length === 0) {
    return null;
  }

  if (variant === "menu") {
    return (
      <span
        data-slot="keybinding"
        className="ml-auto shrink-0 pl-4 text-subtle-foreground tabular-nums tracking-wide"
      >
        {chords.map((chord) => chord.join(IS_MAC ? "" : "+")).join(" ")}
      </span>
    );
  }

  return (
    <KbdGroup className={className}>
      {chords.map((chord, chordIndex) => (
        <Fragment key={`${chord.join("-")}-${chordIndex}`}>
          {chordIndex > 0 ? <span className="text-subtle-foreground">then</span> : null}
          {chord.map((key, keyIndex) => (
            <Kbd key={`${key}-${keyIndex}`}>{key}</Kbd>
          ))}
        </Fragment>
      ))}
    </KbdGroup>
  );
}
