import "./resize-handle-effect.css";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { cn } from "@/utils/cn";

interface ResizeHandleEffectProps {
  active: boolean;
  orientation: "horizontal" | "vertical";
  className?: string;
}

export function ResizeHandleEffect({ active, orientation, className }: ResizeHandleEffectProps) {
  const enabled = useSettingsStore((state) => state.settings.coreFeatures.energyEdge);

  if (!enabled) return null;

  return (
    <span
      aria-hidden="true"
      className={cn("athas-energy-edge", className)}
      data-active={active}
      data-orientation={orientation}
    >
      <span data-slot="energy-edge-aura" />
      <span data-slot="energy-edge-core" />
      <span data-slot="energy-edge-pulse" />
    </span>
  );
}
