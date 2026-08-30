import { describe, expect, test } from "vite-plus/test";
import { GIT_SIDEBAR_TAB_IDS, SIDEBAR_ACTIVITY_ITEM_IDS } from "../config/item-order";
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

  test("moves Review from the activity rail into Source Control", () => {
    expect(SIDEBAR_ACTIVITY_ITEM_IDS).toEqual([
      "files",
      "git",
      "github-prs",
      "views",
      "debugger",
      "databases",
      "docker",
      "extensions",
    ]);
    expect(GIT_SIDEBAR_TAB_IDS).toEqual(["changes", "history", "review"]);
  });
});
