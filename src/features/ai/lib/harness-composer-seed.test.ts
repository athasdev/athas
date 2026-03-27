import { describe, expect, test } from "bun:test";
import {
  getHarnessComposerSeedCharacter,
  type HarnessSeedScopeLike,
  shouldSeedHarnessComposerKeyEvent,
} from "./harness-composer-seed";

const createTarget = ({
  tagName,
  isContentEditable = false,
  closestResult = null,
}: {
  tagName?: string;
  isContentEditable?: boolean;
  closestResult?: unknown;
} = {}) =>
  ({
    tagName,
    isContentEditable,
    closest: () => closestResult,
  }) as unknown as EventTarget;

const createHarnessRoot = (containedTargets: EventTarget[] = []) =>
  ({
    contains: (target: EventTarget | null) => target !== null && containedTargets.includes(target),
  }) as unknown as HarnessSeedScopeLike;

describe("harness composer seed", () => {
  test("captures printable keys from non-editable Harness controls", () => {
    expect(
      getHarnessComposerSeedCharacter({
        key: "R",
        defaultPrevented: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        isComposing: false,
        target: createTarget({ tagName: "button" }),
      }),
    ).toBe("R");
  });

  test("does not capture navigation or command keys", () => {
    expect(
      getHarnessComposerSeedCharacter({
        key: "Enter",
        defaultPrevented: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        isComposing: false,
        target: createTarget({ tagName: "button" }),
      }),
    ).toBeNull();

    expect(
      getHarnessComposerSeedCharacter({
        key: "k",
        defaultPrevented: false,
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        isComposing: false,
        target: createTarget({ tagName: "button" }),
      }),
    ).toBeNull();
  });

  test("does not capture keys when the event already belongs to an editable target", () => {
    expect(
      getHarnessComposerSeedCharacter({
        key: "a",
        defaultPrevented: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        isComposing: false,
        target: createTarget({ tagName: "textarea" }),
      }),
    ).toBeNull();

    expect(
      getHarnessComposerSeedCharacter({
        key: "a",
        defaultPrevented: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        isComposing: false,
        target: createTarget({ closestResult: {} }),
      }),
    ).toBeNull();
  });

  test("ignores prevented and composing events", () => {
    expect(
      getHarnessComposerSeedCharacter({
        key: "a",
        defaultPrevented: true,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        isComposing: false,
        target: createTarget({ tagName: "button" }),
      }),
    ).toBeNull();

    expect(
      getHarnessComposerSeedCharacter({
        key: "a",
        defaultPrevented: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        isComposing: true,
        target: createTarget({ tagName: "button" }),
      }),
    ).toBeNull();
  });

  test("allows window-level fallback targets when Harness is the active surface", () => {
    const bodyTarget = createTarget({ tagName: "body" });

    expect(
      shouldSeedHarnessComposerKeyEvent({
        harnessRoot: createHarnessRoot(),
        target: bodyTarget,
        activeTarget: bodyTarget,
      }),
    ).toBe(true);
  });

  test("allows a window-level target when the active element is still inside Harness", () => {
    const bodyTarget = createTarget({ tagName: "body" });
    const focusedHarnessButton = createTarget({ tagName: "button" });

    expect(
      shouldSeedHarnessComposerKeyEvent({
        harnessRoot: createHarnessRoot([focusedHarnessButton]),
        target: bodyTarget,
        activeTarget: focusedHarnessButton,
      }),
    ).toBe(true);
  });

  test("rejects non-Harness targets when focus is outside Harness", () => {
    const bodyTarget = createTarget({ tagName: "body" });
    const outsideButton = createTarget({ tagName: "button" });

    expect(
      shouldSeedHarnessComposerKeyEvent({
        harnessRoot: createHarnessRoot(),
        target: bodyTarget,
        activeTarget: outsideButton,
      }),
    ).toBe(false);
  });
});
