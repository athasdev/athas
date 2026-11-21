//! Small pieces the GitHub views share: badges, label chips, status icons, list rows, hover
//! previews and the resource page layout (`src/ui/resource.tsx`, `github-chips.tsx`).

use gpui::{
    AnyElement, AnyView, App, ClickEvent, Context, Div, ElementId, Hsla, IntoElement, ParentElement, Render, SharedString,
    Stateful, Styled, Window, div, prelude::*, px, relative,
};
use theme::{ActiveTheme, ThemeColors};
use ui::{Avatar, Icon, IconName, IconSize, metrics, typography};

use crate::model::{Phase, RunState, Tone};

pub fn tone_color(tone: Tone, colors: &ThemeColors) -> Hsla {
    match tone {
        Tone::Success => colors.success,
        Tone::Error => colors.destructive,
        Tone::Warning => colors.warning,
        Tone::Accent => colors.primary,
        Tone::Merged => colors.merged,
        Tone::Muted => colors.subtle_foreground,
    }
}

fn tone_soft(tone: Tone, colors: &ThemeColors) -> Hsla {
    match tone {
        Tone::Success => colors.success_soft,
        Tone::Error => colors.destructive_soft,
        Tone::Warning => colors.warning_soft,
        Tone::Accent => colors.primary_soft,
        Tone::Merged => colors.merged_soft,
        Tone::Muted => colors.segment_track,
    }
}

/// A small status pill, such as "Open" or "Changes requested".
pub fn badge(label: impl Into<SharedString>, tone: Tone, colors: &ThemeColors) -> Div {
    let fg = if tone == Tone::Muted { colors.muted_foreground } else { tone_color(tone, colors) };
    div()
        .flex()
        .flex_none()
        .items_center()
        .h(px(18.))
        .px(px(6.))
        .rounded_full()
        .bg(tone_soft(tone, colors))
        .text_size(typography::TEXT_CAPTION)
        .font_weight(typography::MEDIUM)
        .text_color(fg)
        .whitespace_nowrap()
        .child(label.into())
}

/// A repository label in its GitHub colour.
pub fn label_chip(name: &str, color: &str, colors: &ThemeColors) -> Div {
    let tint: Hsla = crate::model::label_rgb(color)
        .map(|(r, g, b)| gpui::Rgba { r, g, b, a: 1. }.into())
        .unwrap_or(colors.subtle_foreground);
    div()
        .flex()
        .flex_none()
        .items_center()
        .gap(px(4.))
        .h(px(18.))
        .px(px(6.))
        .rounded_full()
        .bg(tint.opacity(0.16))
        .text_size(typography::TEXT_CAPTION)
        .font_weight(typography::MEDIUM)
        .text_color(colors.foreground)
        .whitespace_nowrap()
        .child(div().size(px(6.)).rounded_full().bg(tint))
        .child(name.to_string())
}

/// The icon of a run, job, step or check in its phase's colour (`WorkflowStatusIcon`).
pub fn run_status_icon(state: &RunState, size: IconSize, colors: &ThemeColors) -> Icon {
    let icon = match state.phase {
        Phase::Success => IconName::CheckCircle,
        Phase::Failure => IconName::Xcircle,
        Phase::Cancelled | Phase::Skipped => IconName::MinusCircle,
        Phase::ActionRequired => IconName::WarningCircle,
        Phase::Queued => IconName::Clock,
        Phase::Waiting => IconName::Pause,
        Phase::Running => IconName::CircleDotted,
        Phase::Neutral | Phase::Unknown => IconName::CircleDot,
    };
    Icon::new(icon).size(size).color(tone_color(state.tone, colors))
}

pub fn avatar(login: &str, size: f32) -> Avatar {
    Avatar::new(login).size(px(size)).image(Some(ui::avatar::github_avatar_url(login)))
}

pub fn caption(text: impl Into<SharedString>, colors: &ThemeColors) -> Div {
    div().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(text.into())
}

/// One sidebar row: leading avatar or icon, title, a dimmed secondary text, then meta that gives
/// way to the row's actions on hover (`StreamRow`).
pub struct Row {
    pub id: ElementId,
    pub leading: AnyElement,
    pub title: SharedString,
    pub secondary: Option<SharedString>,
    pub meta: Option<AnyElement>,
    /// Shown in place of the meta while the row is hovered.
    pub action: Option<AnyElement>,
    pub selected: bool,
}

impl Row {
    pub fn new(id: impl Into<ElementId>, leading: impl IntoElement, title: impl Into<SharedString>) -> Self {
        Self { id: id.into(), leading: leading.into_any_element(), title: title.into(), secondary: None, meta: None, action: None, selected: false }
    }

    pub fn render(self, colors: &ThemeColors) -> Stateful<Div> {
        let hover = colors.foreground;
        let has_action = self.action.is_some();
        div()
            .id(self.id)
            .group("github-row")
            .relative()
            .flex()
            .items_center()
            .gap(px(8.))
            .h(metrics::LIST_ROW)
            .px(px(8.))
            .rounded(metrics::RADIUS_MD)
            .text_size(typography::TEXT_SM)
            .line_height(relative(typography::LEADING_ROW))
            .text_color(if self.selected { colors.foreground } else { colors.muted_foreground })
            .when(self.selected, |this| this.bg(colors.selected))
            .hover(move |style| style.text_color(hover))
            .child(div().flex().flex_none().items_center().justify_center().size(px(18.)).child(self.leading))
            .child(
                div()
                    .flex_shrink(1.)
                    .min_w_0()
                    .truncate()
                    .when(self.selected, |this| this.font_weight(typography::MEDIUM))
                    .child(self.title),
            )
            .child(
                div()
                    .flex_1()
                    .min_w(px(24.))
                    .truncate()
                    .text_size(typography::TEXT_CAPTION)
                    .text_color(colors.subtle_foreground)
                    .children(self.secondary),
            )
            .children(self.meta.map(|meta| {
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .text_size(typography::TEXT_CAPTION)
                    .text_color(colors.subtle_foreground)
                    .when(has_action, |this| this.group_hover("github-row", |style| style.invisible()))
                    .child(meta)
            }))
            .children(self.action.map(|action| {
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .right(px(4.))
                    .flex()
                    .items_center()
                    .invisible()
                    .group_hover("github-row", |style| style.visible())
                    .child(action)
            }))
    }
}

/// A folding group heading with its count (`StreamGroup`).
pub fn group_header(
    id: impl Into<ElementId>,
    title: &str,
    count: usize,
    open: bool,
    colors: &ThemeColors,
    on_toggle: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
    let hover = colors.foreground;
    div()
        .id(id)
        .flex()
        .items_center()
        .gap(px(6.))
        .h(metrics::LIST_ROW)
        .px(px(8.))
        .text_size(typography::TEXT_SM)
        .font_weight(typography::MEDIUM)
        .text_color(colors.muted_foreground)
        .hover(move |style| style.text_color(hover))
        .child(Icon::new(if open { IconName::ChevronDown } else { IconName::ChevronRight }).size(IconSize::XSmall).color(colors.subtle_foreground))
        .child(div().min_w_0().truncate().child(title.to_string()))
        .child(caption(count.to_string(), colors))
        .on_click(on_toggle)
}

/// What an empty or failed list says, centred in the list (`StreamEmpty`).
pub fn list_message(title: impl Into<SharedString>, hint: Option<SharedString>, action: Option<AnyElement>, colors: &ThemeColors) -> Div {
    div()
        .flex()
        .flex_col()
        .items_center()
        .gap(px(4.))
        .px(px(16.))
        .py(px(24.))
        .text_center()
        .text_size(typography::TEXT_SM)
        .child(div().text_color(colors.muted_foreground).child(title.into()))
        .children(hint.map(|hint| div().text_color(colors.subtle_foreground).child(hint)))
        .children(action.map(|action| div().mt(px(6.)).child(action)))
}

/// The card a sidebar row shows on hover (`GitHubSidebarRow`'s preview).
#[derive(Clone)]
pub struct Preview {
    pub title: SharedString,
    pub subtitle: SharedString,
    pub leading: PreviewLeading,
    pub badges: Vec<(SharedString, Tone)>,
    pub labels: Vec<(String, String)>,
    pub details: Vec<(SharedString, SharedString, bool)>,
    /// A detail row that acts when clicked (the pull request's Changes row opens its files), by
    /// index; the card then stays open while the pointer is on it.
    pub action: Option<(usize, std::rc::Rc<dyn Fn(&mut Window, &mut App)>)>,
}

#[derive(Clone)]
pub enum PreviewLeading {
    Avatar(String),
    Run(RunState),
}

impl Preview {
    pub fn tooltip(self) -> impl Fn(&mut Window, &mut App) -> AnyView + 'static {
        move |_, cx| cx.new(|_| self.clone()).into()
    }
}

impl Render for Preview {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let leading = match &self.leading {
            PreviewLeading::Avatar(login) => avatar(login, 28.).into_any_element(),
            PreviewLeading::Run(state) => run_status_icon(state, IconSize::Medium, colors).into_any_element(),
        };
        div().pl(px(10.)).child(
            div()
                .flex()
                .flex_col()
                .w(px(320.))
                .rounded(metrics::RADIUS_LG)
                .bg(colors.overlay)
                .shadow(theme.shadows.popover.clone())
                .font_family(typography::UI_FONT)
                .text_size(typography::TEXT_SM)
                .child(
                    div()
                        .flex()
                        .items_start()
                        .gap(px(10.))
                        .px(px(12.))
                        .pt(px(12.))
                        .child(div().mt(px(2.)).flex_none().child(leading))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_w_0()
                                .gap(px(2.))
                                .child(div().text_size(typography::TEXT_BASE).font_weight(typography::MEDIUM).text_color(colors.foreground).line_clamp(2).child(self.title.clone()))
                                .child(div().truncate().text_color(colors.subtle_foreground).child(self.subtitle.clone())),
                        ),
                )
                .when(!self.badges.is_empty() || !self.labels.is_empty(), |this| {
                    this.child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(6.))
                            .px(px(12.))
                            .pt(px(10.))
                            .children(self.badges.iter().map(|(label, tone)| badge(label.clone(), *tone, colors)))
                            .children(self.labels.iter().map(|(name, color)| label_chip(name, color, colors))),
                    )
                })
                .child(
                    div().flex().flex_col().gap(px(6.)).px(px(12.)).pt(px(10.)).pb(px(12.)).children(self.details.iter().enumerate().map(|(index, (label, value, mono))| {
                        let action = self.action.as_ref().filter(|(at, _)| *at == index).map(|(_, action)| action.clone());
                        let hover = colors.accent;
                        div()
                            .id(("preview-detail", index))
                            .flex()
                            .gap(px(12.))
                            .when_some(action, |this, action| {
                                this.mx(px(-4.)).px(px(4.)).rounded(metrics::RADIUS).hover(move |style| style.bg(hover)).on_click(move |_, window, cx| action(window, cx))
                            })
                            .child(div().w(px(76.)).flex_none().text_color(colors.subtle_foreground).child(label.clone()))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .truncate()
                                    .text_color(colors.foreground)
                                    .when(*mono, |this| this.font_family(typography::MONO_FONT))
                                    .child(value.clone()),
                            )
                    })),
                ),
        )
    }
}

// The resource page: a summary band, a tab row, then content on one centred rail.

pub const RAIL_WIDTH: f32 = 1152.;

/// Centres content on the resource rail with the page's side padding.
pub fn rail(child: impl IntoElement) -> Div {
    div().w_full().px(px(24.)).child(div().w_full().max_w(px(RAIL_WIDTH)).mx_auto().child(child))
}

pub struct Summary {
    pub icon: AnyElement,
    pub title: AnyElement,
    pub badges: Vec<AnyElement>,
    pub description: Option<SharedString>,
    pub meta: Vec<AnyElement>,
    pub actions: Vec<AnyElement>,
    pub aside: Option<AnyElement>,
}

impl Summary {
    pub fn render(self, colors: &ThemeColors) -> Div {
        div()
            .flex()
            .items_start()
            .gap(px(24.))
            .min_w_0()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .min_w_0()
                            .child(div().flex().flex_none().items_center().child(self.icon))
                            .child(
                                div()
                                    .flex()
                                    .min_w_0()
                                    .text_size(typography::TEXT_LG)
                                    .font_weight(typography::SEMIBOLD)
                                    .text_color(colors.foreground)
                                    .child(self.title),
                            )
                            .child(div().flex().flex_none().items_center().gap(px(6.)).children(self.badges)),
                    )
                    .children(self.description.map(|description| {
                        div().mt(px(4.)).truncate().text_size(typography::TEXT_SM).text_color(colors.muted_foreground).child(description)
                    }))
                    .when(!self.meta.is_empty(), |this| {
                        this.child(
                            div()
                                .mt(px(6.))
                                .flex()
                                .flex_wrap()
                                .items_center()
                                .gap_x(px(12.))
                                .gap_y(px(4.))
                                .text_size(typography::TEXT_SM)
                                .text_color(colors.subtle_foreground)
                                .children(self.meta),
                        )
                    }),
            )
            .when(!self.actions.is_empty() || self.aside.is_some(), |this| {
                this.child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_none()
                        .items_end()
                        .gap(px(12.))
                        .child(div().flex().items_center().gap(px(4.)).children(self.actions))
                        .children(self.aside.map(|aside| div().w(px(300.)).child(aside))),
                )
            })
    }
}

/// A summary title that is only text.
pub fn title_text(title: impl Into<SharedString>) -> AnyElement {
    div().min_w_0().truncate().child(title.into()).into_any_element()
}

/// A meta item in a summary: an optional icon and text, a link when `url` is given.
pub fn meta_chip(id: impl Into<ElementId>, icon: Option<IconName>, text: impl Into<SharedString>, url: Option<String>, mono: bool, colors: &ThemeColors) -> Stateful<Div> {
    let hover = colors.foreground;
    div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .gap(px(4.))
        .max_w(px(280.))
        .whitespace_nowrap()
        .when(mono, |this| this.font_family(typography::MONO_FONT).text_size(typography::TEXT_CAPTION))
        .children(icon.map(|icon| Icon::new(icon).size(IconSize::XSmall).color(colors.subtle_foreground)))
        .child(div().min_w_0().truncate().child(text.into()))
        .when_some(url, |this, url| this.hover(move |style| style.text_color(hover)).on_click(move |_, _, cx| crate::links::open(cx, &url)))
}

/// A person: their initial and login, opening their profile.
pub fn user_chip(id: impl Into<ElementId>, login: &str, colors: &ThemeColors) -> Stateful<Div> {
    let url = format!("https://github.com/{login}");
    let hover = colors.foreground;
    div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .gap(px(6.))
        .min_w_0()
        .child(avatar(login, 18.))
        .child(div().min_w_0().truncate().child(login.to_string()))
        .hover(move |style| style.text_color(hover))
        .on_click(move |_, _, cx| cx.open_url(&url))
}

/// A titled block of a resource page (`ResourceSection`).
pub fn section(title: impl Into<SharedString>, action: Option<AnyElement>, body: impl IntoElement, colors: &ThemeColors) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(10.))
        .min_w_0()
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(8.))
                .child(div().text_size(typography::TEXT_SM).font_weight(typography::MEDIUM).text_color(colors.muted_foreground).child(title.into()))
                .children(action),
        )
        .child(div().min_w_0().text_size(typography::TEXT_SM).child(body))
}

/// The ring on the timeline's line: an event icon or an avatar (`GitHubTimelineMarker`).
pub fn timeline_marker(child: impl IntoElement, colors: &ThemeColors) -> Div {
    div().flex().flex_none().items_center().justify_center().size(px(24.)).rounded_full().bg(colors.background).child(child)
}

/// The activity list with its connecting line behind the markers.
pub fn timeline(items: Vec<AnyElement>, colors: &ThemeColors) -> Div {
    div()
        .relative()
        .flex()
        .flex_col()
        .gap(px(20.))
        .child(div().absolute().top(px(12.)).bottom(px(12.)).left(px(12.)).w(px(1.)).bg(colors.divider))
        .children(items)
}

/// A one-line timeline event: marker, then words.
pub fn event_row(marker: impl IntoElement, words: Vec<AnyElement>, colors: &ThemeColors) -> Div {
    div().flex().items_start().gap(px(12.)).min_w_0().child(timeline_marker(marker, colors)).child(
        div()
            .flex()
            .flex_wrap()
            .flex_1()
            .min_w_0()
            .min_h(px(24.))
            .items_center()
            .gap_x(px(6.))
            .text_size(typography::TEXT_SM)
            .text_color(colors.subtle_foreground)
            .children(words),
    )
}

/// Centred quiet text, for a view's loading and error states.
pub fn fill_message(title: impl Into<SharedString>, message: Option<SharedString>, action: Option<AnyElement>, colors: &ThemeColors) -> Div {
    div()
        .flex()
        .flex_1()
        .size_full()
        .min_h(px(160.))
        .items_center()
        .justify_center()
        .child(list_message(title, message, action, colors))
}

pub fn mono_numbers(additions: i64, deletions: i64, colors: &ThemeColors) -> Div {
    div()
        .flex()
        .flex_none()
        .gap(px(4.))
        .font_family(typography::MONO_FONT)
        .text_size(typography::TEXT_CAPTION)
        .child(div().text_color(colors.git_added).child(format!("+{additions}")))
        .child(div().text_color(colors.git_deleted).child(format!("−{deletions}")))
}

/// The row's Open in new window button (`StreamIconButton`).
pub fn new_window_button(id: impl Into<ElementId>, on_click: impl Fn(&mut Window, &mut App) + 'static) -> AnyElement {
    ui::Button::icon(id, IconName::WindowExpand)
        .size(ui::ButtonSize::XSmall)
        .tooltip("Open in new window")
        .on_click(move |_, window, cx| {
            cx.stop_propagation();
            on_click(window, cx);
        })
        .into_any_element()
}
