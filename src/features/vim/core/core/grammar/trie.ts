/**
 * Trie data structure for efficient longest-match token lookup
 *
 * Supports multi-character tokens (e.g., "gg", "g~", "gU") and provides
 * efficient prefix matching for the Vim parser.
 */

/**
 * Token kinds in the Vim grammar
 */
export type TokKind = "operator" | "motion" | "action" | "textobj" | "forcedKind";

/**
 * Token specification
 */
export interface TokSpec {
  key: string; // The token string (e.g., "d", "gg", "g~")
  kind: TokKind; // Type of token
  expectsCharArg?: boolean; // True for f/F/t/T/r/gr/'/`
  linewiseIfDoubled?: boolean; // True for operators that support doubling (dd, yy, etc.)
}

/**
 * Node in the token trie
 */
export class TrieNode {
  next = new Map<string, TrieNode>();
  tok?: TokSpec;
}

/**
 * Match result from trie lookup
 */
export type TrieMatch =
  | { kind: "complete"; tok: TokSpec; len: number } // Found complete token
  | { kind: "partial" } // Valid prefix, but not complete
  | { kind: "none" }; // No match

/**
 * Token trie for longest-match prefix lookup
 */
export class TokenTrie {
  root = new TrieNode();

  /**
   * Add a token to the trie
   */
  add(tok: TokSpec): void {
    let cur = this.root;
    for (const ch of tok.key) {
      if (!cur.next.has(ch)) {
        cur.next.set(ch, new TrieNode());
      }
      cur = cur.next.get(ch)!;
    }
    cur.tok = tok;
  }

  /**
   * Find longest matching token from keys starting at index
   *
   * Returns:
   * - complete: Found a complete token (potentially not the longest if more keys needed)
   * - partial: Valid prefix but no complete token yet
   * - none: Invalid prefix, no token possible
   */
  match(keys: string[], index: number): TrieMatch {
    let cur = this.root;
    let lastTok: TokSpec | undefined;
    let len = 0;

    for (let i = index; i < keys.length; i++) {
      const ch = keys[i];
      const nxt = cur.next.get(ch);

      if (!nxt) {
        // No further matches possible
        break;
      }

      cur = nxt;
      len++;

      // Track the last complete token we found
      if (cur.tok) {
        lastTok = cur.tok;
      }
    }

    // If we found a complete token, return it
    if (lastTok) {
      // Calculate the actual length of the matched token
      const tokenLen = lastTok.key.length;
      return { kind: "complete", tok: lastTok, len: tokenLen };
    }

    // If we made progress but found no complete token, it's a partial match
    if (len > 0) {
      return { kind: "partial" };
    }

    // No match at all
    return { kind: "none" };
  }

  /**
   * Check if a key sequence could be a valid token (complete or partial)
   */
  isValid(keys: string[], index: number): boolean {
    const match = this.match(keys, index);
    return match.kind !== "none";
  }

  /**
   * Check if a key sequence is a complete token
   */
  isComplete(keys: string[], index: number): boolean {
    const match = this.match(keys, index);
    return match.kind === "complete";
  }

  /**
   * Get all registered token keys (for debugging/introspection)
   */
  getAllTokens(): TokSpec[] {
    const tokens: TokSpec[] = [];

    const traverse = (node: TrieNode) => {
      if (node.tok) {
        tokens.push(node.tok);
      }
      for (const child of node.next.values()) {
        traverse(child);
      }
    };

    traverse(this.root);
    return tokens;
  }
}
