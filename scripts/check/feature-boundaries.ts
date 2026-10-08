#!/usr/bin/env bun
/**
 * Import graph analysis for the feature boundary check.
 *
 * The rule itself (which folders are public, which components are exported) lives in
 * `feature-boundaries.config.ts`; the ratchet baseline lives in
 * `feature-boundaries.baseline.json`. `scripts/check/tests/feature-boundaries.test.ts` runs the
 * check as part of the test suite. Run this file directly to print a report or to rewrite the
 * baseline:
 *
 *   bun scripts/check/feature-boundaries.ts             # summary of current violations
 *   bun scripts/check/feature-boundaries.ts --update    # rewrite the baseline from the tree
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  featureBoundaries,
  type FeatureBoundaryConfig,
  type FeatureBoundaryBaseline,
} from "./feature-boundaries.config";

export type ImportKind = "static" | "type" | "dynamic" | "mock";

export type ParsedImport = { specifier: string; kind: ImportKind };

export type ImportEdge = { from: string; to: string; kind: ImportKind };

export type ImportGraph = { files: string[]; edges: ImportEdge[] };

const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const RUNTIME_PROMISE_MEMBERS = new Set(["then", "catch", "finally"]);
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".d.ts", "/index.ts", "/index.tsx"];

/** Blanks out comments while keeping string literals and offsets intact. */
export function stripComments(source: string): string {
  let output = "";
  let index = 0;
  let quote: string | null = null;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      output += char;
      if (char === "\\") {
        output += next ?? "";
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      output += char;
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      output += source.slice(index, stop).replace(/[^\n]/g, " ");
      index = stop;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function isTypeOnlyClause(keyword: string, clause: string): boolean {
  const trimmed = clause.trim();
  if (trimmed.startsWith("type ") || trimmed.startsWith("type{")) return true;
  if (keyword === "export" && trimmed.startsWith("*")) return false;
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;

  const specifiers = trimmed
    .slice(1, -1)
    .split(",")
    .map((specifier) => specifier.trim())
    .filter(Boolean);
  return specifiers.length > 0 && specifiers.every((specifier) => specifier.startsWith("type "));
}

export function parseImports(rawSource: string): ParsedImport[] {
  const source = stripComments(rawSource);
  const imports: ParsedImport[] = [];

  for (const [, keyword, clause, specifier] of source.matchAll(
    /(?:^|[;\n}])\s*(import|export)(?:\s+|(?=[{*]))([\w$\s{},*]*?)\s*from\s*["']([^"']+)["']/g,
  )) {
    imports.push({ specifier, kind: isTypeOnlyClause(keyword, clause) ? "type" : "static" });
  }

  for (const [, specifier] of source.matchAll(/(?:^|[;\n])\s*import\s*["']([^"']+)["']/g)) {
    imports.push({ specifier, kind: "static" });
  }

  for (const [, prefix, specifier, member] of source.matchAll(
    /(\btypeof\s*)?\bimport\s*\(\s*["']([^"']+)["']\s*(?:,[^)]*)?\)(?:\s*\.\s*(\w+))?/g,
  )) {
    const isTypeQuery = Boolean(prefix) || (member && !RUNTIME_PROMISE_MEMBERS.has(member));
    imports.push({ specifier, kind: isTypeQuery ? "type" : "dynamic" });
  }

  for (const [, specifier] of source.matchAll(
    /\bvi\.(?:mock|doMock|unmock|importActual|importMock)\s*(?:<[^>]*>)?\(\s*["']([^"']+)["']/g,
  )) {
    imports.push({ specifier, kind: "mock" });
  }

  return imports;
}

export function collectSourceFiles(repoRoot: string, sourceRoot: string): string[] {
  const walk = (relative: string): string[] =>
    readdirSync(path.join(repoRoot, relative), { withFileTypes: true }).flatMap((entry) => {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) return walk(child);
      if (!SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) return [];
      if (entry.name.endsWith(".d.ts")) return [];
      return [child];
    });

  return walk(sourceRoot).sort();
}

export function resolveSpecifier(
  specifier: string,
  fromFile: string,
  sourceRoot: string,
  fileExists: (file: string) => boolean,
): string | null {
  const bare = specifier.replace(/\?.*$/, "");
  let base: string;
  if (bare.startsWith("@/")) base = `${sourceRoot}/${bare.slice(2)}`;
  else if (bare.startsWith("./") || bare.startsWith("../") || bare === "." || bare === "..") {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), bare));
  } else return null;

  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

export function buildImportGraph(repoRoot: string, sourceRoot = "src"): ImportGraph {
  const files = collectSourceFiles(repoRoot, sourceRoot);
  const known = new Set(files);
  const fileExists = (file: string) => {
    if (known.has(file)) return true;
    if (!/\.[a-z]+$/i.test(file)) return false;
    const absolute = path.join(repoRoot, file);
    return existsSync(absolute) && statSync(absolute).isFile();
  };
  const edges: ImportEdge[] = [];

  for (const file of files) {
    const source = readFileSync(path.join(repoRoot, file), "utf8");
    for (const { specifier, kind } of parseImports(source)) {
      const to = resolveSpecifier(specifier, file, sourceRoot, fileExists);
      if (to && to !== file) edges.push({ from: file, to, kind });
    }
  }

  return { files, edges };
}

export function featureOf(file: string, config: FeatureBoundaryConfig = featureBoundaries) {
  const prefix = `${config.featuresRoot}/`;
  if (!file.startsWith(prefix)) return null;
  const [feature, ...rest] = file.slice(prefix.length).split("/");
  return rest.length > 0 ? feature : null;
}

export function isTestFile(file: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(file) || file.split("/").includes("tests");
}

export type TargetClassification = { role: string; isPublic: boolean };

/**
 * Classifies a file inside a feature. A file listed in `publicFiles` is public. Otherwise a private
 * folder anywhere in its path makes it private, and the innermost layer folder (`components`,
 * `stores`, `types`, ...) decides, so `stores/ui-state/types/x.ts` counts as `types`. Files outside
 * every layer folder are "root" files of the feature or of a nested subfeature.
 */
export function classifyTarget(
  file: string,
  config: FeatureBoundaryConfig = featureBoundaries,
): TargetClassification {
  const feature = featureOf(file, config);
  if (!feature) return { role: "outside", isPublic: true };

  const featureRelative = file.slice(`${config.featuresRoot}/${feature}/`.length);
  const segments = featureRelative.split("/");
  const directories = segments.slice(0, -1);
  const fileName = segments[segments.length - 1];
  const listed = Object.keys(config.publicFiles[feature] ?? {}).some((pattern) =>
    matchesPattern(featureRelative, pattern),
  );

  const privateFolder = directories.find((directory) => config.privateFolders.includes(directory));
  const role =
    privateFolder ??
    [...directories].reverse().find((directory) => config.layerFolders.includes(directory)) ??
    "root";

  if (listed) return { role, isPublic: true };
  if (privateFolder || !config.publicFolders.includes(role)) return { role, isPublic: false };
  if (role === "stores" && config.storeFilePattern && !config.storeFilePattern.test(fileName)) {
    return { role: "stores-internal", isPublic: false };
  }
  return { role, isPublic: true };
}

function matchesPattern(featureRelative: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) return featureRelative.startsWith(pattern.slice(0, -2));
  if (pattern.endsWith("/*")) {
    const directory = pattern.slice(0, -1);
    return (
      featureRelative.startsWith(directory) &&
      !featureRelative.slice(directory.length).includes("/")
    );
  }
  return featureRelative === pattern || featureRelative.replace(/\.tsx?$/, "") === pattern;
}

/** `publicFiles` entries that match no file in the tree, or that give no reason. */
export function findInvalidPublicFiles(
  repoRoot: string,
  files: string[],
  config: FeatureBoundaryConfig = featureBoundaries,
): string[] {
  const invalid: string[] = [];
  for (const [feature, entries] of Object.entries(config.publicFiles)) {
    const prefix = `${config.featuresRoot}/${feature}/`;
    const featureFiles = files.filter((file) => file.startsWith(prefix));
    for (const [pattern, reason] of Object.entries(entries)) {
      const matched =
        featureFiles.some((file) => matchesPattern(file.slice(prefix.length), pattern)) ||
        existsSync(path.join(repoRoot, prefix, pattern));
      if (!matched) invalid.push(`${feature}/${pattern}: matches no file`);
      if (!reason.trim()) invalid.push(`${feature}/${pattern}: has no reason`);
    }
  }
  return invalid;
}

/** Iterative Tarjan strongly connected components. Returns components with more than one node. */
export function stronglyConnectedComponents(
  nodes: string[],
  adjacency: Map<string, string[]>,
): string[][] {
  const indexOf = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let nextIndex = 0;

  for (const root of nodes) {
    if (indexOf.has(root)) continue;
    const work: Array<{ node: string; neighbor: number }> = [{ node: root, neighbor: 0 }];
    indexOf.set(root, nextIndex);
    lowLink.set(root, nextIndex);
    nextIndex += 1;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const neighbors = adjacency.get(frame.node) ?? [];

      if (frame.neighbor < neighbors.length) {
        const next = neighbors[frame.neighbor];
        frame.neighbor += 1;
        if (!indexOf.has(next)) {
          indexOf.set(next, nextIndex);
          lowLink.set(next, nextIndex);
          nextIndex += 1;
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, neighbor: 0 });
        } else if (onStack.has(next)) {
          lowLink.set(frame.node, Math.min(lowLink.get(frame.node)!, indexOf.get(next)!));
        }
        continue;
      }

      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        lowLink.set(parent, Math.min(lowLink.get(parent)!, lowLink.get(frame.node)!));
      }

      if (lowLink.get(frame.node) === indexOf.get(frame.node)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        if (component.length > 1) components.push(component.sort());
      }
    }
  }

  return components;
}

export function runtimeAdjacency(graph: ImportGraph): Map<string, string[]> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.kind !== "static") continue;
    if (isTestFile(edge.from) || isTestFile(edge.to)) continue;
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
    adjacency.get(edge.from)!.add(edge.to);
  }
  return new Map([...adjacency].map(([node, targets]) => [node, [...targets].sort()]));
}

/** Module-level static import cycles whose members belong to more than one feature. */
export function findCrossFeatureCycles(
  graph: ImportGraph,
  config: FeatureBoundaryConfig = featureBoundaries,
): string[][] {
  const adjacency = runtimeAdjacency(graph);
  return stronglyConnectedComponents([...adjacency.keys()], adjacency).filter((component) => {
    const owners = new Set(component.map((file) => featureOf(file, config) ?? "(shared)"));
    return owners.size > 1;
  });
}

/**
 * The cross-feature edges inside each cross-feature cycle. Each one is a candidate for breaking the
 * cycle, and together they identify it stably for the baseline.
 */
export function findCycleEdges(
  graph: ImportGraph,
  config: FeatureBoundaryConfig = featureBoundaries,
): string[] {
  const adjacency = runtimeAdjacency(graph);
  const edges: string[] = [];
  for (const component of findCrossFeatureCycles(graph, config)) {
    const members = new Set(component);
    for (const from of component) {
      for (const to of adjacency.get(from) ?? []) {
        if (!members.has(to)) continue;
        if ((featureOf(from, config) ?? "(shared)") === (featureOf(to, config) ?? "(shared)")) {
          continue;
        }
        edges.push(`${from} -> ${to}`);
      }
    }
  }
  return [...new Set(edges)].sort();
}

/** Imports from one feature into a non-public file of another feature. */
export function findPrivateImports(
  graph: ImportGraph,
  config: FeatureBoundaryConfig = featureBoundaries,
): string[] {
  const violations = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind === "mock" || isTestFile(edge.from)) continue;
    const targetFeature = featureOf(edge.to, config);
    if (!targetFeature) continue;
    const sourceFeature = featureOf(edge.from, config);
    if (sourceFeature === targetFeature) continue;
    if (classifyTarget(edge.to, config).isPublic) continue;
    violations.add(`${edge.from} -> ${edge.to}`);
  }
  return [...violations].sort();
}

export function computeViolations(
  repoRoot: string,
  config: FeatureBoundaryConfig = featureBoundaries,
): FeatureBoundaryBaseline {
  const graph = buildImportGraph(repoRoot, config.sourceRoot);
  return {
    privateImports: findPrivateImports(graph, config),
    cycleEdges: findCycleEdges(graph, config),
  };
}

export function compareWithBaseline(
  current: FeatureBoundaryBaseline,
  baseline: FeatureBoundaryBaseline,
) {
  const diff = (left: string[], right: string[]) => {
    const rightSet = new Set(right);
    return left.filter((entry) => !rightSet.has(entry));
  };
  return {
    newPrivateImports: diff(current.privateImports, baseline.privateImports),
    stalePrivateImports: diff(baseline.privateImports, current.privateImports),
    newCycleEdges: diff(current.cycleEdges, baseline.cycleEdges),
    staleCycleEdges: diff(baseline.cycleEdges, current.cycleEdges),
  };
}

export const BASELINE_PATH = "scripts/check/feature-boundaries.baseline.json";

if (import.meta.main) {
  const repoRoot = path.resolve(import.meta.dir, "../..");
  const current = computeViolations(repoRoot);

  if (process.argv.includes("--update")) {
    writeFileSync(path.join(repoRoot, BASELINE_PATH), `${JSON.stringify(current, null, 2)}\n`);
    console.log(
      `Wrote ${BASELINE_PATH}: ${current.privateImports.length} private imports, ` +
        `${current.cycleEdges.length} cycle edges.`,
    );
  } else {
    const baseline = JSON.parse(
      readFileSync(path.join(repoRoot, BASELINE_PATH), "utf8"),
    ) as FeatureBoundaryBaseline;
    const result = compareWithBaseline(current, baseline);
    console.log(
      `Private imports: ${current.privateImports.length} (baseline ${baseline.privateImports.length})`,
    );
    console.log(
      `Cycle edges: ${current.cycleEdges.length} (baseline ${baseline.cycleEdges.length})`,
    );
    const invalidPublicFiles = findInvalidPublicFiles(
      repoRoot,
      collectSourceFiles(repoRoot, featureBoundaries.sourceRoot),
    );
    for (const [name, entries] of Object.entries({ ...result, invalidPublicFiles })) {
      if (entries.length > 0) console.log(`\n${name}:\n  ${entries.join("\n  ")}`);
    }
  }
}
