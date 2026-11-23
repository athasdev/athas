//! Pressable controls: `ui/toggle.tsx`, `ui/button-group.tsx`, `ui/tabs.tsx`,
//! `ui/choice-cards.tsx` and `ui/menubar.tsx`.
use crate::TooltipExt;

use std::rc::Rc;

use crate::scale::px;
use gpui::{AnyElement, App, Bounds, ClickEvent, ElementId, IntoElement, Pixels, RenderOnce, SharedString, Window, div, prelude::*,};
use theme::ActiveTheme;

use crate::{Icon, IconName, IconSize, Tooltip, metrics, typography};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ToggleVariant {
    #[default]
    Default,
    /// On the raised plane.
    Outline,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ToggleTone {
    #[default]
    Default,
    /// Pressed reads in the primary colour.
    Accent,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ToggleSize {
    /// The chrome control, 24px.
    Sm,
    /// 28px.
    #[default]
    Md,
    /// The activity rail, 32px with a squarer corner.
    Lg,
}

/// A button that stays pressed (`Toggle`), usually an icon with a tooltip.
#[derive(IntoElement)]
pub struct Toggle {
    id: ElementId,
    icon: Option<IconName>,
    label: Option<SharedString>,
    pressed: bool,
    disabled: bool,
    variant: ToggleVariant,
    tone: ToggleTone,
    size: ToggleSize,
    tooltip: Option<SharedString>,
    shortcut: Option<SharedString>,
    forced_hover: bool,
    on_toggle: Option<Rc<dyn Fn(bool, &mut Window, &mut App)>>,
}

impl Toggle {
    pub fn new(id: impl Into<ElementId>, icon: IconName) -> Self {
        Self {
            id: id.into(),
            icon: Some(icon),
            label: None,
            pressed: false,
            disabled: false,
            variant: ToggleVariant::Default,
            tone: ToggleTone::Default,
            size: ToggleSize::Md,
            tooltip: None,
            shortcut: None,
            forced_hover: false,
            on_toggle: None,
        }
    }

    /// Draws the hover state without the pointer (state galleries and snapshots).
    pub fn force_hover(mut self, hovered: bool) -> Self {
        self.forced_hover = hovered;
        self
    }

    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }

    pub fn pressed(mut self, pressed: bool) -> Self {
        self.pressed = pressed;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn variant(mut self, variant: ToggleVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn tone(mut self, tone: ToggleTone) -> Self {
        self.tone = tone;
        self
    }

    pub fn size(mut self, size: ToggleSize) -> Self {
        self.size = size;
        self
    }

    pub fn tooltip(mut self, tooltip: impl Into<SharedString>) -> Self {
        self.tooltip = Some(tooltip.into());
        self
    }

    pub fn shortcut(mut self, shortcut: impl Into<SharedString>) -> Self {
        self.shortcut = Some(shortcut.into());
        self
    }

    pub fn on_toggle(mut self, handler: impl Fn(bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_toggle = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Toggle {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let (side, icon_size) = match self.size {
            ToggleSize::Sm => (metrics::chrome_control(), px(12.)),
            ToggleSize::Md => (px(28.), px(14.)),
            ToggleSize::Lg => (metrics::rail_control(), px(16.)),
        };
        let pressed = self.pressed;
        let accent = self.tone == ToggleTone::Accent;
        let text = match (pressed, accent) {
            (true, true) => colors.primary,
            (true, false) => colors.foreground,
            _ => colors.subtle_foreground,
        };
        let hover_bg = colors.accent;
        let hover_text = colors.foreground;
        let tooltip = self.tooltip.clone().map(|text| (text, self.shortcut.clone()));
        let pressed_with_label = self.label.is_some();
        let hoverable = !pressed && !self.disabled;
        let forced = hoverable && self.forced_hover;
        let text = if forced { hover_text } else { text };
        div()
            .id(self.id)
            .group("ui-toggle")
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .gap(px(4.))
            .h(side)
            .map(|this| if pressed_with_label { this.px(px(10.)) } else { this.w(side) })
            .map(|this| if self.size == ToggleSize::Lg { this.rounded(metrics::radius_md()) } else { this.rounded_full() })
            .font_family(typography::ui_font())
            .font_weight(typography::MEDIUM)
            .text_size(typography::text_sm())
            .text_color(text)
            .when(self.variant == ToggleVariant::Outline, |this| this.bg(colors.raised).shadow(theme.shadows.raised.clone()))
            .when(hoverable, |this| this.hover(move |style| style.bg(hover_bg).text_color(hover_text)))
            .when(forced, |this| this.bg(hover_bg))
            .when(pressed && accent, |this| this.bg(colors.primary_soft))
            .when(pressed && !accent, |this| this.bg(colors.selected).shadow(theme.shadows.raised_inset.clone()))
            .when(self.disabled, |this| this.opacity(0.5))
            .children(self.icon.map(|icon| {
                let icon = Icon::new(icon).size(IconSize::Custom(icon_size)).color(text);
                if hoverable { icon.group_hover_color("ui-toggle", hover_text) } else { icon }
            }))
            .children(self.label)
            .when_some(tooltip, |this, (text, shortcut)| this.anchored_tooltip(move || Tooltip::new(text.clone()).shortcut(shortcut.clone())))
            .when_some(self.on_toggle.filter(|_| !self.disabled), |this, handler| this.on_click(move |_: &ClickEvent, window, cx| handler(!pressed, window, cx)))
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ButtonGroupVariant {
    /// A pill on the accent plane.
    #[default]
    Default,
    /// A pill on the soft primary.
    Accent,
    Ghost,
}

/// Buttons joined into one pill (`ButtonGroup`); give it ghost buttons and
/// [`ButtonGroupSeparator`]s between them.
#[derive(IntoElement, Default)]
pub struct ButtonGroup {
    variant: ButtonGroupVariant,
    vertical: bool,
    children: Vec<AnyElement>,
}

impl ButtonGroup {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn variant(mut self, variant: ButtonGroupVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn vertical(mut self) -> Self {
        self.vertical = true;
        self
    }
}

impl ParentElement for ButtonGroup {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for ButtonGroup {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .flex()
            .flex_none()
            .items_stretch()
            .overflow_hidden()
            .rounded_full()
            .map(|this| if self.vertical { this.flex_col() } else { this.flex_row() })
            .map(|this| match self.variant {
                ButtonGroupVariant::Default => this.bg(colors.accent),
                ButtonGroupVariant::Accent => this.bg(colors.primary_soft).text_color(colors.primary),
                ButtonGroupVariant::Ghost => this,
            })
            .children(self.children)
    }
}

/// The hairline between buttons of a [`ButtonGroup`].
#[derive(IntoElement, Default)]
pub struct ButtonGroupSeparator {
    horizontal: bool,
}

impl ButtonGroupSeparator {
    pub fn new() -> Self {
        Self::default()
    }

    /// A horizontal rule, for a vertical group.
    pub fn horizontal(mut self) -> Self {
        self.horizontal = true;
        self
    }
}

impl RenderOnce for ButtonGroupSeparator {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let line = div().flex_none().bg(cx.theme().colors.divider);
        if self.horizontal { line.h(px(1.)).w_full() } else { line.w(px(1.)).my(px(4.)) }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TabsVariant {
    /// A segmented control: a recessed track with the active tab raised out of it.
    #[default]
    Default,
    /// Text with an underline under the active tab.
    Line,
    /// Plain text; the active tab reads by tone.
    Text,
}

/// One tab of a [`Tabs`] list.
#[derive(Clone, Debug, PartialEq)]
pub struct TabsTrigger {
    pub value: SharedString,
    pub label: SharedString,
    pub icon: Option<IconName>,
    pub disabled: bool,
}

impl TabsTrigger {
    pub fn new(value: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        Self { value: value.into(), label: label.into(), icon: None, disabled: false }
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

/// A tab list (`Tabs` + `TabsList`); the owner shows the active tab's content under it.
#[derive(IntoElement)]
pub struct Tabs {
    id: ElementId,
    triggers: Vec<TabsTrigger>,
    value: SharedString,
    variant: TabsVariant,
    vertical: bool,
    wrap: bool,
    on_change: Option<Rc<dyn Fn(&SharedString, &mut Window, &mut App)>>,
}

impl Tabs {
    pub fn new(id: impl Into<ElementId>, triggers: Vec<TabsTrigger>, value: impl Into<SharedString>) -> Self {
        Self { id: id.into(), triggers, value: value.into(), variant: TabsVariant::Default, vertical: false, wrap: false, on_change: None }
    }

    pub fn variant(mut self, variant: TabsVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn vertical(mut self) -> Self {
        self.vertical = true;
        self
    }

    /// Runs onto a second row rather than past the edge, so that many tabs in a narrow page
    /// all stay in sight — the active one most of all.
    pub fn wrap(mut self) -> Self {
        self.wrap = true;
        self
    }

    pub fn on_change(mut self, handler: impl Fn(&SharedString, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Tabs {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let variant = self.variant;
        let vertical = self.vertical;
        let wrap = self.wrap;
        let items = self.triggers.into_iter().enumerate().map(|(index, trigger)| {
            let active = trigger.value == self.value;
            let text = if active { colors.foreground } else { colors.subtle_foreground };
            let hover_text = colors.foreground;
            let handler = self.on_change.clone().filter(|_| !trigger.disabled && !active);
            let value = trigger.value.clone();
            let hoverable = !active && !trigger.disabled;
            div()
                .id(index)
                .group("ui-tabs-trigger")
                .relative()
                .flex()
                .items_center()
                .gap(px(6.))
                .h(metrics::chrome_control())
                .whitespace_nowrap()
                .text_color(text)
                .map(|this| match (vertical, wrap) {
                    (true, _) => this.w_full().justify_start(),
                    // Wrapped, a tab is as wide as its label; stretching would leave the tabs
                    // of the last row wider than those of the first.
                    (false, true) => this.flex_none(),
                    (false, false) => this.flex_1().justify_center(),
                })
                .map(|this| match variant {
                    TabsVariant::Default => this.px(px(12.)).rounded_full().when(active, |this| this.bg(colors.segment_knob).shadow(theme.shadows.raised_inset.clone())),
                    TabsVariant::Line => this.px(px(12.)).child(
                        div().absolute().left(px(8.)).right(px(8.)).bottom(px(-1.)).h(px(2.)).rounded_full().when(active, |this| this.bg(colors.primary)),
                    ),
                    TabsVariant::Text => this.px(px(6.)),
                })
                .when(trigger.disabled, |this| this.opacity(0.5))
                .when(!active && !trigger.disabled, |this| this.hover(move |style| style.text_color(hover_text)))
                .children(trigger.icon.map(|icon| {
                    let icon = Icon::new(icon).size(IconSize::Custom(px(14.))).color(text);
                    if hoverable { icon.group_hover_color("ui-tabs-trigger", hover_text) } else { icon }
                }))
                .child(trigger.label)
                .when_some(handler, |this, handler| this.on_click(move |_: &ClickEvent, window, cx| handler(&value, window, cx)))
        });
        div()
            .id(self.id)
            .flex()
            // Wrapping needs a width to wrap within, so the strip may shrink below its content.
            .map(|this| if wrap { this.min_w_0() } else { this.flex_none() })
            .items_center()
            .map(|this| if vertical { this.flex_col().items_stretch() } else { this.flex_row() })
            .when(wrap, |this| this.flex_wrap())
            .font_family(typography::ui_font())
            .font_weight(typography::MEDIUM)
            .text_size(typography::text_chrome())
            .map(|this| match variant {
                // Over more than one row the stadium shape no longer fits what it holds.
                TabsVariant::Default => this.gap(px(2.)).p(px(2.)).bg(colors.segment_track).map(|this| if wrap { this.rounded(metrics::radius_lg()) } else { this.rounded_full() }),
                TabsVariant::Line => this.gap(metrics::chrome_gap()),
                TabsVariant::Text => this.gap(metrics::chrome_gap_tight()),
            })
            .children(items)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ChoiceCardSize {
    /// 96 x 64.
    #[default]
    Tile,
    /// 144 x 80, for a swatch with more detail.
    Wide,
}

/// One picture choice of [`ChoiceCards`].
pub struct ChoiceCard {
    value: SharedString,
    label: SharedString,
    preview: AnyElement,
    size: ChoiceCardSize,
    disabled: bool,
}

impl ChoiceCard {
    pub fn new(value: impl Into<SharedString>, label: impl Into<SharedString>, preview: impl IntoElement) -> Self {
        Self { value: value.into(), label: label.into(), preview: preview.into_any_element(), size: ChoiceCardSize::Tile, disabled: false }
    }

    pub fn size(mut self, size: ChoiceCardSize) -> Self {
        self.size = size;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

/// A row of picture choices (`ChoiceCards`), such as a colour scheme: each card shows a preview
/// above its label, and the chosen one wears the primary ring.
#[derive(IntoElement)]
pub struct ChoiceCards {
    id: ElementId,
    value: SharedString,
    cards: Vec<ChoiceCard>,
    nowrap: bool,
    on_change: Option<Rc<dyn Fn(&SharedString, &mut Window, &mut App)>>,
}

impl ChoiceCards {
    pub fn new(id: impl Into<ElementId>, value: impl Into<SharedString>) -> Self {
        Self { id: id.into(), value: value.into(), cards: Vec::new(), nowrap: false, on_change: None }
    }

    pub fn card(mut self, card: ChoiceCard) -> Self {
        self.cards.push(card);
        self
    }

    /// Keeps the cards on one line, for a scroller.
    pub fn row(mut self) -> Self {
        self.nowrap = true;
        self
    }

    pub fn on_change(mut self, handler: impl Fn(&SharedString, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for ChoiceCards {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let cards = self.cards.into_iter().enumerate().map(|(index, card)| {
            let checked = card.value == self.value;
            let (width, height) = match card.size {
                ChoiceCardSize::Tile => (px(96.), px(64.)),
                ChoiceCardSize::Wide => (px(144.), px(80.)),
            };
            let handler = self.on_change.clone().filter(|_| !card.disabled);
            let value = card.value.clone();
            // Unchecked, a card shows its ring only under the pointer; it used to lift on a
            // shadow instead, the one place a shadow stood for a hover state.
            let hover_ring = if checked { colors.primary } else { colors.border_strong };
            let ring = if checked { colors.primary } else { gpui::transparent_black() };
            div()
                .id(index)
                .flex()
                .flex_col()
                .items_center()
                .gap(px(6.))
                .p(px(4.))
                .rounded(metrics::radius_lg())
                .when(card.disabled, |this| this.opacity(0.5))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_center()
                        .w(width)
                        .h(height)
                        .overflow_hidden()
                        .rounded(metrics::radius_lg())
                        .bg(colors.surface)
                        .shadow(theme.shadows.raised.clone())
                        .border_2()
                        .border_color(ring)
                        .when(!card.disabled, |this| this.hover(move |style| style.border_color(hover_ring)))
                        .child(card.preview),
                )
                .child(
                    div()
                        .font_family(typography::ui_font())
                        .text_size(typography::text_sm())
                        .text_color(if checked { colors.foreground } else { colors.muted_foreground })
                        .when(checked, |this| this.font_weight(typography::MEDIUM))
                        .child(card.label),
                )
                .when_some(handler, |this, handler| this.on_click(move |_: &ClickEvent, window, cx| handler(&value, window, cx)))
        });
        div().id(self.id).flex().gap(px(12.)).when(!self.nowrap, |this| this.flex_wrap()).children(cards)
    }
}

type MenubarOpenHandler = Rc<dyn Fn(Option<&SharedString>, Bounds<Pixels>, &mut Window, &mut App)>;

/// A bar of menu titles (`Menubar`): clicking one opens it, and while one is open hovering
/// another moves to it. The owner opens the menu (an `OpenMenu` under the trigger's bounds) and
/// passes the open one back as `value`.
#[derive(IntoElement)]
pub struct Menubar {
    id: ElementId,
    menus: Vec<(SharedString, SharedString)>,
    value: Option<SharedString>,
    on_open_change: Option<MenubarOpenHandler>,
}

impl Menubar {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), menus: Vec::new(), value: None, on_open_change: None }
    }

    pub fn menu(mut self, value: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        self.menus.push((value.into(), label.into()));
        self
    }

    /// The open menu.
    pub fn value(mut self, value: Option<SharedString>) -> Self {
        self.value = value;
        self
    }

    /// Called with the menu to open (or `None` to close) and its trigger's bounds.
    pub fn on_open_change(mut self, handler: impl Fn(Option<&SharedString>, Bounds<Pixels>, &mut Window, &mut App) + 'static) -> Self {
        self.on_open_change = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Menubar {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let any_open = self.value.is_some();
        let triggers = self.menus.into_iter().enumerate().map(|(index, (value, label))| {
            let open = self.value.as_ref() == Some(&value);
            let (hover_bg, hover_text) = (colors.accent, colors.foreground);
            let bounds = Rc::new(std::cell::Cell::new(Bounds::default()));
            let handler = self.on_open_change.clone();
            let hover_handler = self.on_open_change.clone();
            let (click_value, hover_value) = (value.clone(), value.clone());
            let (click_bounds, hover_bounds, paint_bounds) = (bounds.clone(), bounds.clone(), bounds);
            div()
                .id(index)
                .flex()
                .items_center()
                .h(px(20.))
                .px(px(8.))
                .rounded_full()
                .text_color(if open { colors.foreground } else { colors.muted_foreground })
                .when(open, |this| this.bg(colors.selected))
                .when(!open, |this| this.hover(move |style| style.bg(hover_bg).text_color(hover_text)))
                .relative()
                .child(label)
                .child(gpui::canvas(move |bounds, _, _| paint_bounds.set(bounds), |_, _, _, _| {}).absolute().size_full())
                .when_some(handler, |this, handler| {
                    this.on_click(move |_: &ClickEvent, window, cx| handler(if open { None } else { Some(&click_value) }, click_bounds.get(), window, cx))
                })
                .when_some(hover_handler.filter(|_| any_open && !open), |this, handler| {
                    this.on_hover(move |hovered, window, cx| {
                        if *hovered {
                            handler(Some(&hover_value), hover_bounds.get(), window, cx);
                        }
                    })
                })
        });
        div()
            .id(self.id)
            .flex()
            .h(metrics::chrome_control())
            .items_center()
            .gap(px(2.))
            .p(px(2.))
            .rounded(metrics::radius_md())
            .font_family(typography::ui_font())
            .text_size(typography::text_chrome())
            .children(triggers)
    }
}
