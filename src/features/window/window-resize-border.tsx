import { getCurrentWindow } from "@tauri-apps/api/window";
import { useIsLinux } from "@/hooks/use-platform";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

interface ResizeZone {
  direction: ResizeDirection;
  cursor: string;
  className: string;
}

const EDGE_SIZE = 5;
const CORNER_SIZE = 10;

const resizeZones: ResizeZone[] = [
  // Corners (rendered first, higher z-index takes precedence)
  {
    direction: "NorthWest",
    cursor: "nw-resize",
    className: `top-0 left-0 w-[${CORNER_SIZE}px] h-[${CORNER_SIZE}px]`,
  },
  {
    direction: "NorthEast",
    cursor: "ne-resize",
    className: `top-0 right-0 w-[${CORNER_SIZE}px] h-[${CORNER_SIZE}px]`,
  },
  {
    direction: "SouthWest",
    cursor: "sw-resize",
    className: `bottom-0 left-0 w-[${CORNER_SIZE}px] h-[${CORNER_SIZE}px]`,
  },
  {
    direction: "SouthEast",
    cursor: "se-resize",
    className: `bottom-0 right-0 w-[${CORNER_SIZE}px] h-[${CORNER_SIZE}px]`,
  },
  // Edges
  {
    direction: "North",
    cursor: "n-resize",
    className: `top-0 left-[${CORNER_SIZE}px] right-[${CORNER_SIZE}px] h-[${EDGE_SIZE}px]`,
  },
  {
    direction: "South",
    cursor: "s-resize",
    className: `bottom-0 left-[${CORNER_SIZE}px] right-[${CORNER_SIZE}px] h-[${EDGE_SIZE}px]`,
  },
  {
    direction: "West",
    cursor: "w-resize",
    className: `left-0 top-[${CORNER_SIZE}px] bottom-[${CORNER_SIZE}px] w-[${EDGE_SIZE}px]`,
  },
  {
    direction: "East",
    cursor: "e-resize",
    className: `right-0 top-[${CORNER_SIZE}px] bottom-[${CORNER_SIZE}px] w-[${EDGE_SIZE}px]`,
  },
];

const handleResizeStart = async (direction: ResizeDirection) => {
  try {
    const window = getCurrentWindow();
    await window.startResizeDragging(direction);
  } catch (error) {
    console.error("Failed to start resize dragging:", error);
  }
};

export const WindowResizeBorder = () => {
  const isLinux = useIsLinux();

  // Only render on Linux where decorations are disabled
  if (!isLinux) {
    return null;
  }

  return (
    <>
      {resizeZones.map((zone) => (
        <div
          key={zone.direction}
          className={`fixed z-[9999] ${zone.className}`}
          style={{
            cursor: zone.cursor,
            // Use inline styles for dynamic sizing since Tailwind can't process template literals
            ...(zone.direction === "NorthWest" && {
              width: CORNER_SIZE,
              height: CORNER_SIZE,
              top: 0,
              left: 0,
            }),
            ...(zone.direction === "NorthEast" && {
              width: CORNER_SIZE,
              height: CORNER_SIZE,
              top: 0,
              right: 0,
            }),
            ...(zone.direction === "SouthWest" && {
              width: CORNER_SIZE,
              height: CORNER_SIZE,
              bottom: 0,
              left: 0,
            }),
            ...(zone.direction === "SouthEast" && {
              width: CORNER_SIZE,
              height: CORNER_SIZE,
              bottom: 0,
              right: 0,
            }),
            ...(zone.direction === "North" && {
              height: EDGE_SIZE,
              top: 0,
              left: CORNER_SIZE,
              right: CORNER_SIZE,
            }),
            ...(zone.direction === "South" && {
              height: EDGE_SIZE,
              bottom: 0,
              left: CORNER_SIZE,
              right: CORNER_SIZE,
            }),
            ...(zone.direction === "West" && {
              width: EDGE_SIZE,
              left: 0,
              top: CORNER_SIZE,
              bottom: CORNER_SIZE,
            }),
            ...(zone.direction === "East" && {
              width: EDGE_SIZE,
              right: 0,
              top: CORNER_SIZE,
              bottom: CORNER_SIZE,
            }),
          }}
          onMouseDown={() => handleResizeStart(zone.direction)}
        />
      ))}
    </>
  );
};
