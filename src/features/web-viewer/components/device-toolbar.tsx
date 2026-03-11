import { Monitor, RotateCcw, Smartphone, Tablet } from "lucide-react";
import { useCallback, useState } from "react";
import { DEVICE_PRESETS, getPresetById } from "../constants/device-presets";
import { useWebViewerStore } from "../stores/web-viewer-store";
import type { DevicePreset } from "../types";

const categoryIcons = {
  phone: Smartphone,
  tablet: Tablet,
  desktop: Monitor,
} as const;

const categoryLabels = {
  phone: "Phones",
  tablet: "Tablets",
  desktop: "Desktops",
} as const;

export function DeviceToolbar() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const activeDevicePresetId = useWebViewerStore.use.activeDevicePresetId();
  const customDimensions = useWebViewerStore.use.customDimensions();
  const { setActiveDevicePreset, setCustomDimensions } = useWebViewerStore.use.actions();

  const activePreset = activeDevicePresetId ? getPresetById(activeDevicePresetId) : null;

  const currentWidth = activePreset?.width ?? customDimensions?.width ?? 1920;
  const currentHeight = activePreset?.height ?? customDimensions?.height ?? 1080;

  const handleSelectPreset = useCallback(
    (preset: DevicePreset) => {
      setActiveDevicePreset(preset.id);
      setCustomDimensions(null);
      setDropdownOpen(false);
    },
    [setActiveDevicePreset, setCustomDimensions],
  );

  const handleDimensionChange = useCallback(
    (dimension: "width" | "height", value: string) => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1) return;

      setActiveDevicePreset(null);
      setCustomDimensions({
        width: dimension === "width" ? num : currentWidth,
        height: dimension === "height" ? num : currentHeight,
      });
    },
    [currentWidth, currentHeight, setActiveDevicePreset, setCustomDimensions],
  );

  const handleToggleOrientation = useCallback(() => {
    if (activePreset) {
      setActiveDevicePreset(null);
      setCustomDimensions({ width: activePreset.height, height: activePreset.width });
    } else if (customDimensions) {
      setCustomDimensions({ width: customDimensions.height, height: customDimensions.width });
    }
  }, [activePreset, customDimensions, setActiveDevicePreset, setCustomDimensions]);

  const groupedPresets = (["phone", "tablet", "desktop"] as const).map((category) => ({
    category,
    label: categoryLabels[category],
    icon: categoryIcons[category],
    presets: DEVICE_PRESETS.filter((p) => p.category === category),
  }));

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-border border-b bg-secondary-bg px-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex h-7 items-center gap-1.5 rounded px-2 text-xs text-text-light transition-colors hover:bg-hover"
          aria-label="Select device preset"
        >
          {activePreset ? (
            <>
              {(() => {
                const Icon = categoryIcons[activePreset.category];
                return <Icon size={14} />;
              })()}
              <span>{activePreset.name}</span>
            </>
          ) : (
            <>
              <Monitor size={14} />
              <span>Custom</span>
            </>
          )}
        </button>

        {dropdownOpen && (
          <div className="absolute top-full left-0 z-50 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-primary-bg shadow-lg">
            {groupedPresets.map((group) => (
              <div key={group.category}>
                <div className="flex items-center gap-1.5 bg-secondary-bg px-3 py-1.5 text-[10px] font-medium text-text-lighter">
                  <group.icon size={10} />
                  {group.label}
                </div>
                {group.presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-xs transition-colors hover:bg-hover ${
                      activeDevicePresetId === preset.id ? "text-accent" : "text-text-light"
                    }`}
                    aria-label={`Select ${preset.name} (${preset.width}x${preset.height})`}
                  >
                    <span>{preset.name}</span>
                    <span className="text-text-lighter">
                      {preset.width}x{preset.height}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="h-5 w-px bg-border" />

      <div className="flex items-center gap-1">
        <input
          type="number"
          value={currentWidth}
          onChange={(e) => handleDimensionChange("width", e.target.value)}
          className="h-6 w-16 rounded border border-border bg-primary-bg px-1.5 text-center text-xs text-text focus:border-accent focus:outline-none"
          min={1}
          aria-label="Viewport width"
        />
        <span className="text-xs text-text-lighter">x</span>
        <input
          type="number"
          value={currentHeight}
          onChange={(e) => handleDimensionChange("height", e.target.value)}
          className="h-6 w-16 rounded border border-border bg-primary-bg px-1.5 text-center text-xs text-text focus:border-accent focus:outline-none"
          min={1}
          aria-label="Viewport height"
        />
      </div>

      <button
        type="button"
        onClick={handleToggleOrientation}
        className="flex h-7 w-7 items-center justify-center rounded text-text-light transition-colors hover:bg-hover hover:text-text"
        title="Toggle orientation"
        aria-label="Toggle orientation"
      >
        <RotateCcw size={14} />
      </button>
    </div>
  );
}
