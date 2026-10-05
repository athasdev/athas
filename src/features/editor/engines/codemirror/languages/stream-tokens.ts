import type { StreamParser } from "@codemirror/language";
import { type Rule, simpleMode } from "@codemirror/legacy-modes/mode/simple-mode";
import { type Tag, tags as t } from "@lezer/highlight";

/**
 * Token names the Athas tokenizers emit beyond the plain highlight tag names (`keyword`, `string`,
 * `typeName`...). `simpleMode` turns dots into spaces, so modified tags need a single-word name.
 */
export const athasTokenTable: Record<string, Tag> = {
  fn: t.function(t.variableName),
  constant: t.constant(t.variableName),
  builtinFn: t.function(t.standard(t.variableName)),
  builtinConst: t.standard(t.variableName),
  definition: t.definition(t.variableName),
  propertyDef: t.definition(t.propertyName),
  control: t.controlKeyword,
  definitionKeyword: t.definitionKeyword,
  moduleKeyword: t.moduleKeyword,
  stringSpecial: t.special(t.string),
  docComment: t.docComment,
};

/** Tokenizer states by name, `start` first, plus the language data the parser carries. */
interface SimpleModeStates {
  start: Rule[];
  languageData?: Record<string, unknown>;
  [state: string]: Rule[] | Record<string, unknown> | undefined;
}

/** A `simpleMode` tokenizer that understands the Athas token names. */
export function athasSimpleMode(states: SimpleModeStates): StreamParser<unknown> {
  return { ...simpleMode(states as Parameters<typeof simpleMode>[0]), tokenTable: athasTokenTable };
}

/** A token function for identifier rules: the first word list that holds the word decides. */
export function classifyWord(
  groups: Array<[ReadonlySet<string>, string]>,
  fallback: string | null = null,
) {
  return (match: RegExpMatchArray) => {
    const word = match[0];
    for (const [words, token] of groups) {
      if (words.has(word)) return token;
    }
    return fallback;
  };
}

export const words = (list: string) => new Set(list.split(/\s+/).filter(Boolean));
