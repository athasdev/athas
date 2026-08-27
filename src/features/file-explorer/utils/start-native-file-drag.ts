import { Channel, invoke } from "@tauri-apps/api/core";

interface NativeDragEvent {
  result: string;
  cursorPos: {
    x: number;
    y: number;
  };
}

function createDragImage(fileName: string): string {
  const canvas = document.createElement("canvas");
  const scale = window.devicePixelRatio || 1;
  canvas.width = 220 * scale;
  canvas.height = 40 * scale;

  const context = canvas.getContext("2d");
  if (!context) {
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WQAAAABJRU5ErkJggg==";
  }

  context.scale(scale, scale);
  context.fillStyle = "rgba(32, 32, 34, 0.94)";
  context.beginPath();
  context.roundRect(0, 0, 220, 40, 8);
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.font = "13px system-ui";
  context.textBaseline = "middle";
  const label = fileName.length > 28 ? `${fileName.slice(0, 27)}…` : fileName;
  context.fillText(label, 12, 20);

  return canvas.toDataURL("image/png");
}

export async function startNativeFileDrag(path: string, fileName: string): Promise<void> {
  const onEvent = new Channel<NativeDragEvent>();
  await invoke("plugin:drag|start_drag", {
    item: [path],
    image: createDragImage(fileName),
    options: { mode: "copy" },
    onEvent,
  });
}
