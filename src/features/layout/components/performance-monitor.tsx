import { useEffect, useState } from "react";
import { useWebGpuSupport } from "@/features/editor/engines/monaco/use-webgpu-support";
import { usePerformanceExperiments } from "@/features/settings/stores/performance-experiments.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { ChromeBar, ChromeGroup, ChromeLabel } from "@/ui/chrome";

export function PerformanceMonitor() {
  const visible = usePerformanceExperiments.use.showMonitor();
  return visible ? <FrameMonitor /> : null;
}

function FrameMonitor() {
  const webgpu = usePerformanceExperiments.use.webgpu();
  const { toggleWebgpu, toggleMonitor } = usePerformanceExperiments.use.actions();
  const support = useWebGpuSupport();
  const [sample, setSample] = useState({ fps: 0, worst: 0, gpuCanvas: false });

  useEffect(() => {
    let frameId = 0;
    let previous: number | undefined;
    let elapsed = 0;
    let frames = 0;
    let worst = 0;

    const tick = (now: number) => {
      if (previous !== undefined) {
        const interval = now - previous;
        elapsed += interval;
        frames++;
        worst = Math.max(worst, interval);
        if (elapsed >= 500) {
          setSample({
            fps: Math.round((frames * 1000) / elapsed),
            worst,
            gpuCanvas: [...document.querySelectorAll(".monaco-editor canvas.editorCanvas")].some(
              (canvas) => canvas.getClientRects().length > 0,
            ),
          });
          elapsed = 0;
          frames = 0;
          worst = 0;
        }
      }
      previous = now;
      frameId = requestAnimationFrame(tick);
    };

    const resume = () => {
      cancelAnimationFrame(frameId);
      previous = undefined;
      elapsed = 0;
      frames = 0;
      worst = 0;
      if (!document.hidden) frameId = requestAnimationFrame(tick);
    };

    document.addEventListener("visibilitychange", resume);
    resume();
    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  const renderer = !webgpu
    ? "DOM"
    : support === "unavailable"
      ? "DOM · WebGPU unavailable"
      : support === "checking"
        ? "Checking WebGPU"
        : sample.gpuCanvas
          ? "GPU canvas present"
          : "WebGPU ready · no GPU canvas";

  return (
    <ChromeBar region="status" aria-label="Performance monitor" className="gap-3 overflow-x-auto">
      <ChromeGroup gap="loose">
        <Badge
          tone={sample.worst > 50 ? "warning" : "neutral"}
          title="requestAnimationFrame callbacks per second; not a GPU presentation counter"
        >
          {sample.fps || "—"} FPS
        </Badge>
        <ChromeLabel title="Longest frame callback interval in the latest half-second sample">
          Max {sample.worst.toFixed(1)} ms
        </ChromeLabel>
        <Button
          size="xs"
          variant="ghost"
          active={webgpu}
          aria-pressed={webgpu}
          onClick={toggleWebgpu}
          tooltip="Toggle experimental Monaco WebGPU rendering"
        >
          WebGPU {webgpu ? "on" : "off"}
        </Button>
        <ChromeLabel title="Canvas presence indicates the GPU rendering path was created; some lines can still use DOM rendering">
          {renderer}
        </ChromeLabel>
        <ChromeLabel>
          Compiler {import.meta.env.VITE_REACT_COMPILER_ENABLED ? "on" : "off"}
        </ChromeLabel>
      </ChromeGroup>
      <ChromeGroup className="ml-auto">
        <Button
          size="xs"
          variant="ghost"
          onClick={toggleMonitor}
          aria-label="Hide performance monitor"
        >
          Hide
        </Button>
      </ChromeGroup>
    </ChromeBar>
  );
}
