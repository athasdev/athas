import { describe, expect, test } from "bun:test";
import { getHarnessComposerSeedCharacter } from "./harness-composer-seed";

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
});
