import { useEffect, useState } from "react";
import { findBestProjectIcon } from "@/features/workspace/project-icons/services/project-icons";
import { isRemoteProjectPath } from "@/features/workspace/services/project-tab-path";

/** Icons found in each project folder, so a re-render or a project switch doesn't rescan. */
const detectedProjectIcons = new Map<string, string | undefined>();

/** The icon a project shows: the one the user picked, else one found in its folder. */
export function useProjectIcon(projectPath: string, customIcon: string | undefined) {
  const scans = !customIcon && !isRemoteProjectPath(projectPath);
  const [detected, setDetected] = useState(() => detectedProjectIcons.get(projectPath));

  useEffect(() => {
    if (!scans) return;
    if (detectedProjectIcons.has(projectPath)) {
      setDetected(detectedProjectIcons.get(projectPath));
      return;
    }
    let cancelled = false;
    void findBestProjectIcon(projectPath).then((iconFile) => {
      detectedProjectIcons.set(projectPath, iconFile?.path);
      if (!cancelled) setDetected(iconFile?.path);
    });
    return () => {
      cancelled = true;
    };
  }, [projectPath, scans]);

  return customIcon ?? (scans ? detected : undefined);
}
