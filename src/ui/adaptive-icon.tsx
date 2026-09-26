import { type CSSProperties, useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { decodeSvgDataUri, getSvgIconTone, type SvgIconTone } from "@/utils/svg-icon-tone";

const iconToneCache = new Map<string, SvgIconTone>();
const pendingIconTones = new Map<string, Promise<SvgIconTone>>();

function isSvgSource(src: string) {
  return src.startsWith("data:image/svg+xml") || /\.svg(?:[?#]|$)/i.test(src);
}

function loadIconTone(src: string): Promise<SvgIconTone> {
  const pending = pendingIconTones.get(src);
  if (pending) return pending;
  const load = fetch(src)
    .then((response) => (response.ok ? response.text() : ""))
    .then((svg) => (svg ? getSvgIconTone(svg) : "color"))
    .catch((): SvgIconTone => "color")
    .then((tone) => {
      iconToneCache.set(src, tone);
      return tone;
    });
  pendingIconTones.set(src, load);
  return load;
}

function readIconTone(src: string): SvgIconTone | undefined {
  const cached = iconToneCache.get(src);
  if (cached) return cached;
  const dataSvg = decodeSvgDataUri(src);
  if (dataSvg === null) return isSvgSource(src) ? undefined : "color";
  const tone = getSvgIconTone(dataSvg);
  iconToneCache.set(src, tone);
  return tone;
}

/** The icon's tone: known at once for data URIs, loaded once per URL for remote SVGs. */
function useIconTone(src: string): SvgIconTone {
  const [tone, setTone] = useState(() => readIconTone(src) ?? "color");
  useEffect(() => {
    const known = readIconTone(src);
    if (known) {
      setTone(known);
      return;
    }
    let cancelled = false;
    void loadIconTone(src).then((nextTone) => {
      if (!cancelled) setTone(nextTone);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);
  return tone;
}

/**
 * An icon image from outside the app (extension catalog, agent registry). Icons without colors of
 * their own are drawn as a mask in the current text color, so a black or `currentColor` mark stays
 * readable on dark themes; colored icons keep their own art. Size it through `className`.
 */
export function AdaptiveIcon({ src, className }: { src: string; className?: string }) {
  const tone = useIconTone(src);
  if (tone === "monochrome") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "block shrink-0 bg-current mask-(--adaptive-icon) mask-contain mask-center mask-no-repeat",
          className,
        )}
        style={{ "--adaptive-icon": `url("${src.replace(/"/g, "%22")}")` } as CSSProperties}
      />
    );
  }
  return (
    <img alt="" className={cn("shrink-0 object-contain", className)} draggable={false} src={src} />
  );
}
