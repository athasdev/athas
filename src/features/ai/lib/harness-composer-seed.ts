interface EditableTargetLike extends EventTarget {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
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
