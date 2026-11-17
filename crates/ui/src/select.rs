//! A choice from a list (`ui/select.tsx`, `ui/combobox.tsx`): a trigger showing the current
//! option and a menu-shaped popup, optionally filtered by a search field in the popup or by
//! typing into the trigger itself.
use crate::TooltipExt;

use gpui::{
    Anchor, AnyElement, App, Bounds, Context, Entity, EventEmitter, FocusHandle, Focusable, Hsla, KeyDownEvent,
    MouseButton, MouseDownEvent, Pixels, SharedString, Subscription, Window, anchored, canvas, deferred, div,
    prelude::*, px,
};
use theme::ActiveTheme;

use crate::{
    Icon, IconName, IconSize, InputAppearance, MenuSize, TextInput, TextInputEvent, Tooltip,
    menu::{OVERLAY_MAX_HEIGHT, OVERLAY_MAX_WIDTH},
    metrics, typography,
};

#[derive(Clone, Debug, PartialEq)]
pub struct SelectOption {
    pub value: SharedString,
    pub label: SharedString,
    pub icon: Option<IconName>,
    pub disabled: bool,
    pub keywords: Vec<SharedString>,
}

impl SelectOption {
    pub fn new(value: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        Self { value: value.into(), label: label.into(), icon: None, disabled: false, keywords: Vec::new() }
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn keywords(mut self, keywords: impl IntoIterator<Item = impl Into<SharedString>>) -> Self {
        self.keywords = keywords.into_iter().map(Into::into).collect();
        self
    }

    fn matches(&self, query: &str) -> bool {
        let query = query.trim().to_lowercase();
        if query.is_empty() {
            return true;
        }
        let haystack: Vec<String> = [&self.label, &self.value]
            .into_iter()
            .chain(self.keywords.iter())
            .map(|text| text.to_lowercase())
            .collect();
        query.split_whitespace().all(|token| haystack.iter().any(|text| text.contains(token)))
    }
}

/// How the trigger is filled.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SelectVariant {
    /// The neutral filled button.
    Default,
    /// Borderless, for toolbars and settings rows.
    #[default]
    Ghost,
    /// The raised, field-shaped outline button.
    Surface,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SelectWidth {
    /// As wide as the current option, up to 288px.
    #[default]
    Content,
    Full,
    /// The rest of a flex row.
    Flex,
}

/// Where the select can be searched from.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SelectSearch {
    #[default]
    None,
    /// A search field at the top of the popup.
    Menu,
    /// The trigger is the field: a combobox.
    Input,
}

#[derive(Clone, Debug, PartialEq)]
pub enum SelectEvent {
    Changed(SharedString),
    Opened,
    Closed,
}

/// A select or combobox. Return, Space and the arrows open it from the keyboard; inside, the
/// arrows move, Return picks, and Escape or a click outside closes it.
pub struct Select {
    focus_handle: FocusHandle,
    scroll: gpui::ScrollHandle,
    options: Vec<SelectOption>,
    value: SharedString,
    placeholder: SharedString,
    variant: SelectVariant,
    width: SelectWidth,
    menu_size: MenuSize,
    search: SelectSearch,
    search_input: Option<Entity<TextInput>>,
    query: String,
    allow_custom_value: bool,
    empty_label: SharedString,
    leading_icon: Option<IconName>,
    hide_chevron: bool,
    icon_only: bool,
    disabled: bool,
    open_up: bool,
    tooltip: Option<SharedString>,
    open: bool,
    highlighted: Option<usize>,
    trigger_bounds: Option<Bounds<Pixels>>,
    placeholder_synced: bool,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<SelectEvent> for Select {}

impl Focusable for Select {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        match (&self.search_input, self.search) {
            (Some(input), SelectSearch::Input) => input.focus_handle(cx),
            _ => self.focus_handle.clone(),
        }
    }
}

impl Select {
    pub fn new(options: Vec<SelectOption>, value: impl Into<SharedString>, cx: &mut Context<Self>) -> Self {
        Self {
            focus_handle: cx.focus_handle(),
            options,
            value: value.into(),
            placeholder: "Select...".into(),
            variant: SelectVariant::default(),
            width: SelectWidth::default(),
            menu_size: MenuSize::Auto,
            search: SelectSearch::None,
            search_input: None,
            query: String::new(),
            allow_custom_value: false,
            empty_label: "No matching options".into(),
            leading_icon: None,
            hide_chevron: false,
            icon_only: false,
            disabled: false,
            open_up: false,
            scroll: gpui::ScrollHandle::new(),
            tooltip: None,
            open: false,
            highlighted: None,
            trigger_bounds: None,
            placeholder_synced: false,
            _subscriptions: Vec::new(),
        }
    }

    /// A combobox: a select whose trigger is a search field.
    pub fn combobox(
        options: Vec<SelectOption>,
        value: impl Into<SharedString>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        Self::new(options, value, cx).searchable(SelectSearch::Input, window, cx).variant(SelectVariant::Default)
    }

    pub fn placeholder(mut self, placeholder: impl Into<SharedString>) -> Self {
        self.placeholder = placeholder.into();
        self
    }

    pub fn variant(mut self, variant: SelectVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn width(mut self, width: SelectWidth) -> Self {
        self.width = width;
        self
    }

    /// The popup's minimum width; it always follows the trigger's width otherwise.
    pub fn menu_size(mut self, size: MenuSize) -> Self {
        self.menu_size = size;
        self
    }

    pub fn searchable(mut self, search: SelectSearch, window: &mut Window, cx: &mut Context<Self>) -> Self {
        self.search = search;
        if search != SelectSearch::None {
            let input = cx.new(|cx| {
                TextInput::new(window, cx).appearance(InputAppearance::Bare).placeholder(match search {
                    SelectSearch::Menu => SharedString::from("Search..."),
                    _ => self.placeholder.clone(),
                })
            });
            self._subscriptions.push(cx.subscribe_in(&input, window, Self::on_search_event));
            self.search_input = Some(input);
            self.sync_input_placeholder(cx);
        }
        self
    }

    /// Offers what was typed as an option of its own when nothing matches it exactly.
    pub fn allow_custom_value(mut self) -> Self {
        self.allow_custom_value = true;
        self
    }

    pub fn empty_label(mut self, label: impl Into<SharedString>) -> Self {
        self.empty_label = label.into();
        self
    }

    pub fn leading_icon(mut self, icon: IconName) -> Self {
        self.leading_icon = Some(icon);
        self
    }

    pub fn hide_chevron(mut self) -> Self {
        self.hide_chevron = true;
        self
    }

    /// Shows only the option's (or the leading) icon; give it a tooltip.
    pub fn icon_only(mut self) -> Self {
        self.icon_only = true;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn open_up(mut self) -> Self {
        self.open_up = true;
        self
    }

    pub fn tooltip(mut self, tooltip: impl Into<SharedString>) -> Self {
        self.tooltip = Some(tooltip.into());
        self
    }

    pub fn value(&self) -> &SharedString {
        &self.value
    }

    pub fn is_open(&self) -> bool {
        self.open
    }

    pub fn set_value(&mut self, value: impl Into<SharedString>, cx: &mut Context<Self>) {
        self.value = value.into();
        self.sync_input_placeholder(cx);
        cx.notify();
    }

    pub fn set_options(&mut self, options: Vec<SelectOption>, cx: &mut Context<Self>) {
        self.options = options;
        self.highlighted = None;
        self.sync_input_placeholder(cx);
        cx.notify();
    }

    pub fn set_disabled(&mut self, disabled: bool, cx: &mut Context<Self>) {
        self.disabled = disabled;
        cx.notify();
    }

    fn selected(&self) -> Option<&SelectOption> {
        self.options.iter().find(|option| option.value == self.value)
    }

    fn label(&self) -> SharedString {
        self.selected()
            .map(|option| option.label.clone())
            .or_else(|| (!self.value.is_empty()).then(|| self.value.clone()))
            .unwrap_or_else(|| self.placeholder.clone())
    }

    fn sync_input_placeholder(&self, cx: &mut Context<Self>) {
        if self.search != SelectSearch::Input {
            return;
        }
        let Some(input) = &self.search_input else { return };
        let strong = self.selected().is_some();
        let label = self.selected().map(|option| option.label.clone()).unwrap_or_else(|| self.placeholder.clone());
        input.update(cx, |input, cx| {
            input.set_placeholder(label, cx);
            input.set_strong_placeholder(strong, cx);
        });
    }

    /// The options the popup lists: those matching the query, then the typed value when custom
    /// values are allowed.
    fn visible(&self) -> Vec<SelectOption> {
        let mut options: Vec<SelectOption> = if self.search == SelectSearch::None {
            self.options.clone()
        } else {
            self.options.iter().filter(|option| option.matches(&self.query)).cloned().collect()
        };
        let custom = self.query.trim();
        if self.allow_custom_value && !custom.is_empty() && !self.options.iter().any(|option| option.value.as_ref() == custom) {
            options.push(SelectOption::new(custom.to_string(), format!("Use {custom}")).keywords([custom.to_string()]));
        }
        options
    }

    fn can_open(&self) -> bool {
        !self.disabled && (!self.options.is_empty() || (self.search != SelectSearch::None && self.allow_custom_value))
    }

    pub fn set_open(&mut self, open: bool, window: &mut Window, cx: &mut Context<Self>) {
        let open = open && self.can_open();
        if self.open == open {
            return;
        }
        self.open = open;
        if open {
            let visible = self.visible();
            self.highlighted = visible
                .iter()
                .position(|option| option.value == self.value)
                .or_else(|| visible.iter().position(|option| !option.disabled));
            if self.search == SelectSearch::Menu
                && let Some(input) = &self.search_input
            {
                input.update(cx, |input, cx| input.focus(window, cx));
            }
            cx.emit(SelectEvent::Opened);
        } else {
            self.query.clear();
            if let Some(input) = &self.search_input {
                input.update(cx, |input, cx| input.set_text("", cx));
            }
            if self.search == SelectSearch::Menu {
                window.focus(&self.focus_handle, cx);
            }
            cx.emit(SelectEvent::Closed);
        }
        cx.notify();
    }

    fn choose(&mut self, option: SelectOption, window: &mut Window, cx: &mut Context<Self>) {
        if option.disabled {
            return;
        }
        self.set_open(false, window, cx);
        if option.value != self.value {
            self.value = option.value.clone();
            self.sync_input_placeholder(cx);
            cx.emit(SelectEvent::Changed(option.value));
        }
        cx.notify();
    }

    fn step(&mut self, delta: isize, cx: &mut Context<Self>) {
        let visible = self.visible();
        let rows: Vec<usize> = (0..visible.len()).filter(|index| !visible[*index].disabled).collect();
        if rows.is_empty() {
            return;
        }
        self.highlighted = Some(match self.highlighted.and_then(|current| rows.iter().position(|row| *row == current)) {
            Some(position) => rows[(position as isize + delta).clamp(0, rows.len() as isize - 1) as usize],
            None if delta > 0 => rows[0],
            None => rows[rows.len() - 1],
        });
        cx.notify();
    }

    fn pick_highlighted(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(option) = self.highlighted.and_then(|index| self.visible().get(index).cloned()) {
            self.choose(option, window, cx);
        }
    }

    fn on_search_event(&mut self, _: &Entity<TextInput>, event: &TextInputEvent, window: &mut Window, cx: &mut Context<Self>) {
        match event {
            TextInputEvent::Changed(text) => {
                if self.query == text.as_ref() {
                    return;
                }
                self.query = text.to_string();
                if self.search == SelectSearch::Input && !text.is_empty() {
                    self.set_open(true, window, cx);
                }
                let visible = self.visible();
                self.highlighted = visible.iter().position(|option| !option.disabled);
                cx.notify();
            }
            TextInputEvent::Confirmed if self.open => self.pick_highlighted(window, cx),
            TextInputEvent::Cancelled => self.set_open(false, window, cx),
            _ => {}
        }
    }

    fn on_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let key = event.keystroke.key.as_str();
        let in_search = self.search_input.as_ref().is_some_and(|input| input.focus_handle(cx).is_focused(window));
        if !self.open {
            match key {
                "down" | "up" => self.set_open(true, window, cx),
                "enter" | "space" if !in_search => self.set_open(true, window, cx),
                _ => return,
            }
        } else {
            match key {
                "down" => self.step(1, cx),
                "up" => self.step(-1, cx),
                "pagedown" => self.step(isize::MAX / 2, cx),
                "pageup" => self.step(isize::MIN / 2, cx),
                "home" if !in_search => self.step(isize::MIN / 2, cx),
                "end" if !in_search => self.step(isize::MAX / 2, cx),
                "enter" | "space" if !in_search => self.pick_highlighted(window, cx),
                "escape" if !in_search => self.set_open(false, window, cx),
                "tab" => {
                    self.set_open(false, window, cx);
                    return;
                }
                _ => return,
            }
        }
        cx.stop_propagation();
    }

    fn on_trigger_down(&mut self, _: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.disabled {
            return;
        }
        if self.search == SelectSearch::Input {
            self.set_open(true, window, cx);
            return;
        }
        window.focus(&self.focus_handle, cx);
        self.set_open(!self.open, window, cx);
    }

    fn on_popup_down_out(&mut self, event: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.trigger_bounds.is_some_and(|bounds| bounds.contains(&event.position)) {
            return;
        }
        self.set_open(false, window, cx);
    }

    fn trigger_colors(&self, cx: &App) -> (Option<Hsla>, Hsla, Hsla, Hsla) {
        let colors = &cx.theme().colors;
        let open = self.open;
        match self.variant {
            SelectVariant::Default => (Some(if open { colors.selected } else { colors.accent }), colors.foreground, colors.selected, colors.foreground),
            SelectVariant::Surface => (Some(if open { colors.accent } else { colors.raised }), colors.foreground, colors.accent, colors.foreground),
            SelectVariant::Ghost => (
                open.then_some(colors.accent),
                if open { colors.foreground } else { colors.subtle_foreground },
                colors.accent,
                colors.foreground,
            ),
        }
    }

    fn render_button_trigger(&self, cx: &mut Context<Self>) -> AnyElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let (bg, fg, hover_bg, hover_fg) = self.trigger_colors(cx);
        let selected = self.selected().cloned();
        let full = !self.icon_only && self.width != SelectWidth::Content;
        div()
            .id("select-trigger")
            .flex()
            .items_center()
            .justify_between()
            .gap(px(6.))
            .h(px(28.))
            .min_w_0()
            .max_w_full()
            .rounded_full()
            .text_size(typography::TEXT_SM)
            .line_height(gpui::relative(typography::LEADING_ROW))
            .font_weight(typography::MEDIUM)
            .whitespace_nowrap()
            .text_color(fg)
            .when_some(bg, |this, bg| this.bg(bg))
            .when(self.variant == SelectVariant::Surface, |this| this.shadow(theme.shadows.raised.clone()))
            .when(self.icon_only, |this| this.w(px(28.)).justify_center())
            .when(!self.icon_only, |this| this.px(px(10.)))
            .when(full, |this| this.w_full())
            .when(self.disabled, |this| this.opacity(0.5))
            .when(!self.disabled, |this| this.hover(move |style| style.bg(hover_bg).text_color(hover_fg)))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_trigger_down))
            .map(|this| {
                if self.icon_only {
                    let icon = self.leading_icon.or(selected.as_ref().and_then(|option| option.icon));
                    this.children(icon.map(|icon| Icon::new(icon).size(IconSize::XSmall).color(fg)))
                } else {
                    this.child(
                        div()
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .items_center()
                            .gap(px(8.))
                            .overflow_hidden()
                            .children(self.leading_icon.map(|icon| Icon::new(icon).size(IconSize::XSmall).color(fg)))
                            .children(selected.as_ref().and_then(|option| option.icon).map(|icon| {
                                Icon::new(icon).size(IconSize::XSmall).color(colors.subtle_foreground)
                            }))
                            .child(div().flex_1().min_w_0().truncate().child(self.label())),
                    )
                }
            })
            .when(!self.hide_chevron, |this| {
                this.child(Icon::new(IconName::ChevronDown).size(IconSize::XSmall).color(colors.subtle_foreground))
            })
            .when_some(self.tooltip.clone(), |this, tooltip| this.anchored_tooltip(move || Tooltip::new(tooltip.clone())))
            .into_any_element()
    }

    fn render_input_trigger(&self, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let focused = self.search_input.as_ref().is_some_and(|input| input.focus_handle(cx).is_focused(window));
        let (bg, hover) = match self.variant {
            SelectVariant::Default => (Some(colors.accent), Some(colors.selected)),
            SelectVariant::Surface => (Some(colors.surface), None),
            SelectVariant::Ghost => (None, None),
        };
        div()
            .id("combobox-input")
            .relative()
            .flex()
            .items_center()
            .h(px(28.))
            .min_w_0()
            .w_full()
            .rounded_full()
            .text_size(typography::TEXT_SM)
            .text_color(colors.foreground)
            .when_some(bg, |this, bg| this.bg(bg))
            .when_some(hover, |this, hover| this.hover(move |style| style.bg(hover)))
            .when(focused && self.variant != SelectVariant::Ghost, |this| this.border_3().border_color(colors.focus_ring))
            .when(self.disabled, |this| this.opacity(0.5))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_trigger_down))
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .items_center()
                    .gap(px(8.))
                    .pl(px(if focused && self.variant != SelectVariant::Ghost { 5. } else { 8. }))
                    .pr(px(4.))
                    .children(self.leading_icon.map(|icon| Icon::new(icon).size(IconSize::XSmall).color(colors.subtle_foreground)))
                    .children(self.search_input.clone()),
            )
            .when(!self.hide_chevron, |this| {
                this.child(
                    div().flex_none().pr(px(6.)).child(
                        div()
                            .id("combobox-chevron")
                            .flex()
                            .items_center()
                            .justify_center()
                            .size(px(20.))
                            .rounded_full()
                            .hover(|style| style.bg(colors.accent))
                            .child(Icon::new(IconName::ChevronDown).size(IconSize::XSmall).color(colors.subtle_foreground)),
                    ),
                )
            })
            .into_any_element()
    }

    fn render_popup(&self, cx: &mut Context<Self>) -> AnyElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let visible = self.visible();
        let trigger_width = self.trigger_bounds.map(|bounds| bounds.size.width);
        let floor = self.menu_size.width().unwrap_or(px(0.)).max(px(144.));

        let rows: Vec<AnyElement> = visible
            .iter()
            .enumerate()
            .map(|(index, option)| {
                let highlighted = !option.disabled && self.highlighted == Some(index);
                let checked = option.value == self.value;
                let text = if option.disabled {
                    colors.subtle_foreground
                } else if highlighted {
                    colors.primary_foreground
                } else {
                    colors.foreground
                };
                let quiet = if highlighted { colors.primary_foreground } else { colors.subtle_foreground };
                let check = if highlighted { colors.primary_foreground } else { colors.primary };
                let chosen = option.clone();
                div()
                    .id(("select-option", index))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .min_h(px(28.))
                    .w_full()
                    .px(px(8.))
                    .py(px(4.))
                    .rounded(metrics::RADIUS)
                    .whitespace_nowrap()
                    .text_color(text)
                    .when(highlighted, |this| this.bg(colors.primary))
                    .when(!highlighted && checked, |this| this.bg(colors.selected))
                    .children(option.icon.map(|icon| Icon::new(icon).size(IconSize::XSmall).color(quiet)))
                    .child(div().flex_1().min_w_0().truncate().child(option.label.clone()))
                    .child(div().flex().flex_none().items_center().justify_center().size(px(16.)).when(checked, |this| {
                        this.child(Icon::new(IconName::Check).size(IconSize::Small).color(check))
                    }))
                    .when(!option.disabled, |this| {
                        this.on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
                            if *hovered && this.highlighted != Some(index) {
                                this.highlighted = Some(index);
                                cx.notify();
                            }
                        }))
                        .on_click(cx.listener(move |this, _, window, cx| this.choose(chosen.clone(), window, cx)))
                    })
                    .into_any_element()
            })
            .collect();

        let list = div()
            .id("select-list")
            .flex()
            .flex_col()
            .max_h(OVERLAY_MAX_HEIGHT)
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .when(self.search != SelectSearch::None, |this| this.p(px(4.)))
            .when(visible.is_empty(), |this| {
                this.child(
                    div()
                        .flex()
                        .w_full()
                        .justify_center()
                        .p(px(12.))
                        .text_size(typography::TEXT_SM)
                        .text_color(colors.muted_foreground)
                        .child(self.empty_label.clone()),
                )
            })
            .children(rows);

        let surface = div()
            .id("select-popup")
            .occlude()
            .on_mouse_down_out(cx.listener(Self::on_popup_down_out))
            .flex()
            .flex_col()
            .overflow_hidden()
            .min_w(trigger_width.unwrap_or(px(0.)).max(floor))
            .max_w(OVERLAY_MAX_WIDTH)
            .when(self.width == SelectWidth::Full, |this| this.when_some(trigger_width, |this, width| this.w(width.max(floor))))
            .p(px(4.))
            .rounded(metrics::RADIUS_LG)
            .bg(colors.overlay)
            .shadow(theme.shadows.popover.clone())
            .font_family(typography::UI_FONT)
            .text_size(typography::TEXT_CHROME)
            .line_height(px(16.))
            .text_color(colors.foreground)
            .when(self.search == SelectSearch::Menu, |this| {
                this.child(
                    div().p(px(4.)).border_b_1().border_color(colors.divider).child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .h(px(28.))
                            .px(px(12.))
                            .child(Icon::new(IconName::Search).size(IconSize::XSmall).color(colors.subtle_foreground))
                            .children(self.search_input.clone()),
                    ),
                )
            })
            .child(div().relative().flex().flex_col().min_h_0().child(list).child(crate::Scrollbar::new("select-scrollbar", &self.scroll)));

        let anchor = if self.open_up { Anchor::BottomLeft } else { Anchor::TopLeft };
        div()
            .absolute()
            .left_0()
            .when(self.open_up, |this| this.top_0())
            .when(!self.open_up, |this| this.top_full())
            .child(
                deferred(
                    anchored()
                        .anchor(anchor)
                        .snap_to_window_with_margin(px(8.))
                        .child(div().relative().when(self.open_up, |this| this.mb(px(6.))).when(!self.open_up, |this| this.mt(px(6.))).child(surface).child(crate::occluder())),
                )
                .with_priority(3),
            )
            .into_any_element()
    }
}

impl Render for Select {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.placeholder_synced {
            self.placeholder_synced = true;
            self.sync_input_placeholder(cx);
        }
        let entity = cx.entity().downgrade();
        let trigger = if self.search == SelectSearch::Input {
            self.render_input_trigger(window, cx)
        } else {
            self.render_button_trigger(cx)
        };
        div()
            .id("select")
            .key_context("Select")
            .track_focus(&self.focus_handle)
            .on_key_down(cx.listener(Self::on_key_down))
            .relative()
            .flex()
            .min_w_0()
            .font_family(typography::UI_FONT)
            .map(|this| match (self.width, self.icon_only) {
                (_, true) | (SelectWidth::Content, _) => this.max_w(px(288.)),
                (SelectWidth::Full, _) => this.w_full(),
                (SelectWidth::Flex, _) => this.flex_1().max_w_full(),
            })
            .child(trigger)
            .child(
                canvas(
                    move |bounds, _, cx| {
                        entity.update(cx, |select, _| select.trigger_bounds = Some(bounds)).ok();
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .when(self.open, |this| this.child(self.render_popup(cx)))
    }
}
