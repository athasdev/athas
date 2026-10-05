import type { StreamParser, StringStream } from "@codemirror/language";
import { html } from "@codemirror/legacy-modes/mode/xml";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";

interface ErbState {
  inRuby: boolean;
  /** Inside a `<%#` comment tag. */
  inComment: boolean;
  html: unknown;
  ruby: unknown;
}

function copyInner(parser: StreamParser<unknown>, state: unknown): unknown {
  if (parser.copyState) return parser.copyState(state);
  if (!state || typeof state !== "object") return state;
  const copy: Record<string, unknown> = { ...(state as Record<string, unknown>) };
  for (const key of Object.keys(copy)) {
    const value = copy[key];
    if (Array.isArray(value)) copy[key] = value.slice();
  }
  return copy;
}

/** Runs `parser` on the stream with the line cut off at `end`, so it cannot read past a tag. */
function tokenUntil(
  stream: StringStream,
  parser: StreamParser<unknown>,
  state: unknown,
  end: number,
): string | null {
  if (end < 0) return parser.token(stream, state);
  const full = stream.string;
  stream.string = full.slice(0, end);
  try {
    return parser.token(stream, state);
  } finally {
    stream.string = full;
  }
}

/** Embedded Ruby templates: HTML with Ruby inside `<% %>` tags. */
export const erb: StreamParser<ErbState> = {
  name: "erb",
  startState: (indentUnit) => ({
    inRuby: false,
    inComment: false,
    html: html.startState?.(indentUnit) ?? {},
    ruby: ruby.startState?.(indentUnit) ?? {},
  }),
  copyState: (state) => ({
    inRuby: state.inRuby,
    inComment: state.inComment,
    html: copyInner(html, state.html),
    ruby: copyInner(ruby, state.ruby),
  }),
  token(stream, state) {
    if (state.inComment) {
      if (stream.match(/^.*?-?%>/)) {
        state.inComment = false;
        state.inRuby = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }
    if (!state.inRuby) {
      if (stream.match(/^<%#/)) {
        state.inComment = true;
        return "comment";
      }
      if (stream.match(/^<%(?:={1,2}|-|%)?/)) {
        state.inRuby = true;
        return "tagName";
      }
      return tokenUntil(stream, html, state.html, stream.string.indexOf("<%", stream.pos));
    }
    if (stream.match(/^-?%>/)) {
      state.inRuby = false;
      return "tagName";
    }
    const close = stream.string.slice(stream.pos).search(/-?%>/);
    return tokenUntil(stream, ruby, state.ruby, close < 0 ? -1 : stream.pos + close);
  },
  languageData: {
    commentTokens: { block: { open: "<%#", close: "%>" } },
  },
};
