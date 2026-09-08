import { useEffect, useState } from "react";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { Button } from "@/ui/button";
import { FieldDescription } from "@/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/ui/item";
import Select from "@/ui/select";
import type { WorkspaceSectionProps } from "./workspace-section-props";

export function WorkspaceExtensions({ config, onChange, reportError }: WorkspaceSectionProps) {
  const available = useExtensionStore.use.availableExtensions();
  const loading = useExtensionStore.use.isLoadingRegistry();
  const { loadInstalledExtensions, loadAvailableExtensions, installExtension, enableExtension } =
    useExtensionStore.use.actions();
  const [selected, setSelected] = useState("");
  const ids = config.recommendedExtensions ?? [];
  useEffect(() => {
    void loadInstalledExtensions().then(loadAvailableExtensions).catch(reportError);
  }, [loadInstalledExtensions, loadAvailableExtensions, reportError]);
  return (
    <div className="space-y-5">
      <FieldDescription>
        Recommend extensions for teammates. Installation is explicit and follows existing
        organization policies. Recommendations do not change personal settings automatically.
      </FieldDescription>
      {ids.map((id) => {
        const extension = available.get(id);
        const status = extension?.isInstalling
          ? "Installing…"
          : extension?.isInstalled
            ? extension.isEnabled
              ? "Installed and enabled"
              : "Installed, disabled"
            : extension
              ? "Not installed"
              : "Not found in the current catalog";
        return (
          <Item key={id} variant="muted">
            <ItemContent>
              <ItemTitle>{extension?.manifest.name ?? id}</ItemTitle>
              <ItemDescription>
                {id} · {status}
              </ItemDescription>
              {extension?.installError ? (
                <p role="alert" className="text-destructive ui-text-sm">
                  {extension.installError}
                </p>
              ) : null}
            </ItemContent>
            <ItemActions>
              <Button
                disabled={
                  !extension ||
                  extension.isInstalling ||
                  (extension.isInstalled && extension.isEnabled)
                }
                onClick={() =>
                  void (extension?.isInstalled ? enableExtension(id) : installExtension(id)).catch(
                    reportError,
                  )
                }
              >
                {extension?.isInstalled ? "Enable" : "Install"}
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  onChange({
                    ...config,
                    recommendedExtensions: ids.filter((entry) => entry !== id),
                  })
                }
              >
                Remove recommendation
              </Button>
            </ItemActions>
          </Item>
        );
      })}
      {!ids.length ? <FieldDescription>No extensions recommended yet.</FieldDescription> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Extension to recommend"
          width="full"
          searchable
          value={selected}
          onChange={setSelected}
          options={Array.from(available, ([id, extension]) => ({
            value: id,
            label: extension.manifest.name,
            keywords: [id],
          })).filter((option) => !ids.includes(option.value))}
          placeholder={loading ? "Loading extensions…" : "Choose an extension"}
        />
        <Button
          disabled={!selected || ids.includes(selected) || ids.length >= 100}
          onClick={() => {
            onChange({ ...config, recommendedExtensions: [...ids, selected] });
            setSelected("");
          }}
        >
          Recommend extension
        </Button>
        <Button
          variant="ghost"
          onClick={() => useBufferStore.getState().actions.openExtensionsBuffer()}
        >
          Browse marketplace
        </Button>
      </div>
    </div>
  );
}
