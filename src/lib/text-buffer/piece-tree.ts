/**
 * Piece Tree implementation for efficient text editing
 * Based on VS Code's piece tree data structure
 */

export interface Position {
  line: number;
  column: number;
  offset: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface TextChange {
  range: Range;
  text: string;
  rangeLength: number;
}

class Buffer {
  value: string;
  lineStarts: number[];

  constructor(value: string) {
    this.value = value;
    this.lineStarts = this.computeLineStarts(value);
  }

  private computeLineStarts(text: string): number[] {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") {
        lineStarts.push(i + 1);
      }
    }
    return lineStarts;
  }

  getLineCount(): number {
    return this.lineStarts.length;
  }

  getLineContent(lineNumber: number): string {
    if (lineNumber < 0 || lineNumber >= this.lineStarts.length) {
      return "";
    }

    const start = this.lineStarts[lineNumber];
    const end =
      lineNumber + 1 < this.lineStarts.length
        ? this.lineStarts[lineNumber + 1] - 1 // -1 to exclude the \n
        : this.value.length;

    return this.value.substring(start, end);
  }

  offsetToPosition(offset: number): Position {
    if (offset <= 0) {
      return { line: 0, column: 0, offset: 0 };
    }
    if (offset >= this.value.length) {
      const lastLine = this.lineStarts.length - 1;
      const lastLineStart = this.lineStarts[lastLine];
      return {
        line: lastLine,
        column: this.value.length - lastLineStart,
        offset: this.value.length,
      };
    }

    // Binary search for the line
    let low = 0;
    let high = this.lineStarts.length - 1;

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (this.lineStarts[mid] <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    const line = low;
    const column = offset - this.lineStarts[line];
    return { line, column, offset };
  }

  positionToOffset(position: Position): number {
    if (position.line < 0 || position.line >= this.lineStarts.length) {
      return 0;
    }

    const lineStart = this.lineStarts[position.line];
    return Math.min(lineStart + position.column, this.value.length);
  }
}

class BufferPosition {
  index: number; // index in PieceTable.buffers
  remainder: number; // offset within the buffer

  constructor(index: number, remainder: number) {
    this.index = index;
    this.remainder = remainder;
  }
}

class Piece {
  bufferIndex: number;
  start: BufferPosition;
  end: BufferPosition;
  length: number;
  lineFeedCount: number;

  constructor(
    bufferIndex: number,
    start: BufferPosition,
    end: BufferPosition,
    length: number,
    lineFeedCount: number,
  ) {
    this.bufferIndex = bufferIndex;
    this.start = start;
    this.end = end;
    this.length = length;
    this.lineFeedCount = lineFeedCount;
  }
}

// Red-Black Tree Node for efficient piece management
class TreeNode {
  piece: Piece;
  size: number; // total characters in this subtree
  lineFeedCount: number; // total line feeds in this subtree
  left: TreeNode | null = null;
  right: TreeNode | null = null;
  parent: TreeNode | null = null;
  color: "red" | "black" = "red";

  constructor(piece: Piece) {
    this.piece = piece;
    this.size = piece.length;
    this.lineFeedCount = piece.lineFeedCount;
  }
}

export class PieceTree {
  private buffers: Buffer[] = [];
  private root: TreeNode | null = null;
  private _length: number = 0;
  private _lineCount: number = 1;

  constructor(initialContent: string = "") {
    if (initialContent) {
      this.initialize(initialContent);
    }
  }

  private initialize(content: string): void {
    // Create original buffer
    const originalBuffer = new Buffer(content);
    this.buffers.push(originalBuffer);

    // Create initial piece covering the entire content
    const lineFeedCount = (content.match(/\n/g) || []).length;
    const piece = new Piece(
      0, // buffer index
      new BufferPosition(0, 0), // start
      new BufferPosition(0, content.length), // end
      content.length,
      lineFeedCount,
    );

    this.root = new TreeNode(piece);
    this.root.color = "black";
    this._length = content.length;
    this._lineCount = lineFeedCount + 1;
  }

  get length(): number {
    return this._length;
  }

  get lineCount(): number {
    return this._lineCount;
  }

  /**
   * Insert text at the specified offset
   */
  insert(offset: number, text: string): TextChange[] {
    if (text.length === 0) return [];

    // Create a new buffer for the inserted text
    const insertBuffer = new Buffer(text);
    const bufferIndex = this.buffers.length;
    this.buffers.push(insertBuffer);

    const lineFeedCount = (text.match(/\n/g) || []).length;
    const insertPiece = new Piece(
      bufferIndex,
      new BufferPosition(bufferIndex, 0),
      new BufferPosition(bufferIndex, text.length),
      text.length,
      lineFeedCount,
    );

    // Find the piece to split and perform the insertion
    const changes = this.insertPiece(offset, insertPiece);

    this._length += text.length;
    this._lineCount += lineFeedCount;

    return changes;
  }

  /**
   * Delete text in the specified range
   */
  delete(offset: number, length: number): TextChange[] {
    if (length === 0) return [];

    const changes = this.deletePieces(offset, length);

    // Update counters (this is simplified - should be calculated from actual deleted content)
    this._length -= length;

    return changes;
  }

  /**
   * Get the text content of a line
   */
  getLineContent(lineNumber: number): string {
    if (lineNumber < 0 || lineNumber >= this._lineCount) {
      return "";
    }

    // This is a simplified implementation
    // In a full implementation, we'd traverse the tree to find the line
    const fullText = this.getText();
    const lines = fullText.split("\n");
    return lines[lineNumber] || "";
  }

  /**
   * Get all text content (for compatibility with current implementation)
   */
  getText(): string {
    if (!this.root) return "";

    const pieces: string[] = [];
    this.inOrderTraversal(this.root, (node) => {
      const piece = node.piece;
      const buffer = this.buffers[piece.bufferIndex];
      const text = buffer.value.substring(piece.start.remainder, piece.end.remainder);
      pieces.push(text);
    });

    return pieces.join("");
  }

  /**
   * Convert offset to line/column position
   */
  offsetToPosition(offset: number): Position {
    // Simplified implementation - traverse tree to find position
    const text = this.getText();
    const buffer = new Buffer(text);
    return buffer.offsetToPosition(offset);
  }

  /**
   * Convert line/column position to offset
   */
  positionToOffset(position: Position): number {
    // Simplified implementation
    const text = this.getText();
    const buffer = new Buffer(text);
    return buffer.positionToOffset(position);
  }

  private insertPiece(offset: number, piece: Piece): TextChange[] {
    if (!this.root) {
      // Empty tree - just insert the piece as root
      this.root = new TreeNode(piece);
      this.root.color = "black";
      return [];
    }

    // Find the node where we need to insert
    const { node, nodeOffset } = this.findNodeAtOffset(offset);

    if (!node) {
      // Insert at the end
      this.insertNodeAtEnd(piece);
      return [];
    }

    const relativeOffset = offset - nodeOffset;

    if (relativeOffset === 0) {
      // Insert before this node
      this.insertNodeBefore(node, piece);
    } else if (relativeOffset === node.piece.length) {
      // Insert after this node
      this.insertNodeAfter(node, piece);
    } else {
      // Split the node and insert in the middle
      this.splitNodeAndInsert(node, relativeOffset, piece);
    }

    return [];
  }

  private deletePieces(offset: number, length: number): TextChange[] {
    if (length === 0 || !this.root) return [];

    const endOffset = offset + length;
    const nodesToDelete: TreeNode[] = [];
    const nodesToModify: { node: TreeNode; newPiece: Piece }[] = [];

    // Find all nodes that are affected by the deletion
    this.findNodesInRange(offset, endOffset, nodesToDelete, nodesToModify);

    // Remove nodes that are completely deleted
    nodesToDelete.forEach((node) => this.removeNode(node));

    // Modify nodes that are partially affected
    nodesToModify.forEach(({ node, newPiece }) => {
      node.piece = newPiece;
      node.size = newPiece.length;
      node.lineFeedCount = newPiece.lineFeedCount;
      this.updateNodeCounts(node);
    });

    return [];
  }

  /**
   * Find nodes in a range for deletion
   */
  private findNodesInRange(
    startOffset: number,
    endOffset: number,
    nodesToDelete: TreeNode[],
    nodesToModify: { node: TreeNode; newPiece: Piece }[],
  ): void {
    if (!this.root) return;

    const currentOffset = 0;
    this.traverseForDeletion(
      this.root,
      startOffset,
      endOffset,
      currentOffset,
      nodesToDelete,
      nodesToModify,
    );
  }

  /**
   * Traverse tree to find nodes affected by deletion
   */
  private traverseForDeletion(
    node: TreeNode,
    startOffset: number,
    endOffset: number,
    nodeOffset: number,
    nodesToDelete: TreeNode[],
    nodesToModify: { node: TreeNode; newPiece: Piece }[],
  ): void {
    const leftSize = node.left ? node.left.size : 0;
    const nodeStart = nodeOffset + leftSize;
    const nodeEnd = nodeStart + node.piece.length;

    // Check if this node is affected by the deletion
    if (nodeEnd > startOffset && nodeStart < endOffset) {
      if (nodeStart >= startOffset && nodeEnd <= endOffset) {
        // Node is completely within deletion range
        nodesToDelete.push(node);
      } else {
        // Node is partially affected - need to modify it
        const buffer = this.buffers[node.piece.bufferIndex];
        const pieceStart = node.piece.start.remainder;
        const pieceEnd = node.piece.end.remainder;

        let newStart = pieceStart;
        let newEnd = pieceEnd;

        if (nodeStart < startOffset) {
          // Keep the part before deletion
          newEnd = pieceStart + (startOffset - nodeStart);
        }

        if (nodeEnd > endOffset) {
          // Keep the part after deletion
          newStart = pieceStart + (endOffset - nodeStart);
        }

        if (newStart < newEnd) {
          const newLength = newEnd - newStart;
          const newPiece = new Piece(
            node.piece.bufferIndex,
            new BufferPosition(node.piece.bufferIndex, newStart),
            new BufferPosition(node.piece.bufferIndex, newEnd),
            newLength,
            this.countLineFeeds(buffer.value, newStart, newLength),
          );

          nodesToModify.push({ node, newPiece });
        } else {
          nodesToDelete.push(node);
        }
      }
    }

    // Recursively check children
    if (node.left && nodeStart > startOffset) {
      this.traverseForDeletion(
        node.left,
        startOffset,
        endOffset,
        nodeOffset,
        nodesToDelete,
        nodesToModify,
      );
    }

    if (node.right && nodeEnd < endOffset) {
      this.traverseForDeletion(
        node.right,
        startOffset,
        endOffset,
        nodeEnd,
        nodesToDelete,
        nodesToModify,
      );
    }
  }

  /**
   * Remove a node from the tree
   */
  private removeNode(node: TreeNode): void {
    // This is a simplified removal - a full implementation would handle
    // red-black tree deletion with proper rebalancing

    if (!node.left && !node.right) {
      // Leaf node
      if (node.parent) {
        if (node.parent.left === node) {
          node.parent.left = null;
        } else {
          node.parent.right = null;
        }
        this.updateNodeCounts(node.parent);
      } else {
        this.root = null;
      }
    } else if (!node.left || !node.right) {
      // Node with one child
      const child = node.left || node.right;
      if (child) {
        child.parent = node.parent;
      }

      if (node.parent) {
        if (node.parent.left === node) {
          node.parent.left = child;
        } else {
          node.parent.right = child;
        }
        this.updateNodeCounts(node.parent);
      } else {
        this.root = child;
      }
    } else {
      // Node with two children - replace with successor
      const successor = this.findMinNode(node.right);
      if (successor) {
        node.piece = successor.piece;
        node.size = successor.size;
        node.lineFeedCount = successor.lineFeedCount;
        this.removeNode(successor);
      }
    }
  }

  /**
   * Find the minimum node in a subtree
   */
  private findMinNode(node: TreeNode): TreeNode {
    while (node.left) {
      node = node.left;
    }
    return node;
  }

  private inOrderTraversal(node: TreeNode | null, callback: (node: TreeNode) => void): void {
    if (!node) return;

    this.inOrderTraversal(node.left, callback);
    callback(node);
    this.inOrderTraversal(node.right, callback);
  }

  /**
   * Find the node containing the given offset
   */
  private findNodeAtOffset(offset: number): { node: TreeNode | null; nodeOffset: number } {
    if (!this.root) return { node: null, nodeOffset: 0 };

    let current: TreeNode | null = this.root;
    let currentOffset = 0;

    while (current) {
      const leftSize = current.left ? current.left.size : 0;
      const nodeStart = currentOffset + leftSize;
      const nodeEnd = nodeStart + current.piece.length;

      if (offset >= nodeStart && offset <= nodeEnd) {
        return { node: current, nodeOffset: nodeStart };
      }

      if (offset < nodeStart) {
        current = current.left;
      } else {
        currentOffset = nodeEnd;
        current = current.right;
      }
    }

    return { node: null, nodeOffset: currentOffset };
  }

  /**
   * Update size and line count for a node and all its ancestors
   */
  private updateNodeCounts(node: TreeNode): void {
    let current: TreeNode | null = node;

    while (current) {
      current.size = current.piece.length;
      current.lineFeedCount = current.piece.lineFeedCount;

      if (current.left) {
        current.size += current.left.size;
        current.lineFeedCount += current.left.lineFeedCount;
      }

      if (current.right) {
        current.size += current.right.size;
        current.lineFeedCount += current.right.lineFeedCount;
      }

      current = current.parent;
    }
  }

  /**
   * Fix red-black tree properties after insertion
   */
  private fixInsert(node: TreeNode): void {
    while (node.parent && node.parent.color === "red") {
      if (node.parent === node.parent.parent?.left) {
        const uncle = node.parent.parent.right;

        if (uncle && uncle.color === "red") {
          // Case 1: Uncle is red
          node.parent.color = "black";
          uncle.color = "black";
          node.parent.parent.color = "red";
          node = node.parent.parent;
        } else {
          // Case 2 & 3: Uncle is black
          if (node === node.parent.right) {
            node = node.parent;
            this.rotateLeft(node);
          }

          if (node.parent) {
            node.parent.color = "black";
            if (node.parent.parent) {
              node.parent.parent.color = "red";
              this.rotateRight(node.parent.parent);
            }
          }
        }
      } else {
        // Mirror case
        const uncle = node.parent.parent?.left;

        if (uncle && uncle.color === "red") {
          node.parent.color = "black";
          uncle.color = "black";
          if (node.parent.parent) {
            node.parent.parent.color = "red";
            node = node.parent.parent;
          }
        } else {
          if (node === node.parent.left) {
            node = node.parent;
            this.rotateRight(node);
          }

          if (node.parent) {
            node.parent.color = "black";
            if (node.parent.parent) {
              node.parent.parent.color = "red";
              this.rotateLeft(node.parent.parent);
            }
          }
        }
      }
    }

    if (this.root) {
      this.root.color = "black";
    }
  }

  /**
   * Insert a new piece before the given node
   */
  private insertNodeBefore(node: TreeNode, piece: Piece): void {
    const newNode = new TreeNode(piece);

    if (!node.left) {
      node.left = newNode;
      newNode.parent = node;
    } else {
      // Find the rightmost node in the left subtree
      let rightmost = node.left;
      while (rightmost.right) {
        rightmost = rightmost.right;
      }
      rightmost.right = newNode;
      newNode.parent = rightmost;
    }

    this.updateNodeCounts(newNode);
    this.fixInsert(newNode);
  }

  /**
   * Insert a new piece after the given node
   */
  private insertNodeAfter(node: TreeNode, piece: Piece): void {
    const newNode = new TreeNode(piece);

    if (!node.right) {
      node.right = newNode;
      newNode.parent = node;
    } else {
      // Find the leftmost node in the right subtree
      let leftmost = node.right;
      while (leftmost.left) {
        leftmost = leftmost.left;
      }
      leftmost.left = newNode;
      newNode.parent = leftmost;
    }

    this.updateNodeCounts(newNode);
    this.fixInsert(newNode);
  }

  /**
   * Insert a new piece at the end of the tree
   */
  private insertNodeAtEnd(piece: Piece): void {
    if (!this.root) {
      this.root = new TreeNode(piece);
      this.root.color = "black";
      return;
    }

    // Find the rightmost node
    let current = this.root;
    while (current.right) {
      current = current.right;
    }

    const newNode = new TreeNode(piece);
    current.right = newNode;
    newNode.parent = current;

    this.updateNodeCounts(newNode);
    this.fixInsert(newNode);
  }

  /**
   * Split a node at the given offset and insert a piece
   */
  private splitNodeAndInsert(node: TreeNode, offset: number, piece: Piece): void {
    const originalPiece = node.piece;
    const buffer = this.buffers[originalPiece.bufferIndex];

    // Create left piece (before split)
    const leftPiece = new Piece(
      originalPiece.bufferIndex,
      originalPiece.start,
      new BufferPosition(originalPiece.bufferIndex, originalPiece.start.remainder + offset),
      offset,
      this.countLineFeeds(buffer.value, originalPiece.start.remainder, offset),
    );

    // Create right piece (after split)
    const rightStart = originalPiece.start.remainder + offset;
    const rightLength = originalPiece.length - offset;
    const rightPiece = new Piece(
      originalPiece.bufferIndex,
      new BufferPosition(originalPiece.bufferIndex, rightStart),
      originalPiece.end,
      rightLength,
      this.countLineFeeds(buffer.value, rightStart, rightLength),
    );

    // Update current node with left piece
    node.piece = leftPiece;
    node.size = leftPiece.length;
    node.lineFeedCount = leftPiece.lineFeedCount;

    // Insert the new piece after current node
    this.insertNodeAfter(node, piece);

    // Insert the right piece after the new piece
    const newNode = this.findNodeWithPiece(piece);
    if (newNode) {
      this.insertNodeAfter(newNode, rightPiece);
    }
  }

  /**
   * Count line feeds in a buffer range
   */
  private countLineFeeds(text: string, start: number, length: number): number {
    let count = 0;
    const end = start + length;
    for (let i = start; i < end && i < text.length; i++) {
      if (text[i] === "\n") {
        count++;
      }
    }
    return count;
  }

  /**
   * Find a node containing a specific piece
   */
  private findNodeWithPiece(piece: Piece): TreeNode | null {
    if (!this.root) return null;

    const stack: TreeNode[] = [this.root];

    while (stack.length > 0) {
      const node = stack.pop()!;

      if (node.piece === piece) {
        return node;
      }

      if (node.left) stack.push(node.left);
      if (node.right) stack.push(node.right);
    }

    return null;
  }

  /**
   * Rotate left around a node
   */
  private rotateLeft(node: TreeNode): void {
    const right = node.right;
    if (!right) return;

    node.right = right.left;
    if (right.left) {
      right.left.parent = node;
    }

    right.parent = node.parent;
    if (!node.parent) {
      this.root = right;
    } else if (node === node.parent.left) {
      node.parent.left = right;
    } else {
      node.parent.right = right;
    }

    right.left = node;
    node.parent = right;

    this.updateNodeCounts(node);
    this.updateNodeCounts(right);
  }

  /**
   * Rotate right around a node
   */
  private rotateRight(node: TreeNode): void {
    const left = node.left;
    if (!left) return;

    node.left = left.right;
    if (left.right) {
      left.right.parent = node;
    }

    left.parent = node.parent;
    if (!node.parent) {
      this.root = left;
    } else if (node === node.parent.right) {
      node.parent.right = left;
    } else {
      node.parent.left = left;
    }

    left.right = node;
    node.parent = left;

    this.updateNodeCounts(node);
    this.updateNodeCounts(left);
  }

  /**
   * Get text in a specific range
   */
  getTextInRange(start: number, end: number): string {
    const fullText = this.getText();
    return fullText.substring(start, end);
  }

  /**
   * Get all lines as an array
   */
  getLines(): string[] {
    return this.getText().split("\n");
  }

  /**
   * Replace text in a range
   */
  replace(start: number, end: number, text: string): TextChange[] {
    const deleteLength = end - start;
    const changes: TextChange[] = [];

    if (deleteLength > 0) {
      changes.push(...this.delete(start, deleteLength));
    }

    if (text.length > 0) {
      changes.push(...this.insert(start, text));
    }

    return changes;
  }
}
