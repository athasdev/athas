<!-- 46127466-0c53-4b5c-bae7-6265d5c0c40c 17e01acf-dc96-4bb1-8e30-893a71c74ea3 -->
# Fix Scrollbar Styling for Editor and Modals

## Problem

White scrollbars appear in the editor and modals, breaking the theme consistency. The issue stems from:

1. Hardcoded light colors in textarea scrollbar styles (lines 796-820 in `src/styles.css`)
2. Generic overflow elements not using theme-aware scrollbar classes
3. Inconsistent scrollbar styling across components

## Solution

### 1. Fix Global Textarea Scrollbar Styling

**File:** `src/styles.css` (lines 795-820)

Replace the hardcoded colors:

```css
textarea {
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) var(--color-secondary-bg);
}

textarea::-webkit-scrollbar {
    width: 12px;
}

textarea::-webkit-scrollbar-track {
    background: var(--color-secondary-bg);
}

textarea::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 6px;
}

textarea::-webkit-scrollbar-thumb:hover {
    background: var(--color-text-lighter);
}
```

### 2. Add Global Overflow Auto Scrollbar Styling

**File:** `src/styles.css` (after line 820)

Add theme-aware styling for all overflow elements:

```css
/* Theme-aware scrollbars for all overflow elements */
[class*="overflow-auto"],
.overflow-auto,
[class*="overflow-y-auto"],
.overflow-y-auto,
[class*="overflow-x-auto"],
.overflow-x-auto {
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) var(--color-secondary-bg);
}

[class*="overflow-auto"]::-webkit-scrollbar,
.overflow-auto::-webkit-scrollbar,
[class*="overflow-y-auto"]::-webkit-scrollbar,
.overflow-y-auto::-webkit-scrollbar,
[class*="overflow-x-auto"]::-webkit-scrollbar,
.overflow-x-auto::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}

[class*="overflow-auto"]::-webkit-scrollbar-track,
.overflow-auto::-webkit-scrollbar-track,
[class*="overflow-y-auto"]::-webkit-scrollbar-track,
.overflow-y-auto::-webkit-scrollbar-track,
[class*="overflow-x-auto"]::-webkit-scrollbar-track,
.overflow-x-auto::-webkit-scrollbar-track {
    background: var(--color-secondary-bg);
}

[class*="overflow-auto"]::-webkit-scrollbar-thumb,
.overflow-auto::-webkit-scrollbar-thumb,
[class*="overflow-y-auto"]::-webkit-scrollbar-thumb,
.overflow-y-auto::-webkit-scrollbar-thumb,
[class*="overflow-x-auto"]::-webkit-scrollbar-thumb,
.overflow-x-auto::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 4px;
}

[class*="overflow-auto"]::-webkit-scrollbar-thumb:hover,
.overflow-auto::-webkit-scrollbar-thumb:hover,
[class*="overflow-y-auto"]::-webkit-scrollbar-thumb:hover,
.overflow-y-auto::-webkit-scrollbar-thumb:hover,
[class*="overflow-x-auto"]::-webkit-scrollbar-thumb:hover,
.overflow-x-auto::-webkit-scrollbar-thumb:hover {
    background: var(--color-text-lighter);
}

[class*="overflow-auto"]::-webkit-scrollbar-corner,
.overflow-auto::-webkit-scrollbar-corner,
[class*="overflow-y-auto"]::-webkit-scrollbar-corner,
.overflow-y-auto::-webkit-scrollbar-corner,
[class*="overflow-x-auto"]::-webkit-scrollbar-corner,
.overflow-x-auto::-webkit-scrollbar-corner {
    background: var(--color-secondary-bg);
}
```

### 3. Update Modal Scrollbar Styling

**File:** `src/components/ai-chat/chat-history-modal.tsx` (line 49)

Change from:

```tsx
<div className="max-h-[50vh] overflow-y-auto">
```

To:

```tsx
<div className="custom-scrollbar max-h-[50vh] overflow-y-auto">
```

### 4. Update Editor Container

**File:** `src/components/editor/code-editor.tsx` (lines 277-287)

Keep scrollbars hidden for editor (this is correct behavior), but ensure no white scrollbars leak through by adding explicit webkit rules in the inline style or ensuring the CSS from `editor-stylesheet.tsx` applies properly.

## Files to Modify

1. `src/styles.css` - Update global scrollbar styling (lines 796-828)
2. `src/components/ai-chat/chat-history-modal.tsx` - Add custom-scrollbar class (line 49)
3. Other modal components will automatically inherit the global overflow styling from step 2

## Expected Result

All scrollbars throughout the application (editor, modals, dropdowns, lists) will:

- Use theme colors (border color for thumb, secondary bg for track)
- Match the current theme (light or dark)
- Have consistent width (8px) and styling
- Eliminate white scrollbars completely

### To-dos

- [ ] Update textarea scrollbar styles to use CSS variables instead of hardcoded colors in src/styles.css
- [ ] Add comprehensive scrollbar styling for all overflow-auto, overflow-y-auto, and overflow-x-auto classes in src/styles.css
- [ ] Add custom-scrollbar class to chat-history-modal.tsx overflow container
- [ ] Verify editor scrollbars remain hidden and no white scrollbars appear