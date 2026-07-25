import type { ContentSearchOptions } from "../types/global-search.types";

export type SearchOptionValue = "case-sensitive" | "whole-word" | "regex";

export function toSearchOptionValues(options: ContentSearchOptions): SearchOptionValue[] {
  const values: SearchOptionValue[] = [];

  if (options.caseSensitive) values.push("case-sensitive");
  if (options.wholeWord) values.push("whole-word");
  if (options.useRegex) values.push("regex");

  return values;
}

export function fromSearchOptionValues(values: SearchOptionValue[]): ContentSearchOptions {
  const selected = new Set(values);

  return {
    caseSensitive: selected.has("case-sensitive"),
    wholeWord: selected.has("whole-word"),
    useRegex: selected.has("regex"),
  };
}
