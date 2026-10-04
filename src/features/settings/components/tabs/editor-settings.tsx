import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { getAllLanguages } from "@/features/editor/utils/language-id";
import { setOutlineVisibilityPreference } from "@/features/outline/actions/outline-visibility";
import { getDefaultSetting } from "@/features/settings/config/default-settings";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import NumberInput from "@/ui/number-input";
import Section, { SettingsView, SettingRow } from "../settings-section";
import Select from "@/ui/select";
import Switch from "@/ui/switch";
import { FontSelector } from "../font-selector";

export const EditorSettings = () => {
  const settings = useSettingsStore(
    useShallow((state) => ({
      autoCompletion: state.settings.autoCompletion,
      autoDetectLanguage: state.settings.autoDetectLanguage,
      autoSave: state.settings.autoSave,
      breadcrumbShowSymbols: state.settings.breadcrumbShowSymbols,
      defaultLanguage: state.settings.defaultLanguage,
      editorBracketPairColorization: state.settings.editorBracketPairColorization,
      editorCursorBlinking: state.settings.editorCursorBlinking,
      editorCursorStyle: state.settings.editorCursorStyle,
      editorFontLigatures: state.settings.editorFontLigatures,
      editorItalicComments: state.settings.editorItalicComments,
      editorLineHeight: state.settings.editorLineHeight,
      editorScrollBeyondLastLine: state.settings.editorScrollBeyondLastLine,
      editorSmoothScrolling: state.settings.editorSmoothScrolling,
      editorStickyScroll: state.settings.editorStickyScroll,
      fontFamily: state.settings.fontFamily,
      fontSize: state.settings.fontSize,
      formatOnSave: state.settings.formatOnSave,
      highlightOccurrences: state.settings.highlightOccurrences,
      horizontalTabScroll: state.settings.horizontalTabScroll,
      codeLens: state.settings.codeLens,
      inlayHints: state.settings.inlayHints,
      lineNumbers: state.settings.lineNumbers,
      lintOnSave: state.settings.lintOnSave,
      maxOpenTabs: state.settings.maxOpenTabs,
      parameterHints: state.settings.parameterHints,
      renderIndentGuides: state.settings.renderIndentGuides,
      renderWhitespace: state.settings.renderWhitespace,
      semanticTokens: state.settings.semanticTokens,
      showMinimap: state.settings.showMinimap,
      showOutline: state.settings.showOutline,
      tabSize: state.settings.tabSize,
      vimRelativeLineNumbers: state.settings.vimRelativeLineNumbers,
      wordWrap: state.settings.wordWrap,
    })),
  );
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const languageOptions = useMemo(
    () => [
      { value: "auto", label: "Auto Detect" },
      ...getAllLanguages().map((language) => ({
        value: language.id,
        label: language.displayName,
      })),
    ],
    [],
  );
  const renderWhitespaceOptions = [
    { value: "none", label: "None" },
    { value: "boundary", label: "Boundary" },
    { value: "trailing", label: "Trailing" },
    { value: "all", label: "All" },
  ];
  return (
    <SettingsView>
      <Section title="Font">
        <SettingRow
          label="Font Family"
          control="select"
          onReset={() => updateSetting("fontFamily", getDefaultSetting("fontFamily"))}
          canReset={settings.fontFamily !== getDefaultSetting("fontFamily")}
        >
          <FontSelector
            value={settings.fontFamily}
            onChange={(fontFamily) => updateSetting("fontFamily", fontFamily)}
            monospaceOnly={true}
          />
        </SettingRow>
        <SettingRow
          label="Font Size"
          control="number"
          onReset={() => updateSetting("fontSize", getDefaultSetting("fontSize"))}
          canReset={settings.fontSize !== getDefaultSetting("fontSize")}
        >
          <NumberInput
            width="full"
            min="8"
            max="32"
            value={settings.fontSize}
            onChange={(val) => updateSetting("fontSize", val)}
          />
        </SettingRow>
        <SettingRow
          label="Line Height"
          control="number"
          onReset={() => updateSetting("editorLineHeight", getDefaultSetting("editorLineHeight"))}
          canReset={settings.editorLineHeight !== getDefaultSetting("editorLineHeight")}
        >
          <NumberInput
            width="full"
            min="1"
            max="2"
            step={0.1}
            value={settings.editorLineHeight}
            onChange={(val) => updateSetting("editorLineHeight", val)}
          />
        </SettingRow>
        <SettingRow
          label="Font Ligatures"
          onReset={() =>
            updateSetting("editorFontLigatures", getDefaultSetting("editorFontLigatures"))
          }
          canReset={settings.editorFontLigatures !== getDefaultSetting("editorFontLigatures")}
        >
          <Switch
            checked={settings.editorFontLigatures}
            onChange={(checked) => updateSetting("editorFontLigatures", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Italic Comments"
          onReset={() =>
            updateSetting("editorItalicComments", getDefaultSetting("editorItalicComments"))
          }
          canReset={settings.editorItalicComments !== getDefaultSetting("editorItalicComments")}
        >
          <Switch
            checked={settings.editorItalicComments}
            onChange={(checked) => updateSetting("editorItalicComments", checked)}
          />
        </SettingRow>
      </Section>
      <Section title="Display">
        <SettingRow
          label="Line Numbers"
          onReset={() => updateSetting("lineNumbers", getDefaultSetting("lineNumbers"))}
          canReset={settings.lineNumbers !== getDefaultSetting("lineNumbers")}
        >
          <Switch
            checked={settings.lineNumbers}
            onChange={(checked) => updateSetting("lineNumbers", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Relative Line Numbers"
          description="In Vim mode"
          onReset={() =>
            updateSetting("vimRelativeLineNumbers", getDefaultSetting("vimRelativeLineNumbers"))
          }
          canReset={settings.vimRelativeLineNumbers !== getDefaultSetting("vimRelativeLineNumbers")}
        >
          <Switch
            checked={settings.vimRelativeLineNumbers}
            onChange={(checked) => updateSetting("vimRelativeLineNumbers", checked)}
            disabled={!settings.lineNumbers}
          />
        </SettingRow>
        <SettingRow
          label="Word Wrap"
          onReset={() => updateSetting("wordWrap", getDefaultSetting("wordWrap"))}
          canReset={settings.wordWrap !== getDefaultSetting("wordWrap")}
        >
          <Switch
            checked={settings.wordWrap}
            onChange={(checked) => updateSetting("wordWrap", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Render Whitespace"
          control="select"
          onReset={() => updateSetting("renderWhitespace", getDefaultSetting("renderWhitespace"))}
          canReset={settings.renderWhitespace !== getDefaultSetting("renderWhitespace")}
        >
          <Select
            value={settings.renderWhitespace}
            options={renderWhitespaceOptions}
            onChange={(value) =>
              updateSetting("renderWhitespace", value as typeof settings.renderWhitespace)
            }
            variant="surface"
            width="full"
          />
        </SettingRow>
        <SettingRow
          label="Indent Guides"
          onReset={() =>
            updateSetting("renderIndentGuides", getDefaultSetting("renderIndentGuides"))
          }
          canReset={settings.renderIndentGuides !== getDefaultSetting("renderIndentGuides")}
        >
          <Switch
            checked={settings.renderIndentGuides}
            onChange={(checked) => updateSetting("renderIndentGuides", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Highlight Occurrences"
          onReset={() =>
            updateSetting("highlightOccurrences", getDefaultSetting("highlightOccurrences"))
          }
          canReset={settings.highlightOccurrences !== getDefaultSetting("highlightOccurrences")}
        >
          <Switch
            checked={settings.highlightOccurrences}
            onChange={(checked) => updateSetting("highlightOccurrences", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Bracket Pair Colorization"
          onReset={() =>
            updateSetting(
              "editorBracketPairColorization",
              getDefaultSetting("editorBracketPairColorization"),
            )
          }
          canReset={
            settings.editorBracketPairColorization !==
            getDefaultSetting("editorBracketPairColorization")
          }
        >
          <Switch
            checked={settings.editorBracketPairColorization}
            onChange={(checked) => updateSetting("editorBracketPairColorization", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Show Minimap"
          onReset={() => updateSetting("showMinimap", getDefaultSetting("showMinimap"))}
          canReset={settings.showMinimap !== getDefaultSetting("showMinimap")}
        >
          <Switch
            checked={settings.showMinimap}
            onChange={(checked) => updateSetting("showMinimap", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Show Outline"
          onReset={() => setOutlineVisibilityPreference(getDefaultSetting("showOutline"))}
          canReset={settings.showOutline !== getDefaultSetting("showOutline")}
        >
          <Switch checked={settings.showOutline} onChange={setOutlineVisibilityPreference} />
        </SettingRow>
        <SettingRow
          label="Sticky Scroll"
          onReset={() =>
            updateSetting("editorStickyScroll", getDefaultSetting("editorStickyScroll"))
          }
          canReset={settings.editorStickyScroll !== getDefaultSetting("editorStickyScroll")}
        >
          <Switch
            checked={settings.editorStickyScroll}
            onChange={(checked) => updateSetting("editorStickyScroll", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Show Symbol in Breadcrumb"
          onReset={() =>
            updateSetting("breadcrumbShowSymbols", getDefaultSetting("breadcrumbShowSymbols"))
          }
          canReset={settings.breadcrumbShowSymbols !== getDefaultSetting("breadcrumbShowSymbols")}
        >
          <Switch
            checked={settings.breadcrumbShowSymbols}
            onChange={(checked) => updateSetting("breadcrumbShowSymbols", checked)}
          />
        </SettingRow>
      </Section>
      <Section title="Cursor and Scrolling">
        <SettingRow
          label="Cursor Style"
          control="select"
          onReset={() => updateSetting("editorCursorStyle", getDefaultSetting("editorCursorStyle"))}
          canReset={settings.editorCursorStyle !== getDefaultSetting("editorCursorStyle")}
        >
          <Select
            value={settings.editorCursorStyle}
            options={[
              { value: "line", label: "Line" },
              { value: "line-thin", label: "Thin Line" },
              { value: "block", label: "Block" },
              { value: "block-outline", label: "Block Outline" },
              { value: "underline", label: "Underline" },
              { value: "underline-thin", label: "Thin Underline" },
            ]}
            onChange={(value) =>
              updateSetting("editorCursorStyle", value as typeof settings.editorCursorStyle)
            }
            variant="surface"
            width="full"
          />
        </SettingRow>
        <SettingRow
          label="Cursor Blinking"
          control="select"
          onReset={() =>
            updateSetting("editorCursorBlinking", getDefaultSetting("editorCursorBlinking"))
          }
          canReset={settings.editorCursorBlinking !== getDefaultSetting("editorCursorBlinking")}
        >
          <Select
            value={settings.editorCursorBlinking}
            options={[
              { value: "blink", label: "Blink" },
              { value: "smooth", label: "Smooth" },
              { value: "phase", label: "Phase" },
              { value: "expand", label: "Expand" },
              { value: "solid", label: "Solid" },
            ]}
            onChange={(value) =>
              updateSetting("editorCursorBlinking", value as typeof settings.editorCursorBlinking)
            }
            variant="surface"
            width="full"
          />
        </SettingRow>
        <SettingRow
          label="Smooth Scrolling"
          onReset={() =>
            updateSetting("editorSmoothScrolling", getDefaultSetting("editorSmoothScrolling"))
          }
          canReset={settings.editorSmoothScrolling !== getDefaultSetting("editorSmoothScrolling")}
        >
          <Switch
            checked={settings.editorSmoothScrolling}
            onChange={(checked) => updateSetting("editorSmoothScrolling", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Scroll Beyond Last Line"
          onReset={() =>
            updateSetting(
              "editorScrollBeyondLastLine",
              getDefaultSetting("editorScrollBeyondLastLine"),
            )
          }
          canReset={
            settings.editorScrollBeyondLastLine !== getDefaultSetting("editorScrollBeyondLastLine")
          }
        >
          <Switch
            checked={settings.editorScrollBeyondLastLine}
            onChange={(checked) => updateSetting("editorScrollBeyondLastLine", checked)}
          />
        </SettingRow>
      </Section>
      <Section title="Tabs and Files">
        <SettingRow
          label="Tab Size"
          control="number"
          onReset={() => updateSetting("tabSize", getDefaultSetting("tabSize"))}
          canReset={settings.tabSize !== getDefaultSetting("tabSize")}
        >
          <NumberInput
            width="full"
            min="1"
            max="8"
            value={settings.tabSize}
            onChange={(val) => updateSetting("tabSize", val)}
          />
        </SettingRow>
        <SettingRow
          label="Max Open Tabs"
          control="number"
          onReset={() => updateSetting("maxOpenTabs", getDefaultSetting("maxOpenTabs"))}
          canReset={settings.maxOpenTabs !== getDefaultSetting("maxOpenTabs")}
        >
          <NumberInput
            width="full"
            min="1"
            max="100"
            value={settings.maxOpenTabs}
            onChange={(val) => updateSetting("maxOpenTabs", val)}
          />
        </SettingRow>
        <SettingRow
          label="Buffer Carousel"
          onReset={() =>
            updateSetting("horizontalTabScroll", getDefaultSetting("horizontalTabScroll"))
          }
          canReset={settings.horizontalTabScroll !== getDefaultSetting("horizontalTabScroll")}
        >
          <Switch
            checked={settings.horizontalTabScroll}
            onChange={(checked) => updateSetting("horizontalTabScroll", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Auto Save"
          onReset={() => updateSetting("autoSave", getDefaultSetting("autoSave"))}
          canReset={settings.autoSave !== getDefaultSetting("autoSave")}
        >
          <Switch
            checked={settings.autoSave}
            onChange={(checked) => updateSetting("autoSave", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Default Language"
          control="select"
          onReset={() => updateSetting("defaultLanguage", getDefaultSetting("defaultLanguage"))}
          canReset={settings.defaultLanguage !== getDefaultSetting("defaultLanguage")}
        >
          <Select
            value={settings.defaultLanguage}
            options={languageOptions}
            onChange={(value) => updateSetting("defaultLanguage", value)}
            variant="surface"
            width="full"
            searchable
            searchableTrigger="input"
          />
        </SettingRow>
        <SettingRow
          label="Auto-detect Language"
          onReset={() =>
            updateSetting("autoDetectLanguage", getDefaultSetting("autoDetectLanguage"))
          }
          canReset={settings.autoDetectLanguage !== getDefaultSetting("autoDetectLanguage")}
        >
          <Switch
            checked={settings.autoDetectLanguage}
            onChange={(checked) => updateSetting("autoDetectLanguage", checked)}
          />
        </SettingRow>
      </Section>
      <Section title="Language Features">
        <SettingRow
          label="Format on Save"
          onReset={() => updateSetting("formatOnSave", getDefaultSetting("formatOnSave"))}
          canReset={settings.formatOnSave !== getDefaultSetting("formatOnSave")}
        >
          <Switch
            checked={settings.formatOnSave}
            onChange={(checked) => updateSetting("formatOnSave", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Lint on Save"
          onReset={() => updateSetting("lintOnSave", getDefaultSetting("lintOnSave"))}
          canReset={settings.lintOnSave !== getDefaultSetting("lintOnSave")}
        >
          <Switch
            checked={settings.lintOnSave}
            onChange={(checked) => updateSetting("lintOnSave", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Auto Completion"
          onReset={() => updateSetting("autoCompletion", getDefaultSetting("autoCompletion"))}
          canReset={settings.autoCompletion !== getDefaultSetting("autoCompletion")}
        >
          <Switch
            checked={settings.autoCompletion}
            onChange={(checked) => updateSetting("autoCompletion", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Parameter Hints"
          onReset={() => updateSetting("parameterHints", getDefaultSetting("parameterHints"))}
          canReset={settings.parameterHints !== getDefaultSetting("parameterHints")}
        >
          <Switch
            checked={settings.parameterHints}
            onChange={(checked) => updateSetting("parameterHints", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Inlay Hints"
          onReset={() => updateSetting("inlayHints", getDefaultSetting("inlayHints"))}
          canReset={settings.inlayHints !== getDefaultSetting("inlayHints")}
        >
          <Switch
            checked={settings.inlayHints}
            onChange={(checked) => updateSetting("inlayHints", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Code Lens"
          onReset={() => updateSetting("codeLens", getDefaultSetting("codeLens"))}
          canReset={settings.codeLens !== getDefaultSetting("codeLens")}
        >
          <Switch
            checked={settings.codeLens}
            onChange={(checked) => updateSetting("codeLens", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Semantic Tokens"
          onReset={() => updateSetting("semanticTokens", getDefaultSetting("semanticTokens"))}
          canReset={settings.semanticTokens !== getDefaultSetting("semanticTokens")}
        >
          <Switch
            checked={settings.semanticTokens}
            onChange={(checked) => updateSetting("semanticTokens", checked)}
          />
        </SettingRow>
      </Section>
    </SettingsView>
  );
};
