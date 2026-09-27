import { editor as monacoEditor } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { ITextModelService } from "monaco-editor/esm/vs/editor/common/services/resolverService.js";
import { StandaloneServices } from "monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js";
import { filePathFromMonacoUri } from "./editor-opener";

export interface TextModelReference {
  object: { textEditorModel: Monaco.editor.ITextModel | null };
  dispose: () => void;
}

interface TextModelService {
  createModelReference: (resource: Monaco.Uri) => Promise<TextModelReference>;
}

interface FileBackedModelResolverDeps {
  getModel: (resource: Monaco.Uri) => Monaco.editor.ITextModel | null;
  getModels: () => Monaco.editor.ITextModel[];
  createModel: (content: string, resource: Monaco.Uri) => Monaco.editor.ITextModel;
  readFile: (filePath: string) => Promise<string>;
  filePathFromUri: (resource: Monaco.Uri) => string | null;
}

interface TransientModel {
  model: Promise<Monaco.editor.ITextModel>;
  /** The loaded model, so the last release disposes it before anyone else can pick it up. */
  resolved?: Monaco.editor.ITextModel;
  references: number;
}

function reference(
  model: Monaco.editor.ITextModel,
  dispose: () => void = () => {},
): TextModelReference {
  let disposed = false;
  return {
    object: { textEditorModel: model },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      dispose();
    },
  };
}

/**
 * Editor buffers live under `athas://` URIs, but LSP locations point at `file://`
 * URIs. Monaco's standalone text model service only knows models by their exact
 * URI, so the go-to-definition hover, the references peek and similar features
 * rejected with "Model not found". This resolver maps a location onto the open
 * buffer's model, or loads the file from disk into a model that lives only while
 * something holds a reference to it.
 */
export function createFileBackedModelResolver(deps: FileBackedModelResolverDeps) {
  const transientModels = new Map<string, TransientModel>();

  const findOpenModel = (filePath: string) =>
    deps
      .getModels()
      .find((model) => !model.isDisposed() && deps.filePathFromUri(model.uri) === filePath) ?? null;

  const releaseTransient = (key: string, entry: TransientModel) => {
    entry.references -= 1;
    if (entry.references > 0 || transientModels.get(key) !== entry) return;
    transientModels.delete(key);
    if (entry.resolved && !entry.resolved.isDisposed()) entry.resolved.dispose();
  };

  return async function createModelReference(resource: Monaco.Uri): Promise<TextModelReference> {
    const key = resource.toString();
    // A model this resolver loaded is shared by counting, never handed out uncounted.
    let entry = transientModels.get(key);
    if (!entry) {
      const existing = deps.getModel(resource);
      if (existing) return reference(existing);

      const filePath = deps.filePathFromUri(resource);
      if (!filePath) throw new Error("Model not found");

      const openModel = findOpenModel(filePath);
      if (openModel) return reference(openModel);

      const pending: TransientModel = {
        references: 0,
        model: deps
          .readFile(filePath)
          .then((content) => deps.getModel(resource) ?? deps.createModel(content, resource)),
      };
      void pending.model.then(
        (model) => {
          pending.resolved = model;
        },
        () => undefined,
      );
      pending.model.catch(() => {
        if (transientModels.get(key) === pending) transientModels.delete(key);
      });
      transientModels.set(key, pending);
      entry = pending;
    }

    const current = entry;
    current.references += 1;
    try {
      const model = await current.model;
      return reference(model, () => releaseTransient(key, current));
    } catch (error) {
      current.references -= 1;
      throw error;
    }
  };
}

let installed = false;

export function installFileBackedTextModelService() {
  if (installed) return;
  installed = true;

  const service = StandaloneServices.get(ITextModelService) as TextModelService;
  const resolve = createFileBackedModelResolver({
    getModel: (resource) => monacoEditor.getModel(resource),
    getModels: () => monacoEditor.getModels(),
    createModel: (content, resource) => monacoEditor.createModel(content, undefined, resource),
    readFile: async (filePath) => {
      const { readFile } = await import("@/features/file-system/controllers/platform");
      return readFile(filePath);
    },
    filePathFromUri: filePathFromMonacoUri,
  });
  service.createModelReference = resolve;
}
