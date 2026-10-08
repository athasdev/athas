import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  BASELINE_PATH,
  buildImportGraph,
  classifyTarget,
  compareWithBaseline,
  findCycleEdges,
  findInvalidPublicFiles,
  findPrivateImports,
  parseImports,
  stronglyConnectedComponents,
  type ImportGraph,
} from "../feature-boundaries";
import {
  featureBoundaries,
  type FeatureBoundaryBaseline,
  type FeatureBoundaryConfig,
} from "../feature-boundaries.config";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const graph = buildImportGraph(repoRoot, featureBoundaries.sourceRoot);
const baseline = JSON.parse(
  readFileSync(path.join(repoRoot, BASELINE_PATH), "utf8"),
) as FeatureBoundaryBaseline;
const result = compareWithBaseline(
  {
    privateImports: findPrivateImports(graph),
    cycleEdges: findCycleEdges(graph),
  },
  baseline,
);

const HOW_TO_FIX =
  "See the header of scripts/check/feature-boundaries.config.ts for the rule and how to fix it.";
const HOW_TO_SHRINK =
  "These baseline entries no longer occur. Run `bun scripts/check/feature-boundaries.ts --update`.";

describe("feature boundaries", () => {
  it("scans the source tree", () => {
    expect(graph.files.length).toBeGreaterThan(2000);
    expect(graph.edges.length).toBeGreaterThan(10_000);
  });

  it("adds no imports into another feature's private files", () => {
    expect(result.newPrivateImports, HOW_TO_FIX).toEqual([]);
  });

  it("adds no module-level import cycles across features", () => {
    expect(result.newCycleEdges, HOW_TO_FIX).toEqual([]);
  });

  it("lists only existing public files, each with a reason", () => {
    expect(findInvalidPublicFiles(repoRoot, graph.files)).toEqual([]);
  });

  it("keeps the baseline in sync so it only shrinks", () => {
    expect(result.stalePrivateImports, HOW_TO_SHRINK).toEqual([]);
    expect(result.staleCycleEdges, HOW_TO_SHRINK).toEqual([]);
  });
});

describe("feature boundary analysis", () => {
  it("parses static, type-only, dynamic, side-effect and mock imports", () => {
    const source = [
      'import { a } from "@/features/x/stores/a.store";',
      'import type { B } from "./b";',
      'import { type C, type D } from "../c";',
      'import E, { type F } from "./e";',
      'export { g } from "./g";',
      'export type { H } from "./h";',
      'export * from "./star";',
      'import "./side-effect.css";',
      'const lazy = await import("./lazy");',
      'type Lazy = typeof import("./typed");',
      'type Inline = import("./inline").Value;',
      'import("./then").then((module) => module);',
      'vi.mock("@/features/y/hooks/use-y");',
      '// import { z } from "./commented";',
      '/* import { z } from "./block-commented"; */',
      "const text = \"import { nope } from './string'\";",
    ].join("\n");

    expect(parseImports(source)).toEqual([
      { specifier: "@/features/x/stores/a.store", kind: "static" },
      { specifier: "./b", kind: "type" },
      { specifier: "../c", kind: "type" },
      { specifier: "./e", kind: "static" },
      { specifier: "./g", kind: "static" },
      { specifier: "./h", kind: "type" },
      { specifier: "./star", kind: "static" },
      { specifier: "./side-effect.css", kind: "static" },
      { specifier: "./lazy", kind: "dynamic" },
      { specifier: "./typed", kind: "type" },
      { specifier: "./inline", kind: "type" },
      { specifier: "./then", kind: "dynamic" },
      { specifier: "@/features/y/hooks/use-y", kind: "mock" },
    ]);
  });

  it("classifies feature files by folder and listed public files", () => {
    const config: FeatureBoundaryConfig = {
      ...featureBoundaries,
      publicFiles: {
        demo: { "components/shared-view.tsx": "Shared view.", "runtime/registry.ts": "Registry." },
      },
    };
    const isPublic = (file: string) => classifyTarget(`src/features/${file}`, config).isPublic;

    expect(isPublic("demo/hooks/use-demo.ts")).toBe(true);
    expect(isPublic("demo/api/demo-api.ts")).toBe(true);
    expect(isPublic("demo/types/demo.types.ts")).toBe(true);
    expect(isPublic("demo/stores/demo.store.ts")).toBe(true);
    expect(isPublic("demo/stores/demo-selectors.ts")).toBe(true);
    expect(isPublic("demo/stores/state/types/state.types.ts")).toBe(true);
    expect(isPublic("demo/sub/services/sub-service.ts")).toBe(true);
    expect(isPublic("demo/components/shared-view.tsx")).toBe(true);
    expect(isPublic("demo/runtime/registry.ts")).toBe(true);

    expect(isPublic("demo/stores/demo-slice.ts")).toBe(false);
    expect(isPublic("demo/components/demo-panel.tsx")).toBe(false);
    expect(isPublic("demo/utils/format.ts")).toBe(false);
    expect(isPublic("demo/lib/parser.ts")).toBe(false);
    expect(isPublic("demo/controllers/io.ts")).toBe(false);
    expect(isPublic("demo/hooks/internal/use-private.ts")).toBe(false);
    expect(isPublic("demo/sub/utils/helpers.ts")).toBe(false);
    expect(isPublic("demo/sub/root-file.ts")).toBe(false);
    expect(classifyTarget("src/utils/cn.ts", config).isPublic).toBe(true);
  });

  it("reports public files that match nothing or give no reason", () => {
    const config: FeatureBoundaryConfig = {
      ...featureBoundaries,
      publicFiles: {
        demo: {
          "components/view.tsx": "Shared view.",
          "components/gone.tsx": "Gone.",
          "lib/*": "",
        },
      },
    };
    const files = ["src/features/demo/components/view.tsx", "src/features/demo/lib/parser.ts"];

    expect(findInvalidPublicFiles("/nonexistent", files, config)).toEqual([
      "demo/components/gone.tsx: matches no file",
      "demo/lib/*: has no reason",
    ]);
  });

  it("reports private imports from other features only", () => {
    const fixture: ImportGraph = {
      files: [],
      edges: [
        { from: "src/features/a/x.ts", to: "src/features/b/utils/u.ts", kind: "static" },
        { from: "src/features/a/x.ts", to: "src/features/b/hooks/h.ts", kind: "static" },
        { from: "src/features/b/x.ts", to: "src/features/b/utils/u.ts", kind: "static" },
        { from: "src/features/a/tests/x.test.ts", to: "src/features/b/lib/l.ts", kind: "static" },
        { from: "src/features/a/x.ts", to: "src/features/b/lib/l.ts", kind: "mock" },
        { from: "src/utils/shared.ts", to: "src/features/b/lib/l.ts", kind: "type" },
      ],
    };

    expect(findPrivateImports(fixture, featureBoundaries)).toEqual([
      "src/features/a/x.ts -> src/features/b/utils/u.ts",
      "src/utils/shared.ts -> src/features/b/lib/l.ts",
    ]);
  });

  it("finds strongly connected components", () => {
    const adjacency = new Map([
      ["a", ["b"]],
      ["b", ["c"]],
      ["c", ["a", "d"]],
      ["d", ["e"]],
      ["e", ["d"]],
      ["f", ["a"]],
    ]);

    expect(
      stronglyConnectedComponents(["a", "b", "c", "d", "e", "f"], adjacency).sort((left, right) =>
        left[0].localeCompare(right[0]),
      ),
    ).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
  });

  it("reports cross-feature edges of value-import cycles only", () => {
    const fixture: ImportGraph = {
      files: [],
      edges: [
        { from: "src/features/a/one.ts", to: "src/features/b/two.ts", kind: "static" },
        { from: "src/features/b/two.ts", to: "src/features/b/three.ts", kind: "static" },
        { from: "src/features/b/three.ts", to: "src/features/a/one.ts", kind: "static" },
        { from: "src/features/c/one.ts", to: "src/features/d/two.ts", kind: "static" },
        { from: "src/features/d/two.ts", to: "src/features/c/one.ts", kind: "type" },
        { from: "src/features/e/one.ts", to: "src/features/f/two.ts", kind: "static" },
        { from: "src/features/f/two.ts", to: "src/features/e/one.ts", kind: "dynamic" },
        { from: "src/features/g/one.ts", to: "src/features/g/two.ts", kind: "static" },
        { from: "src/features/g/two.ts", to: "src/features/g/one.ts", kind: "static" },
      ],
    };

    expect(findCycleEdges(fixture, featureBoundaries)).toEqual([
      "src/features/a/one.ts -> src/features/b/two.ts",
      "src/features/b/three.ts -> src/features/a/one.ts",
    ]);
  });
});
