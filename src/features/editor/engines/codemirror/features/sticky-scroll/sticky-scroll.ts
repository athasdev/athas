import { highlightingFor, syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { highlightTree } from "@lezer/highlight";
import { enclosingScopes, type StickyScope } from "./sticky-scopes";

export interface StickyScrollOptions {
  /** The most header lines pinned at once. */
  maxLines?: number;
}

/** A pinned header and how far it is pushed up by the end of its scope. */
interface StickyRow {
  line: number;
  offset: number;
}

interface StickyLayout {
  rows: StickyRow[];
  lineHeight: number;
  top: number;
  left: number;
  width: number;
  gutterWidth: number;
  textLeft: number;
  showLineNumbers: boolean;
  font: { family: string; size: string; ligatures: string };
}

/** Longest stretch of a header line that is rendered; the rest is clipped anyway. */
const MAX_RENDERED_CHARS = 400;

/**
 * Which headers to pin for the current scroll position. Like VS Code, it looks at the line just
 * under the pinned rows, so a header that scrolls under the stack is pinned too, and lets the end
 * of a scope push its header up instead of popping it away.
 */
export function computeStickyRows(
  state: EditorState,
  visibleTop: number,
  lineHeight: number,
  maxLines: number,
  lineAtHeight: (height: number) => { from: number },
  bottomOfPosition: (pos: number) => number,
): StickyRow[] {
  const { doc } = state;
  let stack: StickyScope[] = [];
  for (let iteration = 0; iteration <= maxLines; iteration++) {
    const probe = doc.lineAt(lineAtHeight(visibleTop + stack.length * lineHeight).from);
    const next = enclosingScopes(state, probe.number).slice(0, maxLines);
    const extendsStack =
      next.length >= stack.length && stack.every((scope, index) => next[index].line === scope.line);
    if (!extendsStack || next.length === stack.length) break;
    stack = next;
  }

  const rows: StickyRow[] = [];
  let offset = 0;
  for (const [index, scope] of stack.entries()) {
    const endBottom = bottomOfPosition(scope.end);
    if (endBottom <= visibleTop + index * lineHeight) break;
    offset = Math.min(offset, endBottom - (visibleTop + (index + 1) * lineHeight));
    rows.push({ line: scope.line, offset });
  }
  return rows;
}

const stickyTheme = EditorView.baseTheme({
  ".cm-athas-sticky": {
    position: "absolute",
    zIndex: "3",
    overflow: "hidden",
    pointerEvents: "none",
    backgroundColor: "var(--background)",
    boxShadow: "0 1px 0 var(--border)",
  },
  ".cm-athas-sticky-row": {
    position: "absolute",
    left: "0",
    right: "0",
    overflow: "hidden",
    cursor: "pointer",
    pointerEvents: "auto",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
  ".cm-athas-sticky-row:hover, .cm-athas-sticky-row:hover .cm-athas-sticky-gutter": {
    backgroundColor: "var(--selected)",
  },
  ".cm-athas-sticky-text": {
    position: "absolute",
    top: "0",
    whiteSpace: "pre",
  },
  ".cm-athas-sticky-gutter": {
    position: "absolute",
    top: "0",
    left: "0",
    boxSizing: "border-box",
    paddingRight: "12px",
    textAlign: "right",
    color: "var(--subtle-foreground)",
    backgroundColor: "var(--background)",
  },
});

function sameLayout(a: StickyLayout | null, b: StickyLayout) {
  if (!a || a.rows.length !== b.rows.length) return false;
  return (
    a.rows.every(
      (row, index) => row.line === b.rows[index].line && row.offset === b.rows[index].offset,
    ) &&
    a.lineHeight === b.lineHeight &&
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.gutterWidth === b.gutterWidth &&
    a.textLeft === b.textLeft &&
    a.showLineNumbers === b.showLineNumbers &&
    a.font.family === b.font.family &&
    a.font.size === b.font.size &&
    a.font.ligatures === b.font.ligatures
  );
}

/** The line's text as highlighted spans, using the editor's own highlight classes. */
function renderLineText(state: EditorState, lineNumber: number, target: HTMLElement) {
  const line = state.doc.line(lineNumber);
  const to = Math.min(line.to, line.from + MAX_RENDERED_CHARS);
  const text = state.sliceDoc(line.from, to);
  target.textContent = "";
  let position = line.from;
  const append = (from: number, end: number, className: string | null) => {
    if (end <= from) return;
    const chunk = text.slice(from - line.from, end - line.from);
    if (className) {
      const span = document.createElement("span");
      span.className = className;
      span.textContent = chunk;
      target.appendChild(span);
    } else {
      target.appendChild(document.createTextNode(chunk));
    }
  };
  highlightTree(
    syntaxTree(state),
    { style: (tags) => highlightingFor(state, tags) },
    (from, end, className) => {
      append(position, from, null);
      append(Math.max(from, line.from), Math.min(end, to), className);
      position = Math.max(position, Math.min(end, to));
    },
    line.from,
    to,
  );
  append(position, to, null);
}

const stickyPlugin = (maxLines: number) =>
  ViewPlugin.fromClass(
    class {
      dom: HTMLElement;
      layout: StickyLayout | null = null;
      height = 0;

      constructor(readonly view: EditorView) {
        this.dom = document.createElement("div");
        this.dom.className = "cm-athas-sticky";
        this.dom.setAttribute("aria-hidden", "true");
        this.dom.style.display = "none";
        this.dom.addEventListener("mousedown", this.onMouseDown);
        this.dom.addEventListener("wheel", this.onWheel, { passive: false });
        view.dom.appendChild(this.dom);
        this.schedule();
      }

      update(update: ViewUpdate) {
        const reconfigured = update.transactions.some((transaction) => transaction.reconfigured);
        const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);
        if (update.docChanged || reconfigured || treeChanged) this.layout = null;
        if (update.viewportChanged || update.geometryChanged || this.layout === null) {
          this.schedule();
        }
      }

      schedule() {
        this.view.requestMeasure({
          key: this,
          read: (view) => this.measure(view),
          write: (layout) => this.render(layout),
        });
      }

      measure(view: EditorView): StickyLayout {
        const { scrollDOM, contentDOM } = view;
        const lineHeight = view.defaultLineHeight;
        const scrollRect = scrollDOM.getBoundingClientRect();
        const visibleTop = scrollRect.top - view.documentTop;
        const rows =
          visibleTop > 0
            ? computeStickyRows(
                view.state,
                visibleTop,
                lineHeight,
                maxLines,
                (height) => view.lineBlockAtHeight(height),
                (pos) => view.lineBlockAt(pos).bottom,
              )
            : [];
        const gutters = view.dom.querySelector<HTMLElement>(".cm-gutters:not(.cm-minimap-gutter)");
        const minimap = view.dom.querySelector<HTMLElement>(".cm-minimap-gutter");
        const firstLine = contentDOM.querySelector<HTMLElement>(".cm-line");
        const contentStyle = getComputedStyle(contentDOM);
        const linePadding = firstLine
          ? parseFloat(getComputedStyle(firstLine).paddingLeft) || 0
          : 0;
        return {
          rows,
          lineHeight,
          top: scrollDOM.offsetTop,
          left: scrollDOM.offsetLeft,
          width: scrollDOM.clientWidth - (minimap?.offsetWidth ?? 0),
          gutterWidth: gutters?.offsetWidth ?? 0,
          textLeft: contentDOM.getBoundingClientRect().left - scrollRect.left + linePadding,
          showLineNumbers: Boolean(view.dom.querySelector(".cm-lineNumbers")),
          font: {
            family: contentStyle.fontFamily,
            size: contentStyle.fontSize,
            ligatures: contentStyle.fontVariantLigatures,
          },
        };
      }

      render(layout: StickyLayout) {
        if (sameLayout(this.layout, layout)) return;
        this.layout = layout;
        const { rows, lineHeight } = layout;
        const height = rows.length
          ? Math.max(0, rows.length * lineHeight + rows[rows.length - 1].offset)
          : 0;
        this.height = height;
        if (!rows.length) {
          this.dom.style.display = "none";
          this.dom.textContent = "";
          return;
        }
        const style = this.dom.style;
        style.display = "block";
        style.top = `${layout.top}px`;
        style.left = `${layout.left}px`;
        style.width = `${Math.max(0, layout.width)}px`;
        style.height = `${height}px`;
        style.fontFamily = layout.font.family;
        style.fontSize = layout.font.size;
        style.fontVariantLigatures = layout.font.ligatures;
        style.lineHeight = `${lineHeight}px`;
        style.tabSize = String(this.view.state.tabSize);
        this.dom.textContent = "";
        rows.forEach((row, index) => {
          const rowDom = document.createElement("div");
          rowDom.className = "cm-athas-sticky-row";
          rowDom.dataset.line = String(row.line);
          rowDom.dataset.index = String(index);
          rowDom.style.top = `${index * lineHeight + row.offset}px`;
          rowDom.style.height = `${lineHeight}px`;
          rowDom.style.zIndex = String(rows.length - index);
          const text = document.createElement("div");
          text.className = "cm-athas-sticky-text";
          text.style.left = `${layout.textLeft}px`;
          renderLineText(this.view.state, row.line, text);
          rowDom.appendChild(text);
          if (layout.gutterWidth > 0) {
            const gutter = document.createElement("div");
            gutter.className = "cm-athas-sticky-gutter";
            gutter.style.width = `${layout.gutterWidth}px`;
            gutter.style.height = `${lineHeight}px`;
            if (layout.showLineNumbers) gutter.textContent = String(row.line);
            rowDom.appendChild(gutter);
          }
          this.dom.appendChild(rowDom);
        });
      }

      onMouseDown = (event: MouseEvent) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>(".cm-athas-sticky-row");
        if (!target || event.button !== 0) return;
        event.preventDefault();
        const lineNumber = Number(target.dataset.line);
        const index = Number(target.dataset.index);
        const { view } = this;
        if (!lineNumber || lineNumber > view.state.doc.lines) return;
        const line = view.state.doc.line(lineNumber);
        const indent = /^\s*/.exec(line.text)?.[0].length ?? 0;
        view.dispatch({
          selection: { anchor: line.from + indent },
          effects: EditorView.scrollIntoView(line.from, {
            y: "start",
            yMargin: index * view.defaultLineHeight,
          }),
        });
        view.focus();
      };

      /** The rows sit outside the scroller, so wheel input over them is handed to it. */
      onWheel = (event: WheelEvent) => {
        event.preventDefault();
        const unit =
          event.deltaMode === 1
            ? this.view.defaultLineHeight
            : event.deltaMode === 2
              ? this.view.scrollDOM.clientHeight
              : 1;
        this.view.scrollDOM.scrollBy({ left: event.deltaX * unit, top: event.deltaY * unit });
      };

      destroy() {
        this.dom.removeEventListener("mousedown", this.onMouseDown);
        this.dom.removeEventListener("wheel", this.onWheel);
        this.dom.remove();
      }
    },
    {
      eventHandlers: {
        scroll() {
          this.schedule();
        },
      },
      provide: (plugin) =>
        EditorView.scrollMargins.of((view) => {
          const height = view.plugin(plugin)?.height ?? 0;
          return height > 0 ? { top: height } : null;
        }),
    },
  );

/**
 * Pins the headers of the scopes enclosing the top of the editor (functions, classes, blocks,
 * Markdown sections, indented blocks) while scrolling. Clicking a pinned line jumps to it.
 */
export function stickyScroll({ maxLines = 5 }: StickyScrollOptions = {}): Extension {
  return [stickyTheme, stickyPlugin(Math.max(1, maxLines))];
}
