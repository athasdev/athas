import { EditorSelection, StateEffect, StateField, type Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { LspNavigationLocation } from "../../../lsp/location-navigation";
import type { DocumentLink } from "./document-links";

export interface DefinitionLinkOptions {
  /** Whether a mouse or keyboard event holds the "follow link" modifier (Cmd on macOS, else Ctrl). */
  isModifier: (event: MouseEvent | KeyboardEvent) => boolean;
  /** Definition locations for a document position, or null when no language server answers. */
  resolveDefinition:
    | ((view: EditorView, position: number) => Promise<LspNavigationLocation[] | null>)
    | null;
  /** A web address or file path under a position. `withFiles` also matches quoted file paths. */
  resolveLink: (view: EditorView, position: number, withFiles: boolean) => DocumentLink | null;
  openDefinition: (view: EditorView, position: number, locations: LspNavigationLocation[]) => void;
  openLink: (view: EditorView, link: DocumentLink) => void;
}

interface LinkRange {
  from: number;
  to: number;
}

type Target =
  | { kind: "definition"; from: number; to: number; locations: LspNavigationLocation[] }
  | { kind: "link"; from: number; to: number; link: DocumentLink };

const HOVER_DELAY_MS = 60;

export const setDefinitionLinkRange = StateEffect.define<LinkRange | null>({
  map: (value, mapping) =>
    value ? { from: mapping.mapPos(value.from), to: mapping.mapPos(value.to) } : null,
});

const linkMark = Decoration.mark({ class: "cm-athas-definition-link" });

export const definitionLinkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setDefinitionLinkRange)) continue;
      const range = effect.value;
      next =
        range && range.from < range.to
          ? Decoration.set([linkMark.range(range.from, range.to)])
          : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Cmd/Ctrl+hover underlines the symbol under the pointer when it has a definition (or a web
 * address / file path when it is a link), and Cmd/Ctrl+click follows it, as Monaco's go-to
 * definition link did.
 */
export function definitionLink(options: DefinitionLinkOptions) {
  const plugin = ViewPlugin.fromClass(
    class {
      pointer: { x: number; y: number } | null = null;
      modifierDown = false;
      timer: ReturnType<typeof setTimeout> | null = null;
      request = 0;
      shown: LinkRange | null = null;
      resolved: { doc: Text; from: number; to: number; target: Target | null } | null = null;

      constructor(readonly view: EditorView) {
        window.addEventListener("keydown", this.onKey, true);
        window.addEventListener("keyup", this.onKey, true);
        window.addEventListener("blur", this.onBlur);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) this.resolved = null;
      }

      destroy() {
        window.removeEventListener("keydown", this.onKey, true);
        window.removeEventListener("keyup", this.onKey, true);
        window.removeEventListener("blur", this.onBlur);
        if (this.timer) clearTimeout(this.timer);
      }

      onKey = (event: KeyboardEvent) => {
        const down = options.isModifier(event);
        if (down === this.modifierDown) return;
        this.modifierDown = down;
        if (down) this.schedule();
        else this.clear();
      };

      onBlur = () => {
        this.modifierDown = false;
        this.clear();
      };

      onMouseMove(event: MouseEvent) {
        this.pointer = { x: event.clientX, y: event.clientY };
        this.modifierDown = options.isModifier(event);
        if (this.modifierDown) this.schedule();
        else this.clear();
      }

      onMouseLeave() {
        this.pointer = null;
        this.clear();
      }

      schedule() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.check();
        }, HOVER_DELAY_MS);
      }

      positionAtPointer() {
        return this.pointer ? this.view.posAtCoords(this.pointer) : null;
      }

      async check() {
        const position = this.positionAtPointer();
        if (position === null || !this.modifierDown) {
          this.clear();
          return;
        }
        const target = await this.resolve(position);
        if (!this.modifierDown || this.positionAtPointer() !== position) return;
        this.show(target ? { from: target.from, to: target.to } : null);
      }

      /** What a click at `position` follows, cached for the word so hover and click agree. */
      async resolve(position: number): Promise<Target | null> {
        const { state } = this.view;
        const url = options.resolveLink(this.view, position, false);
        if (url) return { kind: "link", from: url.from, to: url.to, link: url };

        const word = state.wordAt(position);
        const cached = this.resolved;
        if (
          cached &&
          cached.doc === state.doc &&
          position >= cached.from &&
          position <= cached.to
        ) {
          return cached.target;
        }

        const request = ++this.request;
        let target: Target | null = null;
        if (word && options.resolveDefinition) {
          const locations = await options.resolveDefinition(this.view, position);
          if (request !== this.request || this.view.state.doc !== state.doc) return null;
          if (locations && locations.length > 0) {
            target = { kind: "definition", from: word.from, to: word.to, locations };
          }
        }
        if (!target) {
          const file = options.resolveLink(this.view, position, true);
          if (file) target = { kind: "link", from: file.from, to: file.to, link: file };
        }
        const from = target?.from ?? word?.from ?? position;
        const to = target?.to ?? word?.to ?? position;
        this.resolved = { doc: state.doc, from, to, target };
        return target;
      }

      show(range: LinkRange | null) {
        if (this.shown?.from === range?.from && this.shown?.to === range?.to) return;
        this.shown = range;
        this.view.dispatch({ effects: setDefinitionLinkRange.of(range) });
      }

      clear() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.request++;
        this.show(null);
      }

      async follow(position: number) {
        this.clear();
        const target = await this.resolve(position);
        if (!target) return;
        if (target.kind === "link") options.openLink(this.view, target.link);
        else options.openDefinition(this.view, position, target.locations);
      }
    },
    {
      eventHandlers: {
        mousemove(event) {
          this.onMouseMove(event);
        },
        mouseleave() {
          this.onMouseLeave();
        },
        mousedown(event, view) {
          if (event.button !== 0 || !options.isModifier(event)) return false;
          const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (position === null) return false;
          const hasWord = Boolean(view.state.wordAt(position)) && options.resolveDefinition;
          if (!hasWord && !options.resolveLink(view, position, true)) return false;
          event.preventDefault();
          view.dispatch({ selection: EditorSelection.cursor(position) });
          void this.follow(position);
          return true;
        },
      },
    },
  );

  return [definitionLinkField, plugin];
}
