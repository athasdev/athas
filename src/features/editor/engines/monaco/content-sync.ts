const externalModelUpdateDepth = new WeakMap<object, number>();

export function runWithExternalModelUpdate<T>(model: object, update: () => T): T {
  externalModelUpdateDepth.set(model, (externalModelUpdateDepth.get(model) ?? 0) + 1);
  try {
    return update();
  } finally {
    const nextDepth = (externalModelUpdateDepth.get(model) ?? 1) - 1;
    if (nextDepth === 0) externalModelUpdateDepth.delete(model);
    else externalModelUpdateDepth.set(model, nextDepth);
  }
}

export function isExternalModelUpdate(model: object): boolean {
  return (externalModelUpdateDepth.get(model) ?? 0) > 0;
}

interface ModelTextSource {
  getValueLength: () => number;
  getValue: () => string;
}

/**
 * Whether the model holds exactly `content`. Monaco drops a leading BOM and rewrites lone CR and
 * mixed line endings when it builds a model, so a buffer read from disk can differ from the model
 * that shows it. Offsets in Monaco change events only line up with the buffer while they match.
 */
export function modelMatchesContent(model: ModelTextSource, content: string): boolean {
  return model.getValueLength() === content.length && model.getValue() === content;
}
