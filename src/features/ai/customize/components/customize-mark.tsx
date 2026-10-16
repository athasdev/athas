import type { ReactNode } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { GithubMark } from "@/ui/brand-marks";
import type { CustomizeBrand } from "../types/customize.types";

/** A brand's own art, or `fallback` when it has none. Sized by the tile or row around it. */
export function CustomizeMark({
  brand,
  fallback,
  size,
}: {
  brand?: CustomizeBrand;
  fallback: ReactNode;
  size: "tile" | "inline";
}) {
  const pixels = size === "tile" ? 22 : 16;
  if (!brand) return fallback;
  if (brand.kind === "image") {
    return (
      <img
        src={brand.src}
        alt=""
        draggable={false}
        className={size === "inline" ? "size-4 object-contain" : undefined}
      />
    );
  }
  if (brand.kind === "github") return <GithubMark size={pixels} />;
  return <ProviderIcon providerId={brand.providerId} iconUrl={brand.iconUrl} size={pixels} />;
}
