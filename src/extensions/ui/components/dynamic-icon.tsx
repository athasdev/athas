import { icons, type LucideIcon, Puzzle } from "lucide-react";

interface DynamicIconProps {
  name: string;
  className?: string;
  size?: number;
}

function toLucideKey(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function DynamicIcon({ name, className, size }: DynamicIconProps) {
  const key = toLucideKey(name);
  const Icon: LucideIcon | undefined = icons[key as keyof typeof icons];

  if (!Icon) {
    return <Puzzle className={className} size={size} />;
  }

  return <Icon className={className} size={size} />;
}
