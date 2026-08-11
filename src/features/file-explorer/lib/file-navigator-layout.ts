export const DEFAULT_FILE_NAVIGATOR_WIDTH = 224;
export const MIN_FILE_NAVIGATOR_WIDTH = 176;
export const MAX_FILE_NAVIGATOR_WIDTH = 420;

const MAX_FILE_NAVIGATOR_PARENT_RATIO = 0.5;

export interface FileNavigatorLayout {
  width: number;
  minWidth: number;
  maxWidth: number;
}

export function clampFileNavigatorWidth(width: number): number {
  return Math.max(MIN_FILE_NAVIGATOR_WIDTH, Math.min(width, MAX_FILE_NAVIGATOR_WIDTH));
}

export function getFileNavigatorLayout(
  preferredWidth: number,
  parentWidth?: number,
): FileNavigatorLayout {
  const maxWidth =
    parentWidth === undefined
      ? MAX_FILE_NAVIGATOR_WIDTH
      : Math.max(
          0,
          Math.min(
            MAX_FILE_NAVIGATOR_WIDTH,
            Math.floor(parentWidth * MAX_FILE_NAVIGATOR_PARENT_RATIO),
          ),
        );
  const minWidth = Math.min(MIN_FILE_NAVIGATOR_WIDTH, maxWidth);
  const width = Math.min(maxWidth, Math.max(minWidth, Math.round(preferredWidth)));

  return { width, minWidth, maxWidth };
}
