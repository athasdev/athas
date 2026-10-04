// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  markBundledContributionExtensionUninstalled,
  readInstalledBundledContributionExtensionIds,
} from "@/extensions/registry/bundled-contribution-install-state";
import {
  markExtensionDisabled,
  markExtensionEnabled,
  readDisabledExtensionIds,
} from "@/extensions/registry/extension-enabled-state";

afterEach(() => {
  localStorage.clear();
});

describe("disabled integration state", () => {
  it("starts with every integration enabled", () => {
    expect(readDisabledExtensionIds()).toEqual(new Set());
  });

  it("remembers disabled integrations and re-enables them", () => {
    markExtensionDisabled("athas.rust");
    markExtensionDisabled("athas.go");
    markExtensionDisabled("athas.rust");

    expect(readDisabledExtensionIds()).toEqual(new Set(["athas.go", "athas.rust"]));
    expect(localStorage.getItem("athas.disabledExtensions")).toBe('["athas.go","athas.rust"]');

    markExtensionEnabled("athas.rust");
    expect(readDisabledExtensionIds()).toEqual(new Set(["athas.go"]));
  });

  it("recovers from corrupt or unexpected stored values", () => {
    localStorage.setItem("athas.disabledExtensions", "{not json");
    expect(readDisabledExtensionIds()).toEqual(new Set());

    localStorage.setItem("athas.disabledExtensions", '{"athas.rust":true}');
    expect(readDisabledExtensionIds()).toEqual(new Set());

    localStorage.setItem("athas.disabledExtensions", '["athas.rust", "", 42, null]');
    expect(readDisabledExtensionIds()).toEqual(new Set(["athas.rust"]));
  });
});

describe("bundled contribution install state", () => {
  it("drops an uninstalled bundled integration and keeps the rest", () => {
    localStorage.setItem(
      "athas.installedBundledContributionExtensions",
      '["athas.postgres", "athas.sqlite", 7]',
    );

    markBundledContributionExtensionUninstalled("athas.postgres");

    expect(readInstalledBundledContributionExtensionIds()).toEqual(new Set(["athas.sqlite"]));
  });

  it("treats corrupt storage as nothing installed", () => {
    localStorage.setItem("athas.installedBundledContributionExtensions", "[");

    expect(readInstalledBundledContributionExtensionIds()).toEqual(new Set());
  });
});
