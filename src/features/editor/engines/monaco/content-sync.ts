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
