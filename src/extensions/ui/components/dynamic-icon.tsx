import * as PhosphorIcons from "@phosphor-icons/react";
import { PuzzlePiece } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

interface DynamicIconProps {
  name: string;
  className?: string;
  size?: number;
}

function toPhosphorKey(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function DynamicIcon({ name, className, size }: DynamicIconProps) {
  const key = toPhosphorKey(name);
  const Icon = PhosphorIcons[key as keyof typeof PhosphorIcons] as Icon | undefined;

  if (!Icon) {
    return <PuzzlePiece className={className} size={size} />;
  }

  return <Icon className={className} size={size} />;
}
