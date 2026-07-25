export type ProjectCarouselDirection = 1 | -1;

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
