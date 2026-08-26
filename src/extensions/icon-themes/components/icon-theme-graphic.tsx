import DOMPurify from "dompurify";
import { cloneElement, isValidElement, useMemo } from "react";
import type { IconResult } from "../icon-theme.types";
import { cn } from "@/utils/cn";

const ICON_CACHE_KEY = import.meta.env.DEV ? Date.now().toString(36) : "";

function getIconUrl(url: string) {
  if (!ICON_CACHE_KEY || url.startsWith("data:")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${ICON_CACHE_KEY}`;
}

interface IconThemeGraphicProps {
  result: IconResult | null | undefined;
  className?: string;
}

export function IconThemeGraphic({
  result,
  className = "text-subtle-foreground",
}: IconThemeGraphicProps) {
  const sanitizedSvg = useMemo(
    () =>
      result?.svg
        ? DOMPurify.sanitize(result.svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          })
        : null,
    [result?.svg],
  );
  const iconClassName = cn(
    "inline-block size-[1em] shrink-0 leading-none [&_svg]:block [&_svg]:size-full",
    className,
  );

  if (result?.component) {
    if (isValidElement(result.component)) {
      return cloneElement(result.component, {
        className: iconClassName,
      } as React.Attributes & {
        className: string;
      });
    }
    return <span className={iconClassName}>{result.component}</span>;
  }

  if (sanitizedSvg) {
    return <span className={iconClassName} dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />;
  }

  if (result?.url) {
    return <img src={getIconUrl(result.url)} alt="" aria-hidden="true" className={iconClassName} />;
  }

  return <span className={className}>&#8226;</span>;
}
