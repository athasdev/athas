import { tauriFetch } from "@/utils/tauri-fetch";

type TauriFetchOptions = Parameters<typeof tauriFetch>[1];
type TauriFetchResponse = Awaited<ReturnType<typeof tauriFetch>>;

export async function providerFetch(
  url: string,
  options?: TauriFetchOptions,
): Promise<TauriFetchResponse> {
  try {
    return await tauriFetch(url, options);
  } catch (error) {
    console.warn("Tauri HTTP fetch failed, retrying with browser fetch:", error);
    return (await fetch(url, options as RequestInit)) as TauriFetchResponse;
  }
}
