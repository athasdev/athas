interface EmbeddedWebviewVisibilityState {
  isActive: boolean;
  isVisible: boolean;
  overlayHidden: boolean;
}

export function shouldShowEmbeddedWebview({
  isActive,
  isVisible,
  overlayHidden,
}: EmbeddedWebviewVisibilityState): boolean {
  return isActive && isVisible && !overlayHidden;
}
