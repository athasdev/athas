/**
 * Overlay manager stub for backward compatibility
 */

export class OverlayManager {
  static instance: OverlayManager | null = null;

  static getInstance(): OverlayManager {
    if (!OverlayManager.instance) {
      OverlayManager.instance = new OverlayManager();
    }
    return OverlayManager.instance;
  }

  addOverlay(..._args: any[]) {
    // Stub
  }

  removeOverlay(..._args: any[]) {
    // Stub
  }

  clearOverlays(..._args: any[]) {
    // Stub
  }

  updateOverlay(..._args: any[]) {
    // Stub
  }

  showOverlay(..._args: any[]) {
    // Stub
  }

  hideOverlay(..._args: any[]) {
    // Stub
  }

  shouldShowOverlay(..._args: any[]) {
    return false;
  }
}

export function useOverlayManager() {
  return OverlayManager.getInstance();
}
