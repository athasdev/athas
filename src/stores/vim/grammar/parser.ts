/**
 * Vim grammar parser
 *
 * Streaming incremental parser that processes key sequences and produces AST.
 *
 * Grammar:
 * Command        := [Register] [Count] ( Action | OperatorInvocation )
 * Register       := '"' RegisterName
 * Count          := DigitNonZero { Digit }
 * OperatorInvocation := Operator ( Operator | [Count] Target )
 * Target         := ForcedKind? ( TextObject | Motion )
 * ForcedKind     := 'v' | 'V' | '<C-V>'
 * TextObject     := ('a'|'i') ObjectKey
 * Motion         := SimpleMotion | CharMotion | SearchMotion | MarkMotion | ...
 */

import type { Command, Motion, ParseResult, RegisterRef, Target } from "./ast";
import { actions, forcedKinds, isTextObjectKey, motions, operators } from "./tokens";

/**
 * Parser state (internal)
 */
interface ParseState {
  reg?: RegisterRef;
  count1?: number;
  operator?: string;
  doubled?: boolean;
  forced?: "char" | "line" | "block";
  count2?: number;
  target?: Target;
}

/**
 * Helper to check if a string is a digit
 */
const isDigit = (s: string): boolean => /^[0-9]$/.test(s);

/**
 * Helper to check if a string is a non-zero digit
 */
const isNonZeroDigit = (s: string): boolean => /^[1-9]$/.test(s);

/**
 * Parse a count from keys starting at index
 * Returns { val: number, next: index } if found, otherwise { next: index }
 */
function parseNumber(keys: string[], i: number): { val?: number; next: number } {
  if (i >= keys.length || !isNonZeroDigit(keys[i])) {
    return { next: i };
  }

  let s = keys[i++];
  while (i < keys.length && isDigit(keys[i])) {
    s += keys[i++];
  }

  return { val: parseInt(s, 10), next: i };
}

/**
 * Main parser function
 *
 * Parses a sequence of keys into a Command AST or returns parse status.
 */
export function parse(keys: string[]): ParseResult {
  if (keys.length === 0) {
    return { status: "incomplete" };
  }

  let i = 0;
  const st: ParseState = {};

  // 1) Optional register: "x
  if (keys[i] === '"') {
    if (i + 1 >= keys.length) {
      return { status: "incomplete" };
    }
    st.reg = { name: keys[i + 1] };
    i += 2;
  }

  // 2) Optional first count
  const c1 = parseNumber(keys, i);
  if (c1.val) {
    st.count1 = c1.val;
  }
  i = c1.next;

  if (i >= keys.length) {
    return { status: "incomplete" };
  }

  // 3) Try ACTION first (longest match)
  const actionMatch = actions.match(keys, i);
  if (actionMatch.kind === "complete") {
    const tok = actionMatch.tok;
    i += actionMatch.len;

    // Handle actions that expect a character argument (r, gr, f, t, F, T, ', `)
    if (tok.expectsCharArg) {
      if (i >= keys.length) {
        return { status: "needsChar", context: tok.key };
      }
      const char = keys[i++];

      // Replace actions (r, gr)
      if (tok.key === "r" || tok.key === "gr") {
        const cmd: Command = {
          kind: "action",
          reg: st.reg,
          count: st.count1,
          action: { type: "charReplace", which: tok.key, char },
        };
        if (i !== keys.length) {
          return { status: "invalid", reason: "Trailing keys after action" };
        }
        return { status: "complete", command: cmd };
      }
    }

    // Map action key to Action type
    const action = mapKeyToAction(tok.key, st.count1);
    if (!action) {
      return { status: "invalid", reason: `Unknown action: ${tok.key}` };
    }

    const cmd: Command = {
      kind: "action",
      reg: st.reg,
      count: st.count1,
      action,
    };

    if (i !== keys.length) {
      return { status: "invalid", reason: "Trailing keys after action" };
    }

    return { status: "complete", command: cmd };
  }

  if (actionMatch.kind === "partial") {
    return { status: "incomplete" };
  }

  // 4) Try OPERATOR
  const opMatch = operators.match(keys, i);
  if (opMatch.kind === "complete") {
    st.operator = opMatch.tok.key;
    i += opMatch.len;

    // Check for operator doubling (dd, yy, cc, etc.)
    const dblMatch = operators.match(keys, i);
    if (
      dblMatch.kind === "complete" &&
      dblMatch.tok.key === st.operator &&
      opMatch.tok.linewiseIfDoubled
    ) {
      i += dblMatch.len;
      st.doubled = true;

      // Doubled operators are complete (linewise on current line)
      if (i !== keys.length) {
        return { status: "invalid", reason: "Trailing keys after operator doubling" };
      }

      const cmd: Command = {
        kind: "operator",
        reg: st.reg,
        countBefore: st.count1,
        operator: st.operator as any,
        doubled: true,
      };

      return { status: "complete", command: cmd };
    }

    // 5) Optional second count (after operator)
    const c2 = parseNumber(keys, i);
    if (c2.val) {
      st.count2 = c2.val;
    }
    i = c2.next;

    // 6) Optional forced kind (v, V, Ctrl-V)
    const fkMatch = forcedKinds.match(keys, i);
    if (fkMatch.kind === "complete") {
      i += fkMatch.len;
      const fk = fkMatch.tok.key;
      st.forced = fk === "V" ? "line" : fk === "<C-V>" ? "block" : "char";
    } else if (fkMatch.kind === "partial") {
      return { status: "incomplete" };
    }

    // 7) TARGET: text object or motion
    if (i >= keys.length) {
      return { status: "incomplete" };
    }

    // TEXT OBJECT? (i or a prefix)
    if (keys[i] === "i" || keys[i] === "a") {
      const mode = keys[i] === "i" ? "inner" : "around";
      i++;

      if (i >= keys.length) {
        return { status: "incomplete" };
      }

      const objectKey = keys[i];
      if (!isTextObjectKey(objectKey)) {
        return { status: "invalid", reason: `Invalid text object: ${objectKey}` };
      }

      i++;
      st.target = {
        type: "textObject",
        forced: st.forced,
        mode,
        object: objectKey,
      };

      if (i !== keys.length) {
        return { status: "invalid", reason: "Trailing keys after text object" };
      }

      const cmd: Command = {
        kind: "operator",
        reg: st.reg,
        countBefore: st.count1,
        operator: st.operator as any,
        countAfter: st.count2,
        target: st.target,
      };

      return { status: "complete", command: cmd };
    }

    // MOTION
    const motionResult = parseMotion(keys, i);
    if (motionResult.status !== "complete") {
      return motionResult;
    }

    i = motionResult.index;
    st.target = {
      type: "motion",
      forced: st.forced,
      motion: motionResult.motion,
    };

    if (i !== keys.length) {
      return { status: "invalid", reason: "Trailing keys after motion" };
    }

    const cmd: Command = {
      kind: "operator",
      reg: st.reg,
      countBefore: st.count1,
      operator: st.operator as any,
      countAfter: st.count2,
      target: st.target,
    };

    return { status: "complete", command: cmd };
  }

  if (opMatch.kind === "partial") {
    return { status: "incomplete" };
  }

  // 5) Try MOTION (standalone cursor movement)
  const motionResult = parseMotion(keys, i);
  if (motionResult.status === "complete") {
    if (motionResult.index !== keys.length) {
      return { status: "invalid", reason: "Trailing keys after motion" };
    }

    const cmd: Command = {
      kind: "motion",
      count: st.count1,
      motion: motionResult.motion,
    };

    return { status: "complete", command: cmd };
  }

  if (motionResult.status === "incomplete" || motionResult.status === "needsChar") {
    return motionResult;
  }

  // If we get here, no valid command was found
  return { status: "invalid", reason: "Unknown command prefix" };
}

/**
 * Motion parse result (internal to parseMotion)
 */
type MotionParseResult =
  | { status: "complete"; motion: Motion; index: number }
  | { status: "incomplete" }
  | { status: "needsChar"; context?: string }
  | { status: "invalid"; reason?: string };

/**
 * Parse a motion from keys starting at index
 */
function parseMotion(keys: string[], i: number): MotionParseResult {
  const mm = motions.match(keys, i);

  if (mm.kind === "partial") {
    return { status: "incomplete" };
  }

  if (mm.kind === "none") {
    return { status: "invalid", reason: "Expected motion" };
  }

  const tok = mm.tok;
  i += mm.len;

  // Handle search motions (/, ?)
  if (tok.key === "/" || tok.key === "?") {
    const start = i;
    let end = i;

    // Read until <CR> token
    while (end < keys.length && keys[end] !== "<CR>") {
      end++;
    }

    if (end >= keys.length) {
      return { status: "incomplete" };
    }

    const pattern = keys.slice(start, end).join("");
    i = end + 1;

    const motion: Motion = {
      type: "search",
      dir: tok.key === "/" ? "fwd" : "bwd",
      pattern,
    };

    return { status: "complete", motion, index: i };
  }

  // Handle char motions (f, F, t, T)
  if (
    tok.expectsCharArg &&
    (tok.key === "f" || tok.key === "F" || tok.key === "t" || tok.key === "T")
  ) {
    if (i >= keys.length) {
      return { status: "needsChar", context: tok.key };
    }

    const char = keys[i++];
    const motion: Motion = {
      type: "char",
      key: tok.key as "f" | "F" | "t" | "T",
      char,
    };

    return { status: "complete", motion, index: i };
  }

  // Handle mark motions (', `)
  if (tok.expectsCharArg && (tok.key === "'" || tok.key === "`")) {
    if (i >= keys.length) {
      return { status: "needsChar", context: tok.key };
    }

    const mark = keys[i++];
    const motion: Motion = {
      type: "mark",
      style: tok.key as "'" | "`",
      mark,
    };

    return { status: "complete", motion, index: i };
  }

  // Handle search repeat motions (n, N, *, #)
  if (tok.key === "n" || tok.key === "N" || tok.key === "*" || tok.key === "#") {
    const motion: Motion = {
      type: "searchRepeat",
      key: tok.key as "n" | "N" | "*" | "#",
    };

    return { status: "complete", motion, index: i };
  }

  // Handle prefixed motions (g_, gj, gk, zt, zz, zb, etc.)
  if (/^[gz[\]]/.test(tok.key)) {
    const head = tok.key[0] as "g" | "z" | "[" | "]";
    const tail = tok.key.slice(1);

    const motion: Motion = {
      type: "prefixed",
      head,
      tail,
    };

    return { status: "complete", motion, index: i };
  }

  // Simple motion
  const motion: Motion = {
    type: "simple",
    key: tok.key,
  };

  return { status: "complete", motion, index: i };
}

/**
 * Map action key to Action AST node
 */
function mapKeyToAction(
  key: string,
  _count?: number,
): Extract<Command, { kind: "action" }>["action"] | null {
  switch (key) {
    // Put actions
    case "p":
      return { type: "put", which: "p" };
    case "P":
      return { type: "put", which: "P" };

    // Mode change actions
    case "i":
      return { type: "modeChange", mode: "insert" };
    case "a":
      return { type: "modeChange", mode: "append" };
    case "A":
      return { type: "modeChange", mode: "appendLine" };
    case "I":
      return { type: "modeChange", mode: "insertLineStart" };
    case "o":
      return { type: "modeChange", mode: "openBelow" };
    case "O":
      return { type: "modeChange", mode: "openAbove" };
    case "s":
      return { type: "modeChange", mode: "substitute" };

    // Single char operations
    case "x":
      return { type: "singleChar", operation: "deleteChar" };
    case "X":
      return { type: "singleChar", operation: "deleteCharBefore" };

    // Undo/redo
    case "u":
      return { type: "undo" };
    case "<C-r>":
      return { type: "redo" };

    // Repeat
    case ".":
      return { type: "repeat" };

    // Misc actions (J, ~)
    case "J":
    case "~":
      return { type: "misc", key };

    // Aliases (D, C, S, Y) - handled by normalization layer
    case "D":
    case "C":
    case "S":
    case "Y":
      return { type: "misc", key };

    default:
      return null;
  }
}

/**
 * Utility: Get command parse status (for use-vim-keyboard integration)
 */
export function getCommandParseStatus(
  keys: string[],
): "complete" | "incomplete" | "invalid" | "needsChar" {
  const result = parse(keys);
  if (result.status === "complete") return "complete";
  if (result.status === "incomplete") return "incomplete";
  if (result.status === "needsChar") return "needsChar";
  return "invalid";
}
