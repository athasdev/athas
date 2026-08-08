import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type StartupMilestone =
  | "frontend:entry"
  | "react:scheduled"
  | "app:first-frame"
  | "workbench:first-frame"
  | "bootstrap:complete"
  | "workspace:ready"
  | "workspace:error"
  | "editor:first-ready";

const recordedMilestones = new Set<StartupMilestone>();

function isInitialWindow() {
  return getCurrentWindow().label === "main";
}

export function recordStartupMilestone(milestone: StartupMilestone) {
  if (!isInitialWindow() || recordedMilestones.has(milestone)) return;

  recordedMilestones.add(milestone);
  void invoke("record_startup_milestone", { milestone }).catch(() => {
    recordedMilestones.delete(milestone);
  });
}

export function recordStartupMilestoneAfterFrame(milestone: StartupMilestone) {
  let recorded = false;

  const record = () => {
    if (recorded) return;
    recorded = true;
    recordStartupMilestone(milestone);
  };

  const frame = window.requestAnimationFrame(record);
  const timer = window.setTimeout(record, 100);

  return () => {
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
}
