import * as PhosphorIcons from "@phosphor-icons/react";
import { PuzzlePieceIcon } from "@phosphor-icons/react";
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
  const iconKey = `${key}Icon`;
  const Icon = PhosphorIcons[iconKey as keyof typeof PhosphorIcons] as Icon | undefined;

  if (!Icon) {
    return <PuzzlePieceIcon className={className} size={size} />;
  }

  return <Icon className={className} size={size} />;
}
