import { IconThemeGraphic } from "@/extensions/icon-themes/components/icon-theme-graphic";
import { cn } from "@/utils/cn";
import type { AppearancePreview } from "../appearance-preview";

type AppearancePreviewSize = "compact" | "catalog" | "detail";

const previewSizeClasses: Record<
  AppearancePreviewSize,
  { frame: string; icon: string; radius: string }
> = {
  compact: { frame: "size-6", icon: "size-4", radius: "rounded-md" },
  catalog: { frame: "size-8", icon: "size-5", radius: "rounded-lg" },
  detail: { frame: "size-10", icon: "size-6", radius: "rounded-lg" },
};

export function AppearancePreviewGraphic({
  className,
  preview,
  size = "compact",
}: {
  className?: string;
  preview: AppearancePreview;
  size?: AppearancePreviewSize;
}) {
  const styles = previewSizeClasses[size];

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden border border-border/70 bg-background",
        styles.frame,
        styles.radius,
        className,
      )}
      role="img"
      aria-label={preview.label}
    >
      {preview.kind === "theme" ? (
        <span className="flex size-full">
          {preview.colors.map((color, index) => (
            <span
              key={`${color}-${index}`}
              className="h-full min-w-0 flex-1"
              style={{ background: color }}
            />
          ))}
        </span>
      ) : (
        <IconThemeGraphic result={preview.icon} className={styles.icon} />
      )}
    </span>
  );
}
