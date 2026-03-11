import { useWebViewerStore } from "@/features/web-viewer/stores/web-viewer-store";
import Dropdown from "@/ui/dropdown";
import NumberInput from "@/ui/number-input";
import Section, { SettingRow } from "@/ui/section";

const SEARCH_ENGINE_OPTIONS = [
  { value: "google", label: "Google" },
  { value: "duckduckgo", label: "DuckDuckGo" },
  { value: "bing", label: "Bing" },
];

export const WebViewerSettings = () => {
  const defaultHomePage = useWebViewerStore.use.defaultHomePage();
  const searchEngine = useWebViewerStore.use.searchEngine();
  const defaultZoom = useWebViewerStore.use.defaultZoom();
  const { updateSettings } = useWebViewerStore.use.actions();

  return (
    <div className="space-y-4">
      <Section title="General">
        <SettingRow
          label="Home Page"
          description="URL to open when clicking the home button. Leave empty for the new tab page."
        >
          <input
            type="text"
            value={defaultHomePage}
            onChange={(e) => updateSettings({ defaultHomePage: e.target.value })}
            placeholder="https://example.com"
            className="h-8 w-64 rounded border border-border bg-primary-bg px-2 text-sm text-text focus:border-accent focus:outline-none"
            aria-label="Default home page URL"
          />
        </SettingRow>

        <SettingRow
          label="Search Engine"
          description="Search engine used in the new tab page search bar."
        >
          <Dropdown
            value={searchEngine}
            options={SEARCH_ENGINE_OPTIONS}
            onChange={(value) => updateSettings({ searchEngine: value as "google" | "duckduckgo" | "bing" })}
          />
        </SettingRow>
      </Section>

      <Section title="Display">
        <SettingRow
          label="Default Zoom Level"
          description="Default zoom level for web pages (25% - 300%)."
        >
          <NumberInput
            value={Math.round(defaultZoom * 100)}
            min={25}
            max={300}
            step={10}
            onChange={(value) => updateSettings({ defaultZoom: value / 100 })}
            suffix="%"
          />
        </SettingRow>
      </Section>
    </div>
  );
};
