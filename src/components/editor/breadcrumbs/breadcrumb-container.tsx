import React from "react";
import { useBreadcrumbToggles } from "../../../hooks/use-breadcrumb-toggles";
import type { Buffer } from "../../../types/buffer";
import Breadcrumb from "./breadcrumb";

interface BreadcrumbContainerProps {
  activeBuffer: Buffer | null;
  rootFolderPath: string | null;
  onFileSelect: (path: string, isDirectory: boolean) => Promise<void>;
  setIsRightPaneVisible: (visible: boolean) => void;
  onMinimapStateChange?: (isVisible: boolean) => void;
}

export default function BreadcrumbContainer({
  activeBuffer,
  rootFolderPath,
  onFileSelect,
  setIsRightPaneVisible,
  onMinimapStateChange,
}: BreadcrumbContainerProps) {
  const { isOutlineVisible, isMinimapVisible, toggleMinimap, setIsOutlineVisible } =
    useBreadcrumbToggles();

  React.useEffect(() => {
    if (onMinimapStateChange) {
      onMinimapStateChange(isMinimapVisible);
    }
  }, [isMinimapVisible, onMinimapStateChange]);

  const handleToggleOutline = () => {
    if (isOutlineVisible) {
      setIsOutlineVisible(false);
      setIsRightPaneVisible(false);
    } else {
      setIsOutlineVisible(true);
      setIsRightPaneVisible(true);
    }
  };

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
      isOutlineVisible={isOutlineVisible}
      isMinimapVisible={isMinimapVisible}
      onToggleOutline={handleToggleOutline}
      onToggleMinimap={toggleMinimap}
    />
  );
}
