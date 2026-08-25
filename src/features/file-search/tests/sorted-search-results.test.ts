import { describe, expect, it } from "vite-plus/test";
import { insertSortedLimited } from "../utils/sorted-search-results";

describe("insertSortedLimited", () => {
  it("keeps the best candidates sorted within the requested limit", () => {
    const values = [2, 4];

    insertSortedLimited(values, 3, (left, right) => left - right, 3);
    insertSortedLimited(values, 1, (left, right) => left - right, 3);
    insertSortedLimited(values, 5, (left, right) => left - right, 3);

    expect(values).toEqual([1, 2, 3]);
  });

  it("does not add candidates when the limit is zero", () => {
    const values: number[] = [];

    insertSortedLimited(values, 1, (left, right) => left - right, 0);

    expect(values).toEqual([]);
  });
});
