/**
 * Token registries for Vim grammar
 *
 * Provides token tries for operators, actions, motions, forced kinds, and text objects.
 * These tries support efficient longest-match prefix lookup during parsing.
 */

import { TokenTrie, type TokSpec } from "./trie";

/**
 * Operator tokens
 *
 * Operators act on a motion or text object (e.g., dw, ciw, >>, gUU).
 * Operators can be doubled for linewise operation on current line (dd, yy, cc, etc.)
 */
export const operators = new TokenTrie();

const operatorTokens: TokSpec[] = [
  { key: "d", kind: "operator", linewiseIfDoubled: true }, // delete
  { key: "c", kind: "operator", linewiseIfDoubled: true }, // change
  { key: "y", kind: "operator", linewiseIfDoubled: true }, // yank
  { key: ">", kind: "operator", linewiseIfDoubled: true }, // indent
  { key: "<", kind: "operator", linewiseIfDoubled: true }, // outdent
  { key: "=", kind: "operator", linewiseIfDoubled: true }, // format
  { key: "!", kind: "operator", linewiseIfDoubled: false }, // filter
  { key: "g~", kind: "operator", linewiseIfDoubled: true }, // toggle case
  { key: "gu", kind: "operator", linewiseIfDoubled: true }, // lowercase
  { key: "gU", kind: "operator", linewiseIfDoubled: true }, // uppercase
  { key: "gq", kind: "operator", linewiseIfDoubled: false }, // format text
  { key: "g@", kind: "operator", linewiseIfDoubled: false }, // operator function
];

operatorTokens.forEach((t) => operators.add(t));

/**
 * Action tokens
 *
 * Actions are standalone commands that execute immediately without requiring a motion.
 * Examples: p (paste), x (delete char), i (insert mode), u (undo)
 */
export const actions = new TokenTrie();

const actionTokens: TokSpec[] = [
  // Put (paste) actions
  { key: "p", kind: "action" }, // paste after
  { key: "P", kind: "action" }, // paste before

  // Replace actions (need character argument)
  { key: "r", kind: "action", expectsCharArg: true }, // replace char
  { key: "gr", kind: "action", expectsCharArg: true }, // virtual replace

  // Mode change actions
  { key: "i", kind: "action" }, // insert mode
  { key: "a", kind: "action" }, // append mode
  { key: "A", kind: "action" }, // append at line end
  { key: "I", kind: "action" }, // insert at line start
  { key: "o", kind: "action" }, // open line below
  { key: "O", kind: "action" }, // open line above
  { key: "s", kind: "action" }, // substitute char

  // Single char operations
  { key: "x", kind: "action" }, // delete char
  { key: "X", kind: "action" }, // delete char before

  // Undo/redo
  { key: "u", kind: "action" }, // undo
  { key: "<C-r>", kind: "action" }, // redo (Ctrl-r)

  // Repeat
  { key: ".", kind: "action" }, // repeat last change

  // Misc actions
  { key: "J", kind: "action" }, // join lines
  { key: "~", kind: "action" }, // toggle case of char

  // Aliases (will be normalized to operator form)
  { key: "D", kind: "action" }, // delete to end of line (d$)
  { key: "C", kind: "action" }, // change to end of line (c$)
  { key: "S", kind: "action" }, // substitute line (cc)
  { key: "Y", kind: "action" }, // yank line (yy)
];

actionTokens.forEach((t) => actions.add(t));

/**
 * Motion tokens
 *
 * Motions define cursor movement or text ranges.
 * Can be used standalone or after an operator.
 */
export const motions = new TokenTrie();

const motionTokens: TokSpec[] = [
  // Word motions
  { key: "w", kind: "motion" }, // word forward
  { key: "W", kind: "motion" }, // WORD forward
  { key: "e", kind: "motion" }, // end of word
  { key: "E", kind: "motion" }, // end of WORD
  { key: "b", kind: "motion" }, // word backward
  { key: "B", kind: "motion" }, // WORD backward
  { key: "ge", kind: "motion" }, // end of previous word
  { key: "gE", kind: "motion" }, // end of previous WORD

  // Character motions (h, j, k, l)
  { key: "h", kind: "motion" }, // left
  { key: "j", kind: "motion" }, // down
  { key: "k", kind: "motion" }, // up
  { key: "l", kind: "motion" }, // right

  // Line motions
  { key: "0", kind: "motion" }, // start of line
  { key: "^", kind: "motion" }, // first non-blank
  { key: "$", kind: "motion" }, // end of line
  { key: "_", kind: "motion" }, // first non-blank (linewise)
  { key: "g_", kind: "motion" }, // last non-blank

  // File motions
  { key: "gg", kind: "motion" }, // first line
  { key: "G", kind: "motion" }, // last line / goto line

  // Paragraph/block motions
  { key: "{", kind: "motion" }, // paragraph backward
  { key: "}", kind: "motion" }, // paragraph forward
  { key: "(", kind: "motion" }, // sentence backward
  { key: ")", kind: "motion" }, // sentence forward

  // Matching pair
  { key: "%", kind: "motion" }, // matching bracket

  // Character find motions (need character argument)
  { key: "f", kind: "motion", expectsCharArg: true }, // find char forward
  { key: "F", kind: "motion", expectsCharArg: true }, // find char backward
  { key: "t", kind: "motion", expectsCharArg: true }, // till char forward
  { key: "T", kind: "motion", expectsCharArg: true }, // till char backward
  { key: ";", kind: "motion" }, // repeat last f/F/t/T
  { key: ",", kind: "motion" }, // repeat last f/F/t/T reverse

  // Search motions
  { key: "/", kind: "motion" }, // search forward (needs pattern + <CR>)
  { key: "?", kind: "motion" }, // search backward (needs pattern + <CR>)
  { key: "n", kind: "motion" }, // repeat search
  { key: "N", kind: "motion" }, // repeat search reverse
  { key: "*", kind: "motion" }, // search word under cursor forward
  { key: "#", kind: "motion" }, // search word under cursor backward

  // Mark motions (need mark character)
  { key: "'", kind: "motion", expectsCharArg: true }, // jump to mark line
  { key: "`", kind: "motion", expectsCharArg: true }, // jump to mark exact

  // Display motions
  { key: "H", kind: "motion" }, // top of screen
  { key: "M", kind: "motion" }, // middle of screen
  { key: "L", kind: "motion" }, // bottom of screen

  // Scroll motions (z family)
  { key: "zt", kind: "motion" }, // scroll cursor to top
  { key: "zz", kind: "motion" }, // scroll cursor to middle
  { key: "zb", kind: "motion" }, // scroll cursor to bottom

  // Section motions ([ and ] families)
  { key: "]]", kind: "motion" }, // next section forward
  { key: "[[", kind: "motion" }, // next section backward
  { key: "][", kind: "motion" }, // next section end forward
  { key: "[]", kind: "motion" }, // next section end backward
  { key: "]m", kind: "motion" }, // next method forward
  { key: "[m", kind: "motion" }, // next method backward

  // Display line motions (g family)
  { key: "gj", kind: "motion" }, // down display line
  { key: "gk", kind: "motion" }, // up display line
  { key: "g0", kind: "motion" }, // start of display line
  { key: "g^", kind: "motion" }, // first non-blank of display line
  { key: "g$", kind: "motion" }, // end of display line
];

motionTokens.forEach((t) => motions.add(t));

/**
 * Forced kind tokens (v, V, Ctrl-V)
 *
 * These force the following motion to be characterwise, linewise, or blockwise.
 * Example: dvj (force charwise), dVw (force linewise)
 */
export const forcedKinds = new TokenTrie();

const forcedKindTokens: TokSpec[] = [
  { key: "v", kind: "forcedKind" }, // force characterwise
  { key: "V", kind: "forcedKind" }, // force linewise
  { key: "<C-V>", kind: "forcedKind" }, // force blockwise (Ctrl-V)
];

forcedKindTokens.forEach((t) => forcedKinds.add(t));

/**
 * Text object keys (used after 'i' or 'a')
 *
 * Text objects define regions of text (e.g., iw = inner word, a" = around quotes).
 * They can only be used after an operator or in visual mode.
 */
export const textObjectKeys = new Set([
  "w", // word
  "W", // WORD
  "s", // sentence
  "p", // paragraph
  "(", // parentheses (opening)
  ")", // parentheses (closing)
  "[", // square brackets (opening)
  "]", // square brackets (closing)
  "{", // curly braces (opening)
  "}", // curly braces (closing)
  "<", // angle brackets (opening)
  ">", // angle brackets (closing)
  '"', // double quotes
  "'", // single quotes
  "`", // backticks
  "t", // HTML/XML tag
  "b", // block (same as ()
  "B", // Block (same as {})
]);

/**
 * Check if a key is a valid text object key
 */
export function isTextObjectKey(key: string): boolean {
  return textObjectKeys.has(key);
}

/**
 * Helper to check if a token expects a character argument
 */
export function expectsCharArg(tok: TokSpec): boolean {
  return tok.expectsCharArg === true;
}

/**
 * Helper to check if an operator supports doubling for linewise operation
 */
export function supportsDoubling(tok: TokSpec): boolean {
  return tok.linewiseIfDoubled === true;
}
