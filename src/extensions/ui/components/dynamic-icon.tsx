import * as AppIcons from "@/ui/icons";
import { PuzzlePieceIcon } from "@/ui/icons";
import type { Icon } from "@/ui/icons";

interface DynamicIconProps {
  name: string;
  className?: string;
  size?: number;
}

function toIconKey(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function DynamicIcon({ name, className, size }: DynamicIconProps) {
  const key = toIconKey(name);
  const iconKey = `${key}Icon`;
  const Icon = AppIcons[iconKey as keyof typeof AppIcons] as Icon | undefined;

  if (!Icon) {
    return <PuzzlePieceIcon className={className} size={size} />;
  }

  return <Icon className={className} size={size} />;
}
