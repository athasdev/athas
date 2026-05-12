import { useCallback, type PointerEvent as ReactPointerEvent } from "react";

type Props = { width: number; onChange: (w: number) => void };

export function WidthHandle({ width, onChange }: Props) {
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const move = (ev: PointerEvent) => {
        const next = Math.max(200, Math.min(1600, startWidth + (ev.clientX - startX)));
        onChange(Math.round(next));
      };
      const up = () => {
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          /* pointer may already be released */
        }
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", up);
    },
    [width, onChange],
  );

  return (
    <div
      className="codesnap-width-handle"
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={200}
      aria-valuemax={1600}
    />
  );
}
