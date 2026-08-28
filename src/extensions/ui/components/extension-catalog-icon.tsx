import type { ReactNode } from "react";
import {
  BrainIcon as Brain,
  DatabaseIcon as Database,
  PaletteIcon as Palette,
  PlugsConnectedIcon as PlugsConnected,
  RobotIcon as Robot,
  SparkleIcon as Sparkles,
  TextTIcon as TextT,
  SquaresFourIcon as SquaresFour,
} from "@/ui/icons";
import { AppearancePreviewGraphic } from "@/extensions/appearance/components/appearance-preview";
import type { UnifiedExtension } from "./extension-catalog-types";

function categoryIcon(category: UnifiedExtension["category"], className: string): ReactNode {
  const icons = {
    language: <TextT className={className} weight="duotone" />,
    theme: <Palette className={className} weight="duotone" />,
    "icon-theme": <SquaresFour className={className} weight="duotone" />,
    database: <Database className={className} weight="duotone" />,
    ai: <Sparkles className={className} weight="duotone" />,
    integration: <PlugsConnected className={className} weight="duotone" />,
    skill: <Brain className={className} weight="duotone" />,
    agent: <Robot className={className} weight="duotone" />,
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
    return (
      <img alt="" className="size-full object-contain" draggable={false} src={extension.icon} />
    );
  }

  return categoryIcon(extension.category, "size-full text-subtle-foreground");
}

export function ExtensionIcon({ extension }: { extension: UnifiedExtension }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center">
      <span className="size-8">
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
