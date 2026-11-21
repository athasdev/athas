use std::rc::Rc;

use gpui::{
    AnyElement, App, ClickEvent, ElementId, InteractiveElement, IntoElement, MouseButton,
    MouseDownEvent, ParentElement, RenderOnce, SharedString, StatefulInteractiveElement, Styled,
    Window, div, prelude::FluentBuilder, px,
};
use theme::ActiveTheme;

use crate::{Icon, IconName, IconSize, metrics, typography};

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;
type MouseHandler = Rc<dyn Fn(&MouseDownEvent, &mut Window, &mut App)>;

/// A sidebar row's tone (`sidebarListItemVariants`): the warning and error tones fill the row with
/// the soft colour and draw its text in the strong one, such as a failed session.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SidebarListItemTone {
    #[default]
    Default,
    Warning,
    Error,
}

/// One row of a sidebar list: a session, a file, a branch. Rows keep the macOS source-list look:
/// no hover fill on the page plane, and the selected row lifts as a raised pill.
#[derive(IntoElement)]
pub struct SidebarListItem {
    id: ElementId,
    label: SharedString,
    leading: Option<AnyElement>,
    trailing: Option<AnyElement>,
    hover_trailing: Option<AnyElement>,
    indicator: Option<AnyElement>,
    description: Option<SharedString>,
    /// Dimmed text on the label's line, after it (a branch's upstream, a tag's pre-release).
    detail: Option<SharedString>,
    struck: bool,
    active: bool,
    emphasized: bool,
    tone: SidebarListItemTone,
    on_page: bool,
    forced_hover: bool,
    on_click: Option<ClickHandler>,
    on_secondary: Option<MouseHandler>,
}

impl SidebarListItem {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: single_line(label.into()),
            leading: None,
            trailing: None,
            hover_trailing: None,
            indicator: None,
            description: None,
            detail: None,
            struck: false,
            active: false,
            emphasized: false,
            tone: SidebarListItemTone::Default,
            on_page: true,
            forced_hover: false,
            on_click: None,
            on_secondary: None,
        }
    }

    pub fn leading(mut self, element: impl IntoElement) -> Self {
        self.leading = Some(element.into_any_element());
        self
    }

    /// Draws the hover state without the pointer (state galleries and snapshots).
    pub fn force_hover(mut self, hovered: bool) -> Self {
        self.forced_hover = hovered;
        self
    }

    pub fn leading_icon(self, icon: IconName) -> Self {
        self.leading(Icon::new(icon).size(IconSize::XSmall))
    }

    pub fn trailing(mut self, element: impl IntoElement) -> Self {
        self.trailing = Some(element.into_any_element());
        self
    }

    /// Shown in place of `trailing` while the pointer is over the row, such as row actions.
    pub fn hover_trailing(mut self, element: impl IntoElement) -> Self {
        self.hover_trailing = Some(element.into_any_element());
        self
    }

    /// A mark that stays in view while the pointer is over the row, such as an unread dot.
    pub fn indicator(mut self, element: Option<impl IntoElement>) -> Self {
        self.indicator = element.map(IntoElement::into_any_element);
        self
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(single_line(description.into()));
        self
    }

    /// Dimmed text after the label on its own line, giving way first when the row is narrow.
    pub fn detail(mut self, detail: impl Into<SharedString>) -> Self {
        self.detail = Some(single_line(detail.into()));
        self
    }

    /// Strikes the label through, for something gone (a branch whose upstream was deleted).
    pub fn struck(mut self, struck: bool) -> Self {
        self.struck = struck;
        self
    }

    pub fn active(mut self, active: bool) -> Self {
        self.active = active;
        self
    }

    /// The active row while its sidebar has focus: `selected-emphasized`, a fill tinted with the
    /// primary colour (`group-focus-within/sidebar-panel:data-[active=true]:bg-selected-emphasized`).
    pub fn emphasized(mut self, emphasized: bool) -> Self {
        self.emphasized = emphasized;
        self
    }

    pub fn tone(mut self, tone: SidebarListItemTone) -> Self {
        self.tone = tone;
        self
    }

    /// For the same row in content, such as a project's dashboard: it fills on hover.
    pub fn in_content(mut self) -> Self {
        self.on_page = false;
        self
    }

    pub fn on_click(mut self, handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }

    pub fn on_secondary_mouse_down(
        mut self,
        handler: impl Fn(&MouseDownEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_secondary = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for SidebarListItem {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = cx.theme();
        let colors = &theme.colors;
        let group = SharedString::from(format!("row-{}", self.id));
        let forced = self.forced_hover && !self.active;
        let toned = match self.tone {
            SidebarListItemTone::Default => None,
            SidebarListItemTone::Warning => Some((colors.warning_soft, colors.warning)),
            SidebarListItemTone::Error => Some((colors.destructive_soft, colors.destructive)),
        };
        let text = match toned {
            Some((_, text)) => text,
            None if self.active || forced => colors.foreground,
            None => colors.muted_foreground,
        };
        let has_hover_trailing = self.hover_trailing.is_some();
        let outline = self.active && theme::accessibility(cx).differentiate_without_color;
        let raised_pill = self.on_page && !theme::glass(cx);

        div()
            .id(self.id)
            .group(group.clone())
            .flex()
            .w_full()
            .min_w_0()
            .items_center()
            .gap(metrics::CHROME_GAP)
            .min_h(metrics::LIST_ROW)
            .px(px(6.))
            .py(px(2.))
            .rounded(metrics::RADIUS_MD)
            .text_size(typography::TEXT_SM)
            .line_height(gpui::relative(typography::LEADING_ROW))
            .text_color(text)
            .when_some(toned, |this, (fill, _)| this.bg(fill))
            .when(self.active && toned.is_none(), |this| {
                if self.emphasized {
                    let this = this.bg(colors.selected_emphasized);
                    if raised_pill { this.shadow(theme.shadows.raised_inset.clone()) } else { this }
                } else if raised_pill {
                    this.bg(colors.raised).shadow(theme.shadows.raised_inset.clone())
                } else {
                    this.bg(colors.selected)
                }
            })
            .when(outline, |this| this.border_1().border_color(colors.border_strong))
            .when(forced && !self.on_page && toned.is_none(), |this| this.bg(colors.accent))
            .when(!self.active && toned.is_none(), |this| {
                let hover_fg = colors.foreground;
                let hover_bg = colors.accent;
                let on_page = self.on_page;
                this.hover(move |style| {
                    let style = style.text_color(hover_fg);
                    if on_page { style } else { style.bg(hover_bg) }
                })
            })
            .children(self.leading.map(|leading| {
                div().flex().flex_none().items_center().justify_center().child(leading)
            }))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .overflow_hidden()
                    .child(
                        div()
                            .flex()
                            .items_baseline()
                            .gap(px(6.))
                            .min_w_0()
                            .child(
                                div()
                                    .flex_shrink_0()
                                    .max_w_full()
                                    .truncate()
                                    .when(self.description.is_some(), |this| {
                                        this.text_color(colors.foreground).font_weight(typography::MEDIUM)
                                    })
                                    .when(self.struck, |this| this.line_through().text_color(colors.subtle_foreground))
                                    .child(self.label),
                            )
                            .children(self.detail.map(|detail| {
                                div().min_w_0().truncate().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(detail)
                            })),
                    )
                    .children(self.description.map(|description| {
                        div()
                            .mt(px(2.))
                            .truncate()
                            .text_color(colors.subtle_foreground)
                            .child(description)
                    })),
            )
            .children(self.indicator.map(|indicator| div().flex().flex_none().items_center().child(indicator)))
            .children(self.trailing.map(|trailing| {
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .text_size(typography::TEXT_SM)
                    .text_color(colors.subtle_foreground)
                    .when(has_hover_trailing, |this| this.group_hover(group.clone(), |style| style.invisible()))
                    .child(trailing)
            }))
            .children(self.hover_trailing.map(|actions| {
                div()
                    .absolute()
                    .right(px(4.))
                    .flex()
                    .items_center()
                    .invisible()
                    .group_hover(group.clone(), |style| style.visible())
                    .child(actions)
            }))
            .relative()
            .when_some(self.on_click, |this, handler| {
                this.on_click(move |event, window, cx| handler(event, window, cx))
            })
            .when_some(self.on_secondary, |this, handler| {
                this.on_mouse_down(MouseButton::Right, move |event, window, cx| handler(event, window, cx))
            })
    }
}

/// The look every sidebar row shares, so a file, an outline symbol or a search hit reads like a
/// session: muted text that brightens on hover with no fill, and the active row lifted as a
/// pill. Rows inside a panel call this instead of filling on hover.
pub fn sidebar_row<E: Styled + InteractiveElement>(row: E, active: bool, emphasized: bool, cx: &App) -> E {
    let theme = cx.theme();
    let colors = &theme.colors;
    let raised_pill = !theme::glass(cx);
    let foreground = colors.foreground;
    if !active {
        return row.text_color(colors.muted_foreground).hover(move |style| style.text_color(foreground));
    }
    let row = row.text_color(foreground);
    match (emphasized, raised_pill) {
        (true, true) => row.bg(colors.selected_emphasized).shadow(theme.shadows.raised_inset.clone()),
        (true, false) => row.bg(colors.selected_emphasized),
        (false, true) => row.bg(colors.raised).shadow(theme.shadows.raised_inset.clone()),
        (false, false) => row.bg(colors.selected),
    }
}

/// A list's quiet title, such as "Sessions", with its actions at the end.
#[derive(IntoElement)]
pub struct SectionLabel {
    label: SharedString,
    /// Shown in place of the label, such as a button that switches what the section shows.
    title: Option<AnyElement>,
    trailing: Option<AnyElement>,
}

impl SectionLabel {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self { label: label.into(), title: None, trailing: None }
    }

    /// A section title that is an element of its own, at the label's place and height.
    pub fn title(title: impl IntoElement) -> Self {
        Self { label: SharedString::default(), title: Some(title.into_any_element()), trailing: None }
    }

    pub fn trailing(mut self, element: impl IntoElement) -> Self {
        self.trailing = Some(element.into_any_element());
        self
    }
}

impl RenderOnce for SectionLabel {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .flex()
            .items_center()
            .min_w_0()
            .h(metrics::CHROME_CONTROL)
            .gap(metrics::CHROME_GAP)
            .pl(px(6.))
            .pr(px(2.))
            .text_size(typography::TEXT_SM)
            .font_weight(typography::MEDIUM)
            .text_color(colors.muted_foreground)
            .map(|this| match self.title {
                Some(title) => this.child(div().flex().flex_1().min_w_0().items_center().child(title)),
                None => this.child(div().flex_1().min_w_0().truncate().child(self.label)),
            })
            .children(self.trailing.map(|trailing| {
                div().flex().flex_none().items_center().gap(px(2.)).child(trailing)
            }))
    }
}

/// A section title that switches what the section shows: the title in the label's own style
/// with a small chevron, brighter while hovered or while its menu is open. Sits in
/// `SectionLabel::title`, its text where a label's text would be.
pub fn section_switcher(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    open: bool,
    cx: &App,
    on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> AnyElement {
    let colors = &cx.theme().colors;
    let (rest, bright) = (colors.muted_foreground, colors.foreground);
    div()
        .id(id.into())
        .flex()
        .items_center()
        .gap(px(4.))
        .min_w_0()
        .h(metrics::CHROME_CONTROL)
        // Out to the label's inset, so the text lines up with the other tools' titles.
        .ml(px(-6.))
        .px(px(6.))
        .rounded(metrics::RADIUS_MD)
        .text_color(if open { bright } else { rest })
        .when(open, |this| this.bg(colors.accent))
        .hover(move |style| style.text_color(bright))
        .cursor_pointer()
        .child(div().min_w_0().truncate().child(label.into()))
        .child(Icon::new(IconName::ChevronDown).size(IconSize::XSmall).color(if open { bright } else { rest }))
        .on_click(on_click)
        .into_any_element()
}

/// A section that folds: its title with a chevron that turns while folded.
#[derive(IntoElement)]
pub struct SectionHeader {
    id: ElementId,
    label: SharedString,
    expanded: bool,
    on_toggle: Option<ClickHandler>,
    trailing: Option<AnyElement>,
}

impl SectionHeader {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>, expanded: bool) -> Self {
        Self { id: id.into(), label: label.into(), expanded, on_toggle: None, trailing: None }
    }

    pub fn on_toggle(mut self, handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        self.on_toggle = Some(Rc::new(handler));
        self
    }

    pub fn trailing(mut self, element: impl IntoElement) -> Self {
        self.trailing = Some(element.into_any_element());
        self
    }
}

impl RenderOnce for SectionHeader {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        let hover = colors.foreground;
        let chevron = if self.expanded { IconName::ChevronDown } else { IconName::ChevronRight };
        div()
            .flex()
            .items_center()
            .justify_between()
            .min_h(metrics::CHROME_CONTROL)
            .min_w_0()
            .child(
                div()
                    .id(self.id)
                    .flex()
                    .items_center()
                    .min_w_0()
                    .gap(metrics::CHROME_GAP)
                    .px(px(6.))
                    .py(px(2.))
                    .rounded(metrics::RADIUS_MD)
                    .text_size(typography::TEXT_SM)
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.muted_foreground)
                    .hover(move |style| style.text_color(hover))
                    .child(Icon::new(chevron).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .child(div().min_w_0().truncate().child(self.label))
                    .when_some(self.on_toggle, |this, handler| {
                        this.on_click(move |event, window, cx| handler(event, window, cx))
                    }),
            )
            .children(self.trailing)
    }
}

/// Joins a multi-line label into one line so a row never grows taller than one line of text.
fn single_line(text: SharedString) -> SharedString {
    if !text.contains(['\n', '\r', '\t']) {
        return text;
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ").into()
}
