import type { ReactNode } from "react";
import {
  BrainIcon,
  DatabaseIcon,
  GridIcon,
  PaletteIcon,
  PlugsConnectedIcon,
  SparkleIcon,
  TextIcon,
} from "@/ui/icons";
import { AppearancePreviewGraphic } from "@/extensions/appearance/components/appearance-preview";
import { AdaptiveIcon } from "@/ui/adaptive-icon";
import type { UnifiedExtension } from "./extension-catalog-types";

function categoryIcon(category: UnifiedExtension["category"], className: string): ReactNode {
  const icons = {
    language: <TextIcon className={className} />,
    theme: <PaletteIcon className={className} />,
    "icon-theme": <GridIcon className={className} />,
    database: <DatabaseIcon className={className} />,
    ai: <SparkleIcon className={className} />,
    integration: <PlugsConnectedIcon className={className} />,
    skill: <BrainIcon className={className} />,
    agent: <SparkleIcon className={className} />,
  };

  return icons[category];
}

export function ExtensionCategoryIcon({ category }: { category: UnifiedExtension["category"] }) {
  return categoryIcon(category, "size-4 text-subtle-foreground");
}

function ExtensionIconGraphic({ extension }: { extension: UnifiedExtension }) {
  if (extension.appearancePreview) {
    return <AppearancePreviewGraphic preview={extension.appearancePreview} size="catalog" />;
  }

  if (extension.icon) {
    return <AdaptiveIcon src={extension.icon} className="size-full" />;
  }

  return categoryIcon(extension.category, "size-full text-subtle-foreground");
}

/** The catalog's icon tile, matching the one on athas.dev: a bordered square with the icon inside. */
export function ExtensionIcon({ extension }: { extension: UnifiedExtension }) {
  if (extension.appearancePreview) {
    return <AppearancePreviewGraphic preview={extension.appearancePreview} size="catalog" />;
  }
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground">
      <span className="size-6">
        <ExtensionIconGraphic extension={extension} />
      </span>
    </span>
  );
}

export function ExtensionInlineIcon({ extension }: { extension: UnifiedExtension }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      {extension.appearancePreview ? (
        <AppearancePreviewGraphic
          preview={extension.appearancePreview}
          className="size-4 rounded-sm"
        />
      ) : (
        <ExtensionIconGraphic extension={extension} />
      )}
    </span>
  );
}
