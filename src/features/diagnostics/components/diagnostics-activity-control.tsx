import { useMemo } from "react";
import { buildDiagnosticsActivityStatus } from "@/features/diagnostics/lib/diagnostics-activity-status";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { WarningIcon } from "@/ui/icons";
import { SidebarIconButton, SidebarListItem } from "@/ui/sidebar";
import Tooltip from "@/ui/tooltip";

export function DiagnosticsActivityControl({ expanded }: { expanded: boolean }) {
  const diagnosticsEnabled = useSettingsStore((state) => state.settings.coreFeatures.diagnostics);
  const diagnosticsByFile = useDiagnosticsStore.use.diagnosticsByFile();
  const diagnostics = useMemo(
    () => Array.from(diagnosticsByFile.values()).flat(),
    [diagnosticsByFile],
  );
  const status = useMemo(
    () => buildDiagnosticsActivityStatus(diagnosticsEnabled, diagnostics),
    [diagnostics, diagnosticsEnabled],
  );
  const isActive = useBufferStore((state) => {
    const activeBuffer = state.buffers.find((buffer) => buffer.id === state.activeBufferId);
    return activeBuffer?.type === "diagnostics";
  });
  const openDiagnosticsBuffer = useBufferStore.use.actions().openDiagnosticsBuffer;

  if (!status) return null;

  if (expanded) {
    return (
      <div className="w-full">
        <SidebarListItem
          active={isActive}
          tone={status.tone}
          leading={<WarningIcon />}
          trailing={<span className="tabular-nums">{status.count}</span>}
          aria-label={status.tooltip}
          onClick={() => openDiagnosticsBuffer()}
        >
          Diagnostics
        </SidebarListItem>
      </div>
    );
  }

  return (
    <Tooltip content={status.tooltip} side="right">
      <SidebarIconButton
        active={isActive}
        tone={status.tone}
        aria-label={status.tooltip}
        onClick={() => openDiagnosticsBuffer()}
      >
        <WarningIcon />
      </SidebarIconButton>
    </Tooltip>
  );
}
