import { useEffect, useRef } from "react";
import { useSettingsPage } from "@/features/settings/hooks/use-settings-page";
import { SETTINGS_SEARCH_TAB_LABELS } from "@/features/settings/lib/settings-search";
import { Empty, EmptyDescription } from "@/ui/empty";
import { SidebarFilterBar, SidebarListItem, SidebarPanel, SidebarScrollArea } from "@/ui/sidebar";

/**
 * The Settings page's navigation, shown in the workbench sidebar while Settings is the active
 * tab. Lists the settings pages, or the matching settings while a search is typed.
 */
export function SettingsSidebar() {
  const {
    activeTab,
    visibleTabs,
    selectTab,
    searchQuery,
    setSearchQuery,
    searchResults,
    selectedResultId,
    openSearchResult,
  } = useSettingsPage();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isSearching = searchQuery.trim().length > 0;

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  return (
    <SidebarPanel data-slot="settings-sidebar">
      <SidebarFilterBar
        ref={searchInputRef}
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search settings"
        aria-label="Search settings"
        onKeyDown={(event) => {
          if (event.key === "Escape" && isSearching) {
            event.preventDefault();
            setSearchQuery("");
            return;
          }
          if (event.key !== "Enter") return;
          const firstResult = searchResults[0];
          if (!firstResult) return;
          event.preventDefault();
          openSearchResult(firstResult);
        }}
      />
      <SidebarScrollArea>
        {isSearching ? (
          searchResults.length > 0 ? (
            <div className="flex flex-col gap-0.5" role="list" aria-label="Matching settings">
              {searchResults.map((result) => (
                <SidebarListItem
                  key={result.id}
                  active={selectedResultId === result.id}
                  description={`${SETTINGS_SEARCH_TAB_LABELS[result.tab]} / ${result.section}`}
                  onClick={() => openSearchResult(result)}
                >
                  {result.label}
                </SidebarListItem>
              ))}
            </div>
          ) : (
            <Empty variant="inline" className="px-2 py-1.5">
              <EmptyDescription>No matching settings</EmptyDescription>
            </Empty>
          )
        ) : (
          <nav aria-label="Settings pages" className="flex flex-col gap-0.5">
            {visibleTabs.map((item) => {
              const Icon = item.icon;
              return (
                <SidebarListItem
                  key={item.id}
                  id={`settings-tab-${item.id}`}
                  active={activeTab === item.id}
                  leading={<Icon />}
                  aria-controls={`settings-panel-${item.id}`}
                  aria-current={activeTab === item.id ? "page" : undefined}
                  onClick={() => selectTab(item.id)}
                >
                  {item.label}
                </SidebarListItem>
              );
            })}
          </nav>
        )}
      </SidebarScrollArea>
    </SidebarPanel>
  );
}
