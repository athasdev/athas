import { pickFile } from "@/utils/file-dialogs";
import type { ProviderConfig } from "../providers/provider-registry";

export function pickDatabaseFile(provider: ProviderConfig): Promise<string | null> {
  return pickFile({
    filters: [
      {
        name: provider.label,
        extensions: (provider.fileExtensions ?? []).map((extension) =>
          extension.replace(/^\./, ""),
        ),
      },
    ],
  });
}
