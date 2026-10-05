import { usePerformanceExperiments } from "@/features/settings/stores/performance-experiments.store";
import { useEditorViewSettings } from "../../hooks/use-editor-view-settings";
import { useMonacoFontRemeasure } from "./font-remeasure";
import { useWebGpuSupport } from "./use-webgpu-support";

export function useMonacoEditorSettings() {
  const webgpu = usePerformanceExperiments.use.webgpu();
  const gpuSupport = useWebGpuSupport();
  const experimentalGpuAcceleration: "on" | "off" =
    webgpu && gpuSupport === "available" ? "on" : "off";
  const settings = useEditorViewSettings();
  useMonacoFontRemeasure(settings.fontFamily, settings.fontSize);

  return { experimentalGpuAcceleration, ...settings };
}
