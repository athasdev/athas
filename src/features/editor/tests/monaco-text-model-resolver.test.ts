import { describe, expect, it, vi } from "vite-plus/test";
import type * as Monaco from "monaco-editor";

vi.mock("monaco-editor", () => ({ editor: {} }));
vi.mock("monaco-editor/esm/vs/editor/common/services/resolverService.js", () => ({
  ITextModelService: {},
}));
vi.mock("monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js", () => ({
  StandaloneServices: { get: vi.fn() },
}));
vi.mock("../engines/monaco/editor-opener", () => ({ filePathFromMonacoUri: vi.fn() }));

import { createFileBackedModelResolver } from "../engines/monaco/text-model-resolver";

function uri(value: string) {
  return { toString: () => value, path: value.replace(/^[a-z]+:\/\/[^/]*/, "") } as Monaco.Uri;
}

function textModel(value: string) {
  let disposed = false;
  return {
    uri: uri(value),
    isDisposed: () => disposed,
    dispose: vi.fn(() => {
      disposed = true;
    }),
  } as unknown as Monaco.editor.ITextModel & { dispose: ReturnType<typeof vi.fn> };
}

function setup(models: Monaco.editor.ITextModel[] = []) {
  const created: Monaco.editor.ITextModel[] = [];
  const readFile = vi.fn(async (filePath: string) => `contents of ${filePath}`);
  const resolve = createFileBackedModelResolver({
    getModel: (resource) =>
      [...models, ...created].find(
        (model) => !model.isDisposed() && model.uri.toString() === resource.toString(),
      ) ?? null,
    getModels: () => [...models, ...created],
    createModel: (_content, resource) => {
      const model = textModel(resource.toString());
      created.push(model);
      return model;
    },
    readFile,
    filePathFromUri: (resource) => resource.path,
  });
  return { resolve, readFile, created };
}

describe("file-backed Monaco text model resolver", () => {
  it("resolves a file location to the open buffer's model", async () => {
    const open = textModel("athas://editor/project/a.ts");
    const { resolve, readFile } = setup([open]);

    const reference = await resolve(uri("file:///project/a.ts"));

    expect(reference.object.textEditorModel).toBe(open);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("loads unopened files into a model that lives while it is referenced", async () => {
    const { resolve, readFile, created } = setup();

    const first = await resolve(uri("file:///project/b.ts"));
    const second = await resolve(uri("file:///project/b.ts"));

    expect(readFile).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(second.object.textEditorModel).toBe(first.object.textEditorModel);

    first.dispose();
    first.dispose();
    await Promise.resolve();
    expect(created[0].isDisposed()).toBe(false);
    second.dispose();
    expect(created[0].isDisposed()).toBe(true);
  });

  it("counts a holder that asks after the model finished loading", async () => {
    const { resolve, created } = setup();

    const first = await resolve(uri("file:///project/b.ts"));
    // Monaco now finds the loaded model by its URI; it must still be counted.
    const second = await resolve(uri("file:///project/b.ts"));
    const third = await resolve(uri("file:///project/b.ts"));

    first.dispose();
    second.dispose();
    await Promise.resolve();
    expect(created[0].isDisposed()).toBe(false);
    expect(third.object.textEditorModel).toBe(created[0]);
    third.dispose();
    expect(created[0].isDisposed()).toBe(true);
  });

  it("rejects when the file cannot be read and retries on the next request", async () => {
    const { resolve, readFile } = setup();
    readFile.mockRejectedValueOnce(new Error("missing"));

    await expect(resolve(uri("file:///project/c.ts"))).rejects.toThrow("missing");
    await expect(resolve(uri("file:///project/c.ts"))).resolves.toBeTruthy();
    expect(readFile).toHaveBeenCalledTimes(2);
  });
});
