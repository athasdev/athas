import type React from "react";
import { commands } from "./vim-commands";
import { executeExCommand } from "./vim-ex-commands";
import { motions } from "./vim-motions";
import { operators } from "./vim-operators";
import type { VimContext, VimMode, VimState } from "./vim-types";

export class VimEngine {
  private state: VimState = {
    mode: "normal",
    cursorPosition: 0,
    register: "",
    lastFindChar: "",
    lastFindDirection: "forward",
    pendingOperator: null,
    pendingCount: 0,
    commandBuffer: "",
  };

  private updateCursor: (pos: number) => void;
  private updateContent: (content: string) => void;
  private setMode: (mode: VimMode) => void;
  private showCommandLine?: (initialCommand?: string) => void;

  constructor(
    updateCursor: (pos: number) => void,
    updateContent: (content: string) => void,
    setMode: (mode: VimMode) => void,
    showCommandLine?: (initialCommand?: string) => void,
  ) {
    this.updateCursor = updateCursor;
    this.updateContent = updateContent;
    this.setMode = setMode;
    this.showCommandLine = showCommandLine;
  }

  public setState(newState: Partial<VimState>) {
    this.state = { ...this.state, ...newState };
    if (newState.mode) {
      this.setMode(newState.mode);
    }
  }

  public getState(): VimState {
    return { ...this.state };
  }

  public handleKeyDown(
    e: React.KeyboardEvent<HTMLDivElement>,
    editor: HTMLDivElement,
    content: string,
  ): boolean {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(editor);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      this.state.cursorPosition = preCaretRange.toString().length;
    }

    const context: VimContext = {
      textarea: editor as any,
      content,
      cursorPosition: this.state.cursorPosition,
      updateContent: this.updateContent,
      setCursorPosition: (pos: number) => {
        this.state.cursorPosition = pos;
        this.updateCursor(pos);
        requestAnimationFrame(() => {
          this.setContentEditableCursorPosition(editor, pos);
        });
      },
      state: this.state,
      setState: (state: Partial<VimState>) => this.setState(state),
      showCommandLine: this.showCommandLine,
    };

    const key = this.getKeyString(e);

    // Handle command buffer for multi-character commands
    if (this.state.mode === "normal") {
      this.state.commandBuffer += key;

      // Check for multi-character commands first
      const multiCharCommand = this.findMultiCharCommand(this.state.commandBuffer);
      if (multiCharCommand) {
        e.preventDefault();
        this.executeCommand(multiCharCommand, context);
        this.state.commandBuffer = "";
        return true;
      }

      // Check if we're building a multi-character command
      if (this.isPartialCommand(this.state.commandBuffer)) {
        e.preventDefault();
        return true;
      }

      // Handle pending operators with motions
      if (this.state.pendingOperator) {
        const motion = motions.find(m => m.key === key);
        if (motion) {
          e.preventDefault();
          const startPos = this.state.cursorPosition;
          const endPos = motion.execute(context);
          this.executeOperator(this.state.pendingOperator, context, startPos, endPos);
          this.state.pendingOperator = null;
          this.state.commandBuffer = "";
          return true;
        }
      }

      // Check for operators
      const operator = operators.find(op => op.key === key);
      if (operator) {
        e.preventDefault();
        this.state.pendingOperator = key;
        this.state.commandBuffer = "";
        return true;
      }

      // Check for motions (standalone)
      const motion = motions.find(m => m.key === key);
      if (motion) {
        e.preventDefault();
        const newPos = motion.execute(context);
        context.setCursorPosition(newPos);
        this.state.commandBuffer = "";
        return true;
      }

      // Reset command buffer if no matches
      this.state.commandBuffer = "";
    }

    // Handle single character commands
    const command = this.findCommand(key, this.state.mode);
    if (command) {
      e.preventDefault();
      this.executeCommand(command, context);
      return true;
    }

    // Handle visual mode movement
    if (this.state.mode === "visual" || this.state.mode === "visual-line") {
      const motion = motions.find(m => m.key === key);
      if (motion) {
        e.preventDefault();
        const newPos = motion.execute(context);
        if (this.state.visualStart !== undefined) {
          const start = Math.min(this.state.visualStart, newPos);
          const end = Math.max(this.state.visualStart, newPos);
          this.setContentEditableSelection(editor, start, end);
        }
        return true;
      }
    }

    // Allow normal typing in insert mode
    if (this.state.mode === "insert") {
      return false;
    }

    // Prevent all other keys in normal/visual modes
    e.preventDefault();
    return true;
  }

  private getKeyString(e: React.KeyboardEvent): string {
    if (e.key === "Escape") return "Escape";
    if (e.key === "Enter") return "Enter";
    if (e.key === "Tab") return "Tab";
    if (e.key === "Backspace") return "Backspace";
    if (e.key === " ") return "Space";

    // Handle special characters
    if (e.shiftKey) {
      const shiftMap: { [key: string]: string } = {
        "1": "!",
        "2": "@",
        "3": "#",
        "4": "$",
        "5": "%",
        "6": "^",
        "7": "&",
        "8": "*",
        "9": "(",
        "0": ")",
        "-": "_",
        "=": "+",
        "[": "{",
        "]": "}",
        "\\": "|",
        ";": ":",
        "'": '"',
        ",": "<",
        ".": ">",
        "/": "?",
        "`": "~",
      };

      if (shiftMap[e.key]) {
        return shiftMap[e.key];
      }

      // Handle shifted letters
      if (e.key.length === 1 && e.key.match(/[a-z]/)) {
        return e.key.toUpperCase();
      }
    }

    return e.key;
  }

  private findCommand(key: string, mode: VimMode) {
    return commands.find(cmd => {
      if (Array.isArray(cmd.mode)) {
        return cmd.mode.includes(mode) && cmd.key === key;
      }
      return cmd.mode === mode && cmd.key === key;
    });
  }

  private findMultiCharCommand(buffer: string) {
    return commands.find(cmd => cmd.key === buffer);
  }

  private isPartialCommand(buffer: string): boolean {
    return commands.some(cmd => cmd.key.startsWith(buffer) && cmd.key.length > buffer.length);
  }

  private executeCommand(command: any, context: VimContext) {
    command.execute(context);
  }

  private executeOperator(operatorKey: string, context: VimContext, start: number, end: number) {
    const operator = operators.find(op => op.key === operatorKey);
    if (operator) {
      operator.execute(context, start, end);
    }
  }

  public executeExCommand(command: string, editor: HTMLDivElement, content: string): boolean {
    const context: VimContext = {
      textarea: editor as any,
      content,
      cursorPosition: this.state.cursorPosition,
      updateContent: this.updateContent,
      setCursorPosition: (pos: number) => {
        this.state.cursorPosition = pos;
        this.updateCursor(pos);
        requestAnimationFrame(() => {
          this.setContentEditableCursorPosition(editor, pos);
        });
      },
      state: this.state,
      setState: (state: Partial<VimState>) => this.setState(state),
      showCommandLine: this.showCommandLine,
    };

    return executeExCommand(command, context);
  }

  public toggleEnabled(): boolean {
    if (this.state.mode !== "normal") {
      this.setState({ mode: "normal" });
    }
    return true;
  }

  private setContentEditableCursorPosition(element: HTMLDivElement, position: number): void {
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    let currentPos = 0;
    let found = false;

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);

    let node = walker.nextNode();
    while (node && !found) {
      const textLength = node.textContent?.length || 0;
      if (currentPos + textLength >= position) {
        range.setStart(node, position - currentPos);
        range.setEnd(node, position - currentPos);
        found = true;
      } else {
        currentPos += textLength;
        node = walker.nextNode();
      }
    }

    if (!found && element.childNodes.length > 0) {
      const lastNode = element.childNodes[element.childNodes.length - 1];
      if (lastNode.nodeType === Node.TEXT_NODE) {
        range.setStart(lastNode, lastNode.textContent?.length || 0);
        range.setEnd(lastNode, lastNode.textContent?.length || 0);
      } else {
        range.setStartAfter(lastNode);
        range.setEndAfter(lastNode);
      }
    }

    selection.removeAllRanges();
    selection.addRange(range);
  }

  private setContentEditableSelection(element: HTMLDivElement, start: number, end: number): void {
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    let currentPos = 0;
    let startSet = false;
    let endSet = false;

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);

    let node = walker.nextNode();
    while (node && (!startSet || !endSet)) {
      const textLength = node.textContent?.length || 0;

      if (!startSet && currentPos + textLength >= start) {
        range.setStart(node, start - currentPos);
        startSet = true;
      }

      if (!endSet && currentPos + textLength >= end) {
        range.setEnd(node, end - currentPos);
        endSet = true;
      }

      currentPos += textLength;
      node = walker.nextNode();
    }

    selection.removeAllRanges();
    selection.addRange(range);
  }
}
