import type { Buffer } from "../../../types/buffer";
import Breadcrumb from "./breadcrumb";

interface BreadcrumbContainerProps {
  activeBuffer: Buffer | null;
  rootFolderPath: string | null;
  onFileSelect: (path: string, isDirectory: boolean) => Promise<void>;
}

export default function BreadcrumbContainer({
  activeBuffer,
  rootFolderPath,
  onFileSelect,
}: BreadcrumbContainerProps) {
  const handleNavigate = async (path: string) => {
    try {
      await onFileSelect(path, false);
    } catch (error) {
      console.error("Failed to navigate to path:", path, error);
    }
  };

  if (!activeBuffer) {
    return null;
  }

  return (
    <Breadcrumb
      filePath={activeBuffer.path}
      rootPath={rootFolderPath}
      onNavigate={handleNavigate}
      isOutlineVisible={false}
      onToggleOutline={() => {}}
    />
  );
}
