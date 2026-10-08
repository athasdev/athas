/** The offset where each line of `content` starts; a line starts after every `\n`. */
export function buildLineOffsets(content: string): number[] {
  const offsets = [0];
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) {
      offsets.push(index + 1);
    }
  }
  return offsets;
}
