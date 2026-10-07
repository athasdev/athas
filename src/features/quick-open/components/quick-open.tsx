import Command, {
  CommandFooter,
  CommandHeader,
  CommandHeaderBadge,
  CommandInput,
  CommandList,
  CommandTabs,
} from "@/ui/command";
import { Kbd, KbdGroup } from "@/ui/kbd";
import { QUICK_OPEN_SECTIONS } from "../constants/quick-open-sections";
import { useQuickOpen } from "../hooks/use-quick-open";
import { QuickOpenItemRow } from "./quick-open-item-row";

const PREFIX_HINTS = QUICK_OPEN_SECTIONS.filter((section) => section.prefix);

const QuickOpen = () => {
  const {
    isVisible,
    section,
    changeSection,
    query,
    changeQuery,
    inputRef,
    handleKeyDown,
    scrollContainerRef,
    onClose,
    result,
    selectedIndex,
    setSelectedIndex,
  } = useQuickOpen();

  if (!isVisible) {
    return null;
  }

  return (
    <Command isVisible={isVisible} onClose={onClose} title="Quick Open">
      <CommandHeader onClose={onClose}>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={changeQuery}
          onKeyDown={handleKeyDown}
          aria-label={`Search ${section.label.toLowerCase()}`}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="quick-open-results"
          aria-activedescendant={
            selectedIndex < result.items.length ? `quick-open-option-${selectedIndex}` : undefined
          }
          placeholder={section.placeholder}
        />
        {result.isLoading ? (
          <CommandHeaderBadge>...</CommandHeaderBadge>
        ) : result.summary ? (
          <CommandHeaderBadge>{result.summary}</CommandHeaderBadge>
        ) : null}
      </CommandHeader>

      <CommandTabs
        ariaLabel="Search in"
        className="pb-1"
        items={QUICK_OPEN_SECTIONS.map((candidate) => ({
          id: candidate.id,
          label: candidate.label,
          icon: candidate.icon,
          isActive: candidate.id === section.id,
          onSelect: () => changeSection(candidate.id),
        }))}
      />

      <CommandList
        ref={scrollContainerRef}
        id="quick-open-results"
        role="listbox"
        aria-label={`${section.label} results`}
        aria-busy={result.isLoading}
      >
        {result.items.length === 0
          ? result.empty
          : result.items.map((item, index) => (
              <QuickOpenItemRow
                key={item.key}
                item={item}
                index={index}
                isSelected={index === selectedIndex}
                onHover={setSelectedIndex}
              />
            ))}
      </CommandList>

      <CommandFooter>
        <div className="ui-text-caption flex w-full items-center gap-3 px-1 text-subtle-foreground">
          <KbdGroup>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span>Navigate</span>
          </KbdGroup>
          <KbdGroup>
            <Kbd>↵</Kbd>
            <span>Open</span>
          </KbdGroup>
          <KbdGroup>
            <Kbd>Tab</Kbd>
            <span>Switch section</span>
          </KbdGroup>
          <KbdGroup className="ml-auto">
            {PREFIX_HINTS.map((hint) => (
              <span key={hint.id} className="inline-flex items-center gap-1">
                <Kbd>{hint.prefix}</Kbd>
                <span>{hint.label}</span>
              </span>
            ))}
          </KbdGroup>
        </div>
      </CommandFooter>
    </Command>
  );
};

export default QuickOpen;
