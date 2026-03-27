# Athas AI Chat UI Revamp Prompts

Use this file when handing Athas's AI chat redesign to another agent or design system.

The goal is not "make it a bit prettier."
The goal is:

- replace the current heavy, control-panel-feeling chat UI
- make the chat feel much closer to t3 chat products in layout priority
- keep Athas functionality and Pi-native behavior intact
- make the conversation and composer feel like the product

## 1. Target UI Prompt

Use this when you want an agent or UI system to understand what the Athas AI chat should feel like.

```md
Redesign Athas's AI chat UI to feel much closer to pingdotgg/t3code in layout priority, polish, and user experience, while still staying Athas-native.

This is not a small restyle. It should be a real recomposition of the chat surface.

## Product Context

Athas is a desktop coding workspace built with Tauri + React. It has an AI chat surface used in two places:
- Harness: the main full chat workspace
- Panel chat: a smaller embedded chat surface

The current AI chat feels too heavy, too chrome-filled, too control-panel-like, and too fragmented. There is too much competing UI: metadata pills, rails, status chrome, controls, and boxed sections. It does not feel like a focused conversation product.

## Design Goal

Make the AI chat feel:
- calmer
- sharper
- more premium
- more intentional
- more conversation-first
- more composer-centered
- much closer to t3code's hierarchy and product feel

The UI should feel like:
- one dominant conversation column
- a quiet shell
- a strong bottom composer card
- minimal persistent chrome
- roomy message rhythm
- clear but subtle controls

## What To Change

### Layout

- Make the conversation column the clear center of gravity.
- Remove the sense that the UI is split between transcript, rail, status tray, and footer toolbar.
- Reduce or hide secondary navigation by default.
- The right session rail should not dominate the screen.
- The top bar should be much quieter and lighter.
- The composer should visually anchor the entire product.

### Header

- Strip the header down hard.
- Keep only the most important information visible.
- Avoid multiple loud metadata pills.
- Avoid making the header feel like a dashboard or IDE toolbar.
- Title and a very small amount of context is enough.

### Messages

- Messages should breathe more.
- Reduce boxiness and over-framing.
- Assistant content should feel readable and editorial, not like terminal logs in boxes.
- User messages should be clear and tasteful, not oversized pills or clunky blobs.
- Tooling/runtime artifacts should be visually subordinate to the core conversation.

### Composer

- The composer should be the strongest visual object on the page.
- It should feel like a premium chat input card, not a footer tray.
- Controls for agent, mode, model, thinking, context, slash commands, and send should feel integrated into the composer.
- Keep the controls visible enough for power use, but much cleaner and more tucked in.
- Permission and input requests should appear composer-adjacent, not as random noisy blocks in the transcript.

### Session Navigation

- Session navigation should still exist, but it should feel secondary.
- Do not let the right rail or session chrome overpower the conversation.
- Use a lighter, quieter navigation treatment.
- On narrower layouts, collapse secondary elements more aggressively.

### Visual Style

- Match more of t3code's layout instincts:
  - dominant central column
  - quieter dark surfaces
  - subtle layering
  - strong rounded composer
  - light header chrome
  - clean spacing rhythm
- Do not copy branding directly.
- Keep it adapted to Athas's theme variables and desktop-app context.
- Avoid "AI slop" dark dashboard design.
- Avoid making everything a rounded border box.
- Avoid excessive pills, badges, dividers, and status labels.

## Constraints

- Preserve existing runtime behavior.
- Do not break Pi-native flows.
- Do not remove important capabilities, only redesign how they are presented.
- Keep both Harness and panel chat in the same design language.
- Harness can be richer, but panel chat should feel like the same product.

## Success Criteria

The redesign is successful if:
- the first impression is "this feels like a serious chat product now"
- the conversation is the main thing you notice
- the composer feels premium and central
- the UI feels less like an IDE control panel
- the overall feel is clearly closer to t3code than to the current Athas chat

The redesign is not successful if it feels like:
- the same UI with slightly different padding
- a dashboard with chat inside it
- a pile of rounded bordered boxes
- a busy right rail plus a busy header plus a busy composer
```

## 2. Execution Prompt For Another Agent

Use this when you want another coding agent to actually fix the UI.

```md
Fix Athas's AI chat UI properly.

The current redesign attempt is not good enough. It is still too chrome-heavy, too boxed-in, and too much like an IDE control surface with a chat bolted into it. I do not want another incremental "tidy up the existing layout" pass. I want a much more decisive recomposition of the chat UI.

## Reference Direction

Study the layout priorities and feel of:
- https://github.com/pingdotgg/t3code

Do not clone it blindly, but do use it as the main benchmark for:
- hierarchy
- density
- composer prominence
- message rhythm
- header quietness
- session/navigation restraint

## What You Must Do

Redesign Athas's AI chat to be much closer to t3code in structure and feel while preserving Athas functionality.

This is a frontend shell refactor, not a backend/runtime project.

## Required Outcomes

1. Make the conversation the dominant center column.
2. Make the composer feel like the primary product surface.
3. Dramatically reduce persistent chrome in the header.
4. Demote the right rail so it supports the chat instead of competing with it.
5. Make message presentation cleaner, roomier, and less box-heavy.
6. Keep runtime controls usable, but integrate them into the composer more elegantly.
7. Keep Harness and panel chat in one coherent design language.

## Important Constraints

- Preserve existing AI runtime behavior.
- Do not break Pi-native restore/send/respond/permission flows.
- Do not remove session functionality.
- Do not remove model/mode/thinking/context controls.
- Re-present them better.
- Use existing theme variables.
- No new dependencies without approval.
- Use bun.
- Use apply_patch for manual edits.
- Commit in micro-chunks with conventional commits, first character uppercase.
- Push after each commit.

## Files To Start From

These are the main surfaces to rethink:
- src/features/ai/components/chat/ai-chat.tsx
- src/features/ai/components/chat/chat-header.tsx
- src/features/ai/components/chat/chat-messages.tsx
- src/features/ai/components/chat/chat-message.tsx
- src/features/ai/components/input/chat-input-bar.tsx
- src/features/ai/components/chat/harness-session-rail.tsx
- src/features/ai/components/selectors/chat-mode-selector.tsx
- src/features/ai/components/selectors/unified-agent-selector.tsx
- src/features/ai/components/selectors/context-selector.tsx
- src/features/ai/lib/chat-surface-layout.ts

## What To Avoid

- Do not just tweak spacing and call it done.
- Do not keep a busy metadata-pill header.
- Do not keep the right rail visually strong by default.
- Do not make every section its own bordered card.
- Do not make the composer look like a toolbar tray.
- Do not make the panel chat feel like a different product from Harness.

## Visual Judgment

Be opinionated.

If something feels like:
- dashboard chrome
- control-panel clutter
- generic dark-mode AI UI
- decorative pills everywhere
- too many borders and boxes

cut it or tone it down.

## Verification Requirements

Before claiming success:
- run focused tests if needed
- run bun lint
- run bun typecheck
- run bun vite build
- run git diff --check
- verify the redesign in the watched local Athas window if possible

When reporting back, be honest about:
- what changed
- what was visually proven
- what is still unproven

The bar is not "cleaner."
The bar is: "this now feels like a real chat product instead of a messy IDE AI pane."
```

## 3. Notes For Handoff

Useful reality to tell the next agent:

- the previous attempt already introduced a shared layout helper in `src/features/ai/lib/chat-surface-layout.ts`
- the current branch already has Pi-native runtime behavior wired, so this should stay a UI-focused refactor
- the watched app is available through the local helper and VNC path
- the main failure of the prior redesign was not implementation quality alone, it was that the design stayed too faithful to the old Athas chrome

