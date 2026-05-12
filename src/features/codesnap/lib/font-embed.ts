// @ts-ignore – Vite asset-url import
import fontUrl from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url";

let cached: string | null = null;

async function fetchAsBase64(url: string): Promise<string> {
  const resp = await fetch(url);
  const buf = await resp.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(binary);
}

export async function getEmbeddedFontCss(): Promise<string> {
  if (cached !== null) return cached;
  const base64 = await fetchAsBase64(fontUrl);
  cached = `
@font-face {
  font-family: 'JetBrains Mono Variable';
  font-weight: 100 800;
  font-style: normal;
  src: url(data:font/woff2;base64,${base64}) format('woff2');
}
`;
  return cached;
}
