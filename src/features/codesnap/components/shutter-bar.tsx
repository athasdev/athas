import { Camera, Gear } from "@phosphor-icons/react";
import { useMemo } from "react";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { useSettingsStore } from "@/features/settings/store";
import type { CodesnapShutterAction } from "../types";

type Props = {
  width: number;
  height: number;
  action: CodesnapShutterAction;
  exporting: boolean;
  onActionChange: (a: CodesnapShutterAction) => void;
  onShutter: () => void;
};

const PIXEL_RATIO_CYCLE = [1, 2, 3];

function nextPixelRatio(current: number): number {
  const idx = PIXEL_RATIO_CYCLE.indexOf(current);
  return PIXEL_RATIO_CYCLE[(idx + 1) % PIXEL_RATIO_CYCLE.length] ?? 2;
}

const ON = "✓";
const OFF = "—";

export function ShutterBar({ width, height, action, exporting, onActionChange, onShutter }: Props) {
  const settings = useSettingsStore((s) => s.settings.codesnap);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const menu = useContextMenu();

  const update = <K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) => {
    updateSetting("codesnap", { ...settings, [key]: value });
  };

  const items = useMemo<ContextMenuItem[]>(
    () => [
      {
        id: "line-numbers",
        label: "Line numbers",
        keybinding: settings.showLineNumbers ? ON : OFF,
        onClick: () => update("showLineNumbers", !settings.showLineNumbers),
      },
      {
        id: "real-line-numbers",
        label: "Real line numbers",
        keybinding: settings.realLineNumbers ? ON : OFF,
        disabled: !settings.showLineNumbers,
        onClick: () => update("realLineNumbers", !settings.realLineNumbers),
      },
      {
        id: "window-controls",
        label: "Window controls",
        keybinding: settings.showWindowControls ? ON : OFF,
        onClick: () => update("showWindowControls", !settings.showWindowControls),
      },
      {
        id: "window-title",
        label: "Window title",
        keybinding: settings.showWindowTitle ? ON : OFF,
        onClick: () => update("showWindowTitle", !settings.showWindowTitle),
      },
      {
        id: "rounded-corners",
        label: "Rounded corners",
        keybinding: settings.roundedCorners ? ON : OFF,
        onClick: () => update("roundedCorners", !settings.roundedCorners),
      },
      {
        id: "transparent-bg",
        label: "Transparent background",
        keybinding: settings.transparentBackground ? ON : OFF,
        onClick: () => update("transparentBackground", !settings.transparentBackground),
      },
      {
        id: "editor-theme",
        label: "Use editor theme",
        keybinding: settings.useEditorTheme ? ON : OFF,
        onClick: () => update("useEditorTheme", !settings.useEditorTheme),
      },
      { id: "sep-1", label: "", separator: true, onClick: () => {} },
      {
        id: "shutter-default",
        label: "Default shutter",
        keybinding: settings.shutterAction === "copy" ? "Copy" : "Save",
        onClick: () => update("shutterAction", settings.shutterAction === "copy" ? "save" : "copy"),
      },
      {
        id: "pixel-ratio",
        label: "Pixel ratio",
        keybinding: `${settings.pixelRatio}×`,
        onClick: () => update("pixelRatio", nextPixelRatio(settings.pixelRatio)),
      },
    ],
    // settings is a stable reference until updateSetting fires; rebuild items each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings],
  );

  return (
    <>
      <div className="codesnap-shutter-bar">
        <span className="codesnap-readout">
          {width} × {height}
        </span>
        <div className="codesnap-divider" />
        <div className="codesnap-toggle">
          <button
            type="button"
            className={action === "copy" ? "active" : ""}
            onClick={() => onActionChange("copy")}
          >
            Copy
          </button>
          <button
            type="button"
            className={action === "save" ? "active" : ""}
            onClick={() => onActionChange("save")}
          >
            Save
          </button>
        </div>
        <button type="button" className="codesnap-shutter" onClick={onShutter} disabled={exporting}>
          {exporting ? (
            "…"
          ) : (
            <>
              <Camera size={14} weight="bold" />
              <span>{action === "copy" ? "Copy" : "Save"}</span>
            </>
          )}
        </button>
        <div className="codesnap-divider" />
        <button
          type="button"
          className="codesnap-icon-btn"
          title="CodeSnap settings"
          onClick={menu.open}
        >
          <Gear size={14} weight="bold" />
        </button>
      </div>
      <ContextMenu
        isOpen={menu.isOpen}
        position={menu.position}
        items={items}
        onClose={menu.close}
      />
    </>
  );
}
