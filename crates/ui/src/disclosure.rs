//! Sections that open and close: `ui/accordion.tsx` and `ui/collapsible.tsx`. The owner keeps
//! which are open and flips them in `on_toggle`.

use std::rc::Rc;

use crate::scale::px;
use gpui::{AnyElement, App, ClickEvent, ElementId, IntoElement, RenderOnce, Window, div, prelude::*,};
use theme::ActiveTheme;

use crate::{Icon, IconName, IconSize, metrics, typography};

type ToggleHandler = Rc<dyn Fn(bool, &mut Window, &mut App)>;

/// An accordion header (`AccordionTrigger`): the label and a chevron that turns down when open,
/// with an optional action at the far end.
#[derive(IntoElement)]
pub struct AccordionTrigger {
    id: ElementId,
    label: AnyElement,
    open: bool,
    disabled: bool,
    action: Option<AnyElement>,
    on_toggle: Option<ToggleHandler>,
}

impl AccordionTrigger {
    pub fn new(id: impl Into<ElementId>, label: impl IntoElement) -> Self {
        Self { id: id.into(), label: label.into_any_element(), open: false, disabled: false, action: None, on_toggle: None }
    }

    pub fn open(mut self, open: bool) -> Self {
        self.open = open;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.action = Some(action.into_any_element());
        self
    }

    /// Called with the state it should become.
    pub fn on_toggle(mut self, handler: impl Fn(bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_toggle = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for AccordionTrigger {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let open = self.open;
        let chevron = Icon::new(if open { IconName::ChevronDown } else { IconName::ChevronRight }).size(IconSize::Custom(px(12.))).color(colors.subtle_foreground);
        let (hover_bg, hover_text) = (colors.accent, colors.foreground);
        div()
            .flex()
            .w_full()
            .min_w_0()
            .items_center()
            .justify_between()
            .gap(metrics::chrome_gap_tight())
            .bg(colors.background)
            .child(
                div()
                    .id(self.id)
                    .flex()
                    .max_w_full()
                    .h(metrics::tab())
                    .items_center()
                    .gap(metrics::chrome_gap_tight())
                    .px(px(8.))
                    .rounded(metrics::radius_md())
                    .font_family(typography::ui_font())
                    .font_weight(typography::MEDIUM)
                    .text_size(typography::text_chrome())
                    .text_color(colors.muted_foreground)
                    .when(self.disabled, |this| this.opacity(0.5))
                    .when(!self.disabled, |this| this.hover(move |style| style.bg(hover_bg).text_color(hover_text)))
                    .child(div().min_w_0().truncate().child(self.label))
                    .child(chevron)
                    .when_some(self.on_toggle.filter(|_| !self.disabled), |this, handler| this.on_click(move |_: &ClickEvent, window, cx| handler(!open, window, cx))),
            )
            .children(self.action.map(|action| div().flex().flex_none().items_center().child(action)))
    }
}

/// One accordion section: its trigger and, while open, its content.
#[derive(IntoElement)]
pub struct AccordionItem {
    trigger: AccordionTrigger,
    open: bool,
    children: Vec<AnyElement>,
}

impl AccordionItem {
    pub fn new(id: impl Into<ElementId>, label: impl IntoElement) -> Self {
        Self { trigger: AccordionTrigger::new(id, label), open: false, children: Vec::new() }
    }

    pub fn open(mut self, open: bool) -> Self {
        self.open = open;
        self.trigger = self.trigger.open(open);
        self
    }

    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.trigger = self.trigger.action(action);
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.trigger = self.trigger.disabled(disabled);
        self
    }

    pub fn on_toggle(mut self, handler: impl Fn(bool, &mut Window, &mut App) + 'static) -> Self {
        self.trigger = self.trigger.on_toggle(handler);
        self
    }
}

impl ParentElement for AccordionItem {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for AccordionItem {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .min_w_0()
            .child(self.trigger)
            .when(self.open, |this| this.child(div().flex().flex_col().gap(px(4.)).text_size(typography::text_sm()).children(self.children)))
    }
}

/// A column of [`AccordionItem`]s.
#[derive(IntoElement, Default)]
pub struct Accordion {
    gap: Option<gpui::Pixels>,
    children: Vec<AnyElement>,
}

impl Accordion {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn gap(mut self, gap: gpui::Pixels) -> Self {
        self.gap = Some(gap);
        self
    }
}

impl ParentElement for Accordion {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Accordion {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div().flex().flex_col().w_full().when_some(self.gap, |this, gap| this.gap(gap)).children(self.children)
    }
}

/// A trigger that shows or hides the content under it (`Collapsible`), unstyled.
#[derive(IntoElement)]
pub struct Collapsible {
    id: ElementId,
    open: bool,
    trigger: Option<AnyElement>,
    children: Vec<AnyElement>,
    on_open_change: Option<ToggleHandler>,
}

impl Collapsible {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), open: false, trigger: None, children: Vec::new(), on_open_change: None }
    }

    pub fn open(mut self, open: bool) -> Self {
        self.open = open;
        self
    }

    pub fn trigger(mut self, trigger: impl IntoElement) -> Self {
        self.trigger = Some(trigger.into_any_element());
        self
    }

    pub fn on_open_change(mut self, handler: impl Fn(bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_open_change = Some(Rc::new(handler));
        self
    }
}

impl ParentElement for Collapsible {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Collapsible {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let open = self.open;
        div()
            .flex()
            .flex_col()
            .children(self.trigger.map(|trigger| {
                div()
                    .id(self.id)
                    .child(trigger)
                    .when_some(self.on_open_change, |this, handler| this.on_click(move |_: &ClickEvent, window, cx| handler(!open, window, cx)))
            }))
            .when(open, |this| this.children(self.children))
    }
}

