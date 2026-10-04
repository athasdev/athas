import ignore from "ignore";
import type { FilterSearchEntriesTask } from "./search-worker-protocol";

const matcherCache = new Map<string, ReturnType<typeof ignore>>();
function matcherFor(content: string) {
  const cached = matcherCache.get(content);
  if (cached) {
    matcherCache.delete(content);
    matcherCache.set(content, cached);
    return cached;
  }
  const matcher = ignore({ ignorecase: false }).add(content.replace(/^\uFEFF/, ""));
  matcherCache.set(content, matcher);
  if (matcherCache.size > 64) matcherCache.delete(matcherCache.keys().next().value!);
  return matcher;
}
const IGNORE_PRIORITIES = ["exclude", "gitignore", "ignore"] as const;

export function filterProviderSearchEntries(task: FilterSearchEntriesTask): number[] {
  const rules = IGNORE_PRIORITIES.flatMap((kind) =>
    task.rules
      .filter((rule) => rule.kind === kind)
      .map((rule) => ({
        directory: rule.directory,
        matcher: matcherFor(rule.content),
      })),
  );
  const visible: number[] = [];
  for (let index = 0; index < task.entries.length; index++) {
    const entry = task.entries[index];
    let ignored = false;
    for (const rule of rules) {
      const prefix = rule.directory ? `${rule.directory}/` : "";
      if (!entry.path.startsWith(prefix)) continue;
      const relative = entry.path.slice(prefix.length) + (entry.isDir ? "/" : "");
      const result = rule.matcher.test(relative);
      if (result.ignored) ignored = true;
      else if (result.unignored) ignored = false;
    }
    if (!ignored) visible.push(index);
  }
  return visible;
}
