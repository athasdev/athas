/**
 * Change operator (c)
 */

import type { EditorContext, Operator, VimRange } from "../core/types";
import { deleteOperator } from "./delete-operator";

/**
 * Change operator - deletes text and enters insert mode
 */
export const changeOperator: Operator = {
  name: "change",
  repeatable: true,
  entersInsertMode: true,

  execute: (range: VimRange, context: EditorContext): void => {
    // Change is basically delete + enter insert mode
    deleteOperator.execute(range, context);

    // The caller should handle entering insert mode based on entersInsertMode flag
  },
};
