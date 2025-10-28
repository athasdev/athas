import { invoke } from "@tauri-apps/api/core";

export interface Token {
  start: number;
  end: number;
  token_type: string;
  class_name: string;
}

export async function getTokens(content: string, fileExtension: string): Promise<Token[]> {
  // Retry a few times to handle early calls during app startup when
  // the Tauri backend might not be ready yet.
  const maxAttempts = 5;
  let attempt = 0;
  // Normalize some common variants here too, as a safety net
  const normalize = (ext: string) => {
    const e = ext.toLowerCase();
    if (e === "mjs" || e === "cjs") return "js";
    if (e === "yml") return "yaml";
    if (e === "htm") return "html";
    if (e === "jsonc") return "json";
    if (e === "mdx") return "markdown";
    return e;
  };
  const ext = normalize(fileExtension);

  // Exponential backoff starting at 40ms
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await invoke<Token[]>("get_tokens", { content, fileExtension: ext });
    } catch (err) {
      attempt++;
      if (attempt >= maxAttempts) throw err;
      await sleep(40 * 2 ** (attempt - 1));
    }
  }
}
