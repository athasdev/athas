import { Fragment } from "react";
import { Kbd, KbdGroup } from "@/ui/kbd";
import { IS_MAC } from "@/utils/platform";
import { keybindingToDisplayParts, keysToDisplayParts } from "../utils/keybinding-display";

interface KeybindingProps {
  keys?: string[];
  binding?: string;
  className?: string;
}

export default function Keybinding({ keys, binding, className }: KeybindingProps) {
  const displayParts = binding ? keybindingToDisplayParts(binding) : keysToDisplayParts(keys ?? []);
  const chords = displayParts.filter((part) => part.length > 0);

  if (chords.length === 0) {
    return null;
  }

  return (
    <KbdGroup className={className}>
      {chords.map((chord, chordIndex) => (
        <Fragment key={`${chord.join("-")}-${chordIndex}`}>
          {chordIndex > 0 ? <span className="text-text-lighter/75">then</span> : null}
          {IS_MAC ? (
            <Kbd>{chord.join("")}</Kbd>
          ) : (
            chord.map((key, keyIndex) => (
              <Fragment key={`${key}-${keyIndex}`}>
                {keyIndex > 0 ? <span className="text-text-lighter/75">+</span> : null}
                <Kbd>{key}</Kbd>
              </Fragment>
            ))
          )}
        </Fragment>
      ))}
    </KbdGroup>
  );
}
