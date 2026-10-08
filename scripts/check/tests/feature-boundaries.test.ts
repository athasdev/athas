import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  BASELINE_PATH,
  buildImportGraph,
  classifyTarget,
  compareWithBaseline,
  findCycleEdges,
  findInvalidLayers,
  findInvalidPublicFiles,
  findPrivateImports,
  findUpwardImports,
  layerOf,
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
    upwardImports: findUpwardImports(graph),
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

  it("adds no imports from a lower feature tier into a higher one", () => {
    expect(result.newUpwardImports, HOW_TO_FIX).toEqual([]);
  });

  it("lists only existing public files, each with a reason", () => {
    expect(findInvalidPublicFiles(repoRoot, graph.files)).toEqual([]);
  });

  it("puts every feature in one tier and gives every tier override a reason", () => {
    expect(findInvalidLayers(graph.files)).toEqual([]);
  });

  it("keeps the baseline in sync so it only shrinks", () => {
    expect(result.stalePrivateImports, HOW_TO_SHRINK).toEqual([]);
    expect(result.staleCycleEdges, HOW_TO_SHRINK).toEqual([]);
    expect(result.staleUpwardImports, HOW_TO_SHRINK).toEqual([]);
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

  const layered: FeatureBoundaryConfig = {
    ...featureBoundaries,
    layers: {
      order: ["foundation", "core", "features", "shell"],
      tiers: { foundation: ["base"], core: ["core"], features: ["extra"], shell: ["app"] },
      tierOverrides: {
        "core/commands/**": { tier: "shell", reason: "Command wiring." },
        "core/commands/core-command.ts": { tier: "core", reason: "Plain core command." },
      },
    },
  };

  it("places files by feature tier and the most specific tier override", () => {
    const position = (file: string) => layerOf(`src/features/${file}`, layered);

    expect(position("base/services/a.ts")).toEqual({ tier: "foundation", rank: 0, module: "base" });
    expect(position("extra/components/view.tsx")).toMatchObject({ tier: "features", rank: 2 });
    expect(position("core/commands/run.ts")).toEqual({
      tier: "shell",
      rank: 3,
      module: "core/commands",
    });
    expect(position("core/commands/core-command.ts")).toEqual({
      tier: "core",
      rank: 1,
      module: "core/commands/core-command.ts",
    });
    expect(layerOf("src/utils/cn.ts", layered)).toBeNull();
  });

  it("counts upward imports per module pair as distinct file pairs", () => {
    const fixture: ImportGraph = {
      files: [],
      edges: [
        { from: "src/features/base/a.ts", to: "src/features/core/b.ts", kind: "static" },
        { from: "src/features/base/a.ts", to: "src/features/core/b.ts", kind: "dynamic" },
        { from: "src/features/base/a.ts", to: "src/features/core/c.ts", kind: "type" },
        { from: "src/features/core/b.ts", to: "src/features/extra/x.ts", kind: "dynamic" },
        { from: "src/features/core/b.ts", to: "src/features/core/commands/run.ts", kind: "static" },
        {
          from: "src/features/extra/x.ts",
          to: "src/features/core/commands/run.ts",
          kind: "static",
        },
        { from: "src/features/app/shell.ts", to: "src/features/extra/x.ts", kind: "static" },
        { from: "src/features/extra/x.ts", to: "src/features/base/a.ts", kind: "static" },
        {
          from: "src/features/base/tests/a.test.ts",
          to: "src/features/app/shell.ts",
          kind: "static",
        },
        { from: "src/features/base/a.ts", to: "src/features/app/shell.ts", kind: "mock" },
        { from: "src/utils/shared.ts", to: "src/features/app/shell.ts", kind: "static" },
      ],
    };

    expect(findUpwardImports(fixture, layered)).toEqual({
      "base -> core": 2,
      "core -> extra": 1,
      "extra -> core/commands": 1,
    });
  });

  it("reports features without a tier and overrides that match nothing", () => {
    const config: FeatureBoundaryConfig = {
      ...layered,
      layers: {
        ...layered.layers,
        tiers: { ...layered.layers.tiers, shell: ["app", "base"] },
        tierOverrides: { "core/gone/**": { tier: "shell", reason: " " } },
      },
    };
    const files = [
      "src/features/base/a.ts",
      "src/features/core/b.ts",
      "src/features/extra/x.ts",
      "src/features/new/y.ts",
    ];

    expect(findInvalidLayers(files, config)).toEqual([
      "new: has no tier",
      "base: is listed in foundation, shell",
      "app: is not a feature",
      "core/gone/**: tier override matches no file",
      "core/gone/**: tier override has no reason",
    ]);
  });

  it("ratchets upward import counts in both directions", () => {
    const current: FeatureBoundaryBaseline = {
      privateImports: [],
      cycleEdges: [],
      upwardImports: { "a -> b": 3, "a -> c": 1, "d -> e": 2 },
    };
    const baseline: FeatureBoundaryBaseline = {
      privateImports: [],
      cycleEdges: [],
      upwardImports: { "a -> b": 2, "d -> e": 4, "f -> g": 1 },
    };

    expect(compareWithBaseline(current, baseline)).toMatchObject({
      newUpwardImports: ["a -> b: 3 (baseline 2)", "a -> c: 1 (baseline 0)"],
      staleUpwardImports: ["d -> e: 2 (baseline 4)", "f -> g: 0 (baseline 1)"],
    });
  });
});
