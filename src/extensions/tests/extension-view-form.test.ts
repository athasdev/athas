import { describe, expect, it } from "vite-plus/test";
import {
  collectExtensionViewFormFields,
  createExtensionViewFormValues,
  EXTENSION_VIEW_FORM_LIMITS,
  extensionViewFormPayloadFits,
  getMissingExtensionViewFormFields,
} from "../ui/services/extension-view-form";
import type { ExtensionViewNode } from "../ui/types/extension-view";

describe("extension view form", () => {
  const children: ExtensionViewNode[] = [
    { type: "input", name: "title", required: true, value: "Release" },
    {
      type: "row",
      children: [
        { type: "numberInput", name: "replicas", required: true, value: 3 },
        {
          type: "choice",
          name: "regions",
          required: true,
          multiple: true,
          value: ["eu"],
          options: [{ label: "Europe", value: "eu" }],
        },
      ],
    },
    { type: "checkbox", name: "confirmed", required: true, label: "Confirm", checked: false },
  ];

  it("collects nested named controls into one typed value object", () => {
    const fields = collectExtensionViewFormFields(children);
    const values = createExtensionViewFormValues(fields);

    expect(values).toEqual({
      title: "Release",
      replicas: 3,
      regions: ["eu"],
      confirmed: false,
    });
    expect(getMissingExtensionViewFormFields(fields, values)).toEqual(["confirmed"]);
    expect(
      getMissingExtensionViewFormFields(fields, { ...values, confirmed: true, title: "  " }),
    ).toEqual(["title"]);
  });

  it("bounds the values submitted back to an extension", () => {
    expect(extensionViewFormPayloadFits({ note: "ready" })).toBe(true);
    expect(
      extensionViewFormPayloadFits({
        note: "x".repeat(EXTENSION_VIEW_FORM_LIMITS.maxPayloadCharacters + 1),
      }),
    ).toBe(false);
  });
});
