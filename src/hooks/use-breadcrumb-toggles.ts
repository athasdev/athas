import { useState } from "react";

export function useBreadcrumbToggles() {
  const [isOutlineVisible, setIsOutlineVisible] = useState(false);
  const [isMinimapVisible, setIsMinimapVisible] = useState(false);

  const toggleOutline = () => setIsOutlineVisible(!isOutlineVisible);
  const toggleMinimap = () => setIsMinimapVisible(!isMinimapVisible);

  return {
    isOutlineVisible,
    isMinimapVisible,
    toggleOutline,
    toggleMinimap,
    setIsOutlineVisible,
    setIsMinimapVisible,
  };
}
