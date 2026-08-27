import { ExtensionsIcon as Extensions } from "@/ui/icons";
import { PathBreadcrumb } from "@/features/editor/components/toolbar/path-breadcrumb";
import { ExtensionCategoryIcon, ExtensionInlineIcon } from "./extension-catalog-icon";
import {
  EXTENSION_CATEGORIES,
  type ExtensionCategory,
  type UnifiedExtension,
} from "./extension-catalog-types";

export function ExtensionsBreadcrumb({
  category,
  extension,
  onOpenCatalog,
  onOpenCategory,
}: {
  category?: ExtensionCategory;
  extension?: UnifiedExtension | null;
  onOpenCatalog: () => void;
  onOpenCategory: (category: ExtensionCategory) => void;
}) {
  const categoryLabel = EXTENSION_CATEGORIES.find((item) => item.id === category)?.label;
  const segments = ["Extensions"];
  const icons = [<Extensions key="extensions" className="size-4" weight="duotone" />];

  if (category && categoryLabel) {
    segments.push(categoryLabel);
    icons.push(<ExtensionCategoryIcon key={category} category={category} />);
  }

  if (extension) {
    segments.push(extension.name);
    icons.push(<ExtensionInlineIcon key={extension.id} extension={extension} />);
  }

  return (
    <PathBreadcrumb
      ariaLabel="Extension path"
      segments={segments}
      icons={icons}
      interactive={(index) => index < segments.length - 1}
      onSegmentClick={(index) => {
        if (index === 0) onOpenCatalog();
        if (index === 1 && category) onOpenCategory(category);
      }}
      className="flex-1"
    />
  );
}
