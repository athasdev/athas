/**
 * AST (Abstract Syntax Tree) types for Vim grammar
 *
 * Grammar (EBNF):
 * Command        := [Register] [Count] ( Action | OperatorInvocation | Motion )
 * Register       := '"' RegisterName
 * Count          := DigitNonZero { Digit }
 * Action         := PutAction | CharAction | MiscAction | ModeChangeAction
 * OperatorInvocation := Operator ( Operator | [Count] Target )
 * Operator       := 'd'|'c'|'y'|'<'|'>'|'='|'!'|'g~'|'gu'|'gU'|'gq'|'g@'
 * Target         := ForcedKind? ( TextObject | Motion )
 * ForcedKind     := 'v' | 'V' | '<C-V>'
 * TextObject     := ('a'|'i') ObjectKey
 * Motion         := SimpleMotion | CharMotion | SearchMotion | MarkMotion | PrefixedMotion
 */

export type Count = number;

/**
 * Register reference (e.g., "a, "0, "+, "*)
 */
export interface RegisterRef {
  name: string; // a-z, 0-9, ", +, *, _, /
}

/**
 * Top-level command structure
 */
export type Command =
  | {
      kind: "action";
      reg?: RegisterRef;
      count?: Count;
      action: Action;
    }
  | {
      kind: "operator";
      reg?: RegisterRef;
      countBefore?: Count;
      operator: OperatorKey;
      doubled?: boolean; // true for dd, yy, cc, >>, etc.
      target?: Target; // absent => incomplete command
      countAfter?: Count;
    }
  | {
      kind: "motion";
      count?: Count;
      motion: Motion;
    };

/**
 * Actions - standalone commands that don't require a motion
 */
export type Action =
  | { type: "put"; which: "p" | "P" }
  | { type: "charReplace"; which: "r" | "gr"; char: string }
  | { type: "modeChange"; mode: ModeChangeAction }
  | { type: "singleChar"; operation: SingleCharOperation }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "repeat" } // dot command
  | { type: "misc"; key: string }; // J, ~, etc.

/**
 * Mode change actions (i, a, A, I, o, O, s)
 */
export type ModeChangeAction =
  | "insert" // i
  | "append" // a
  | "appendLine" // A
  | "insertLineStart" // I
  | "openBelow" // o
  | "openAbove" // O
  | "substitute"; // s

/**
 * Single character operations (x, X)
 */
export type SingleCharOperation = "deleteChar" | "deleteCharBefore";

/**
 * Operator keys
 */
export type OperatorKey =
  | "d" // delete
  | "c" // change
  | "y" // yank
  | "<" // outdent
  | ">" // indent
  | "=" // format
  | "!" // filter
  | "g~" // toggle case
  | "gu" // lowercase
  | "gU" // uppercase
  | "gq" // format text
  | "g@"; // operator function

/**
 * Target for an operator (motion or text object)
 */
export type Target =
  | {
      type: "motion";
      forced?: "char" | "line" | "block"; // v, V, Ctrl-V
      motion: Motion;
    }
  | {
      type: "textObject";
      forced?: "char" | "line" | "block";
      mode: "inner" | "around"; // i or a
      object: string; // w, s, p, ), ], }, >, ", ', `, t, b, B, etc.
    };

/**
 * Motion types
 */
export type Motion =
  | SimpleMotion
  | CharMotion
  | SearchMotion
  | SearchRepeatMotion
  | MarkMotion
  | PrefixedMotion;

/**
 * Simple single or multi-character motions
 */
export interface SimpleMotion {
  type: "simple";
  key: string; // w, W, e, E, b, B, h, j, k, l, 0, ^, $, gg, G, {, }, (, ), g_, %, etc.
}

/**
 * Character-finding motions (f, F, t, T)
 */
export interface CharMotion {
  type: "char";
  key: "f" | "F" | "t" | "T";
  char: string;
}

/**
 * Search motions (/, ?)
 */
export interface SearchMotion {
  type: "search";
  dir: "fwd" | "bwd"; // / or ?
  pattern: string;
}

/**
 * Search repeat motions (n, N, *, #)
 */
export interface SearchRepeatMotion {
  type: "searchRepeat";
  key: "n" | "N" | "*" | "#";
}

/**
 * Mark motions (', `)
 */
export interface MarkMotion {
  type: "mark";
  style: "'" | "`"; // ' for line, ` for exact position
  mark: string; // a-z, A-Z, 0-9, <, >, etc.
}

/**
 * Prefixed motions (g, z, [, ] families)
 * Examples: g_, gj, gk, zt, zz, zb, ]], [[, ]m, [m
 */
export interface PrefixedMotion {
  type: "prefixed";
  head: "g" | "z" | "[" | "]";
  tail: string;
}

/**
 * Parse result types
 */
export interface ParseOk {
  status: "complete";
  command: Command;
}

export interface ParseIncomplete {
  status: "incomplete";
}

export interface ParseNeedsChar {
  status: "needsChar";
  context?: string; // e.g., "f", "r", "'", for better UX
}

export interface ParseInvalid {
  status: "invalid";
  reason?: string;
}

export type ParseResult = ParseOk | ParseIncomplete | ParseNeedsChar | ParseInvalid;
