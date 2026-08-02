export type ProjectCarouselDirection = 1 | -1;

const PROJECT_SNAP_MIN_DURATION_SECONDS = 0.035;
const PROJECT_SNAP_MAX_DURATION_SECONDS = 0.14;

export function getAdjacentProjectIndex(
  currentIndex: number,
  direction: ProjectCarouselDirection,
  projectCount: number,
) {
  if (currentIndex < 0 || currentIndex >= projectCount) {
    return null;
  }

  const targetIndex = currentIndex + direction;
  return targetIndex >= 0 && targetIndex < projectCount ? targetIndex : null;
}

export function getProjectCarouselDirection(currentIndex: number, targetIndex: number) {
  if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) {
    return null;
  }

  return targetIndex > currentIndex ? 1 : -1;
}

export function getProjectSwipeBounds(
  hasPreviousProject: boolean,
  hasNextProject: boolean,
  maximumTravel: number,
) {
  const travel = Math.max(0, maximumTravel);
  return {
    left: hasNextProject ? -travel : 0,
    right: hasPreviousProject ? travel : 0,
  };
}

export function getProjectSnapDuration(
  currentPosition: number,
  targetPosition: number,
  panelWidth: number,
) {
  if (!Number.isFinite(panelWidth) || panelWidth <= 0) {
    return PROJECT_SNAP_MAX_DURATION_SECONDS;
  }

  const remainingDistance = Math.abs(targetPosition - currentPosition);
  if (remainingDistance < 0.5) return 0;

  const remainingRatio = Math.min(remainingDistance / panelWidth, 1);
  return Math.max(
    PROJECT_SNAP_MIN_DURATION_SECONDS,
    PROJECT_SNAP_MAX_DURATION_SECONDS * remainingRatio,
  );
}
