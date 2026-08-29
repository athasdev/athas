import { describe, expect, test } from "vite-plus/test";
import { FOOTER_TRAILING_ITEM_IDS, SIDEBAR_ACTIVITY_ITEM_IDS } from "../config/item-order";
import { orderChromeItems, type ChromeItem } from "../utils/chrome-items";

type ItemId = "first" | "second" | "third";

const items: Array<ChromeItem<ItemId>> = [
  { id: "first", label: "First", content: "first" },
  { id: "second", label: "Second", content: "second" },
  { id: "third", label: "Third", content: "third" },
];

describe("orderChromeItems", () => {
  test("orders items by their persisted IDs", () => {
    expect(orderChromeItems(items, ["third", "first", "second"]).map((item) => item.id)).toEqual([
      "third",
      "first",
      "second",
    ]);
  });

  test("appends items missing from the persisted order", () => {
    expect(orderChromeItems(items, ["second"]).map((item) => item.id)).toEqual([
      "second",
      "first",
      "third",
    ]);
  });

  test("keeps search and notifications out of legacy activity and footer ordering", () => {
    expect(SIDEBAR_ACTIVITY_ITEM_IDS).not.toContain("search");
    expect(FOOTER_TRAILING_ITEM_IDS).not.toContain("notifications");
  });

  test("keeps Review beside Source Control in the default activity order", () => {
    expect(SIDEBAR_ACTIVITY_ITEM_IDS).toEqual([
      "files",
      "git",
      "review",
      "github-prs",
      "views",
      "docker",
      "extensions",
    ]);
  });
});
