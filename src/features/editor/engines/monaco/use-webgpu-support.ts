import { useEffect, useState } from "react";

export type WebGpuSupport = "checking" | "available" | "unavailable";

let supportPromise: Promise<WebGpuSupport> | undefined;

/**
 * Monaco's GPU renderer sizes its canvas through
 * `ResizeObserver.observe(el, { box: "device-pixel-content-box" })` and throws
 * "Could not observe device pixel dimensions" when the engine rejects that box.
 * WebKit (the Tauri webview on macOS) still does, even though it exposes a
 * WebGPU adapter, so a WebGPU check alone lets the editor crash at mount.
 */
function supportsDevicePixelContentBox(): boolean {
  if (typeof ResizeObserver === "undefined") return false;
  const observer = new ResizeObserver(() => {});
  try {
    observer.observe(document.documentElement, { box: "device-pixel-content-box" });
    return true;
  } catch {
    return false;
  } finally {
    observer.disconnect();
  }
}

async function detectWebGpuSupport(): Promise<WebGpuSupport> {
  try {
    if (!supportsDevicePixelContentBox()) return "unavailable";
    const gpu = (
      navigator as Navigator & {
        gpu?: { requestAdapter: () => Promise<unknown> };
      }
    ).gpu;
    if (!gpu || !(await gpu.requestAdapter())) return "unavailable";
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgpu") ? "available" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export function useWebGpuSupport() {
  const [support, setSupport] = useState<WebGpuSupport>("checking");

  useEffect(() => {
    let disposed = false;
    supportPromise ??= detectWebGpuSupport();
    void supportPromise.then((result) => {
      if (!disposed) setSupport(result);
    });
    return () => {
      disposed = true;
    };
  }, []);

  return support;
}
