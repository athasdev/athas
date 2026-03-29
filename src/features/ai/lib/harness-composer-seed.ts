interface EditableTargetLike extends EventTarget {
  tagName?: string;
  nodeName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

export interface HarnessSeedScopeLike {
  contains?: (target: Node | null) => boolean;
}

export interface HarnessComposerSeedEvent {
  key: string;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  target: EventTarget | null;
}

export interface HarnessComposerSeedContext {
  harnessRoot: HarnessSeedScopeLike | null;
  target: EventTarget | null;
  activeTarget: EventTarget | null;
}

const isEditableEventTarget = (target: EventTarget | null): boolean => {
  const element = target as EditableTargetLike | null;
  if (!element) {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  const tagName = element.tagName?.toUpperCase();
  if (tagName && ["INPUT", "TEXTAREA", "SELECT"].includes(tagName)) {
    return true;
  }

  return Boolean(element.closest?.("[contenteditable='true'],input,textarea,select"));
};

const isWindowLevelTarget = (target: EventTarget | null): boolean => {
  const element = target as EditableTargetLike | null;
  const tagName = element?.tagName ?? element?.nodeName;
  return ["BODY", "HTML", "#DOCUMENT"].includes(tagName?.toUpperCase() ?? "");
};

const isContainedByHarness = (
  harnessRoot: HarnessSeedScopeLike | null,
  target: EventTarget | null,
): boolean => {
  if (!harnessRoot?.contains) {
    return false;
  }

  return harnessRoot.contains(target as Node | null);
};

export const shouldSeedHarnessComposerKeyEvent = ({
  harnessRoot,
  target,
  activeTarget,
}: HarnessComposerSeedContext): boolean => {
  if (!harnessRoot || isEditableEventTarget(target)) {
    return false;
  }

  if (isContainedByHarness(harnessRoot, target)) {
    return true;
  }

  if (isContainedByHarness(harnessRoot, activeTarget) && !isEditableEventTarget(activeTarget)) {
    return true;
  }

  return (
    isWindowLevelTarget(target) && (activeTarget === null || isWindowLevelTarget(activeTarget))
  );
};

export const getHarnessComposerSeedCharacter = ({
  key,
  defaultPrevented,
  metaKey,
  ctrlKey,
  altKey,
  isComposing,
  target,
}: HarnessComposerSeedEvent): string | null => {
  if (defaultPrevented || metaKey || ctrlKey || altKey || isComposing) {
    return null;
  }

  if (key.length !== 1) {
    return null;
  }

  if (isEditableEventTarget(target)) {
    return null;
  }

  return key;
};
