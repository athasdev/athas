import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { getModel, createModel } = vi.hoisted(() => ({
  getModel: vi.fn(),
  createModel: vi.fn(),
}));

vi.mock("monaco-editor", () => ({
  editor: {
    getModel,
    createModel,
  },
}));

import { acquireMonacoModel } from "../engines/monaco/model-lifecycle";

function createTextModel() {
  let disposed = false;
  return {
    dispose: vi.fn(() => {
      disposed = true;
    }),
    isDisposed: vi.fn(() => disposed),
  };
}

const uri = {
  toString: () => "athas://editor/src/file.ts?buffer=buffer-a",
};

describe("Monaco model lifecycle", () => {
  beforeEach(() => {
    getModel.mockReset();
    createModel.mockReset();
  });

  it("shares one model between split editor surfaces", () => {
    const model = createTextModel();
    getModel.mockReturnValue(null);
    createModel.mockReturnValue(model);

    const first = acquireMonacoModel("const value = 1;", "typescript", uri as never);
    const second = acquireMonacoModel("const value = 1;", "typescript", uri as never);

    expect(first.model).toBe(model);
    expect(second.model).toBe(model);
    expect(createModel).toHaveBeenCalledTimes(1);

    first.release();
    expect(model.dispose).not.toHaveBeenCalled();

    second.release();
    expect(model.dispose).toHaveBeenCalledTimes(1);
  });

  it("adopts an existing model instead of registering the URI again", () => {
    const model = createTextModel();
    getModel.mockReturnValue(model);

    const acquired = acquireMonacoModel("const value = 1;", "typescript", uri as never);

    expect(acquired.model).toBe(model);
    expect(createModel).not.toHaveBeenCalled();

    acquired.release();
    acquired.release();
    expect(model.dispose).toHaveBeenCalledTimes(1);
  });
});
