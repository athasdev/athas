export interface LspSemanticTokensResponse {
  /** The server's relative encoding: five integers per token. */
  data: Uint32Array;
  tokenTypes: string[];
  tokenModifiers: string[];
}

const HEADER_BYTES = 8;
const IS_LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Reads the binary payload of `lsp_get_semantic_tokens`: a little-endian header with the
 * token integer count and legend byte length, the token integers, then the legend as JSON.
 */
export function decodeSemanticTokensPayload(buffer: ArrayBuffer): LspSemanticTokensResponse {
  if (buffer.byteLength < HEADER_BYTES) throw new Error("Semantic token payload is truncated");

  const header = new DataView(buffer, 0, HEADER_BYTES);
  const integerCount = header.getUint32(0, true);
  const legendBytes = header.getUint32(4, true);
  const legendOffset = HEADER_BYTES + integerCount * 4;
  if (integerCount % 5 !== 0 || legendOffset + legendBytes > buffer.byteLength)
    throw new Error("Semantic token payload is malformed");

  let data: Uint32Array;
  if (IS_LITTLE_ENDIAN) {
    data = new Uint32Array(buffer, HEADER_BYTES, integerCount);
  } else {
    const view = new DataView(buffer, HEADER_BYTES, integerCount * 4);
    data = new Uint32Array(integerCount);
    for (let index = 0; index < integerCount; index += 1)
      data[index] = view.getUint32(index * 4, true);
  }

  const legend = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, legendOffset, legendBytes)),
  ) as { tokenTypes?: unknown; tokenModifiers?: unknown };

  return {
    data,
    tokenTypes: toStringArray(legend.tokenTypes),
    tokenModifiers: toStringArray(legend.tokenModifiers),
  };
}
