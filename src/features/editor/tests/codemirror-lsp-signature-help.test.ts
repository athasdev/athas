// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: { isLspSupported: () => true },
}));
vi.mock("@/features/editor/lsp/lsp-client", () => ({ LspClient: { getInstance: () => ({}) } }));
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ settings: { parameterHints: true } }),
}));
vi.mock("@/features/editor/markdown/code-highlight", () => ({
  highlightMarkdownCodeBlocks: async (html: string) => html,
}));

const { renderSignatureHelp, signatureHelpExtension, splitSignatureLabel } =
  await import("../engines/codemirror/features/lsp-signature-help");

const help = {
  signatures: [
    {
      label: "add(a: number, b: number): number",
      documentation: "Adds numbers.",
      parameters: [
        { label: [4, 13] as [number, number] },
        { label: "b: number", documentation: { kind: "markdown", value: "The **second**." } },
      ],
    },
    { label: "add(a: string): string", parameters: [{ label: "a: string" }] },
  ],
  activeSignature: 0,
  activeParameter: 1,
};

const client = {
  getSignatureHelp: vi.fn(),
  getSignatureTriggerCharacters: vi.fn(async () => ["(", ","]),
};

let view: EditorView | null = null;

function typeText(editor: EditorView, text: string) {
  const at = editor.state.selection.main.head;
  editor.dispatch({
    changes: { from: at, insert: text },
    selection: { anchor: at + text.length },
    userEvent: "input.type",
  });
}

beforeEach(() => {
  client.getSignatureHelp.mockReset();
});

afterEach(() => {
  view?.destroy();
  view = null;
});

describe("CodeMirror signature help", () => {
  it("splits labels around offset and string parameters", () => {
    const [signature] = help.signatures;
    expect(splitSignatureLabel(signature.label, signature.parameters, 0)).toEqual([
      "add(",
      "a: number",
      ", b: number): number",
    ]);
    expect(splitSignatureLabel(signature.label, signature.parameters, 1)[1]).toBe("b: number");
    expect(splitSignatureLabel(signature.label, signature.parameters, 5)).toEqual([
      signature.label,
      "",
      "",
    ]);
  });

  it("renders the active parameter, the signature count and the docs", () => {
    const element = renderSignatureHelp(help, 0);
    expect(element.querySelector(".cm-athas-signatureActiveParameter")?.textContent).toBe(
      "b: number",
    );
    expect(element.querySelector(".cm-athas-signatureCount")?.textContent).toBe("1/2");
    const docs = element.querySelectorAll(".cm-athas-signatureDocs");
    expect(docs[0].querySelector("strong")?.textContent).toBe("second");
    expect(docs[1].textContent).toBe("Adds numbers.");
  });

  it("opens on a trigger character, cycles signatures and closes on Escape", async () => {
    client.getSignatureHelp.mockResolvedValue(help);
    view = new EditorView({
      state: EditorState.create({
        doc: "add",
        selection: { anchor: 3 },
        extensions: signatureHelpExtension("/repo/a.ts", client, true),
      }),
      parent: document.body,
    });

    typeText(view, "(");
    await vi.waitFor(() =>
      expect(view!.dom.querySelector(".cm-athas-signatureHelp")).not.toBeNull(),
    );
    expect(client.getSignatureHelp).toHaveBeenCalledWith("/repo/a.ts", 0, 4);

    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(view.dom.querySelector(".cm-athas-signatureCount")?.textContent).toBe("2/2");

    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(view.dom.querySelector(".cm-athas-signatureHelp")).toBeNull();
  });

  it("closes once the server has no signature for the cursor", async () => {
    client.getSignatureHelp.mockResolvedValueOnce(help).mockResolvedValue(null);
    view = new EditorView({
      state: EditorState.create({
        doc: "add",
        selection: { anchor: 3 },
        extensions: signatureHelpExtension("/repo/a.ts", client, true),
      }),
      parent: document.body,
    });
    typeText(view, "(");
    await vi.waitFor(() =>
      expect(view!.dom.querySelector(".cm-athas-signatureHelp")).not.toBeNull(),
    );
    typeText(view, ")");
    await vi.waitFor(() => expect(view!.dom.querySelector(".cm-athas-signatureHelp")).toBeNull());
  });

  it("opens from the trigger signature help command", async () => {
    client.getSignatureHelp.mockResolvedValue(help);
    view = new EditorView({
      state: EditorState.create({
        doc: "add(1, ",
        extensions: signatureHelpExtension("/repo/a.ts", client, true),
      }),
      parent: document.body,
    });
    window.dispatchEvent(new CustomEvent("editor-trigger-signature-help"));
    await vi.waitFor(() =>
      expect(view!.dom.querySelector(".cm-athas-signatureHelp")).not.toBeNull(),
    );
  });
});
