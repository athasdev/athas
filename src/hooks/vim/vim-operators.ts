import type { VimOperator } from "./vim-types";

export const operators: VimOperator[] = [
  {
    key: "d",
    execute: (context, start, end) => {
      const [deleteStart, deleteEnd] = start <= end ? [start, end] : [end, start];
      const newContent = context.content.slice(0, deleteStart) + context.content.slice(deleteEnd);
      context.updateContent(newContent);
      context.setState({ register: context.content.slice(deleteStart, deleteEnd) });
      context.setCursorPosition(deleteStart);
    },
    description: "Delete text",
  },
  {
    key: "c",
    execute: (context, start, end) => {
      const [changeStart, changeEnd] = start <= end ? [start, end] : [end, start];
      const newContent = context.content.slice(0, changeStart) + context.content.slice(changeEnd);
      context.updateContent(newContent);
      context.setState({ register: context.content.slice(changeStart, changeEnd), mode: "insert" });
      context.setCursorPosition(changeStart);
    },
    description: "Change (delete and insert)",
  },
  {
    key: "y",
    execute: (context, start, end) => {
      const [yankStart, yankEnd] = start <= end ? [start, end] : [end, start];
      const yankedText = context.content.slice(yankStart, yankEnd);
      context.setState({ register: yankedText });
      context.setCursorPosition(start);
    },
    description: "Yank (copy) text",
  },
];
