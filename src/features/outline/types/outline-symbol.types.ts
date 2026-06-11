export interface OutlineSymbol {
  id: string;
  name: string;
  kind: string;
  detail?: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  containerName?: string;
  filePath: string;
  depth: number;
  parentId?: string;
  childCount: number;
  isLastChild: boolean;
}
