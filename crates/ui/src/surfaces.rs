//! `ui/table.tsx`, `ui/hover-card.tsx`, `ui/viewer-state.tsx` and `ui/brand-marks.tsx`.

use std::rc::Rc;

use gpui::{AnyElement, AnyView, App, ClickEvent, Context, ElementId, IntoElement, Pixels, Render, RenderOnce, SharedString, Window, div, img, prelude::*, px};
use theme::ActiveTheme;

use crate::{Button, ButtonVariant, Icon, IconName, IconSize, MenuSize, OVERLAY_MAX_WIDTH, ThinkingOrb, ThinkingOrbState, typography};

/// How wide a [`Table`] column is.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TableColumn {
    /// A share of the space left over.
    Flex(f32),
    Fixed(Pixels),
}

/// A row of a [`Table`].
pub struct TableRow {
    id: ElementId,
    cells: Vec<AnyElement>,
    selected: bool,
    on_click: Option<Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>>,
}

impl TableRow {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), cells: Vec::new(), selected: false, on_click: None }
    }

    pub fn cell(mut self, cell: impl IntoElement) -> Self {
        self.cells.push(cell.into_any_element());
        self
    }

    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    pub fn on_click(mut self, handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

/// Rows under a header of column titles (`Table`): hairlines between rows, the hovered row on
/// the accent plane and the selected one on the selected plane.
#[derive(IntoElement)]
pub struct Table {
    columns: Vec<TableColumn>,
    header: Vec<SharedString>,
    rows: Vec<TableRow>,
    footer: Vec<AnyElement>,
    caption: Option<SharedString>,
}

impl Table {
    pub fn new(columns: Vec<TableColumn>) -> Self {
        Self { columns, header: Vec::new(), rows: Vec::new(), footer: Vec::new(), caption: None }
    }

    pub fn header(mut self, titles: impl IntoIterator<Item = impl Into<SharedString>>) -> Self {
        self.header = titles.into_iter().map(Into::into).collect();
        self
    }

    pub fn row(mut self, row: TableRow) -> Self {
        self.rows.push(row);
        self
    }

    pub fn rows(mut self, rows: impl IntoIterator<Item = TableRow>) -> Self {
        self.rows.extend(rows);
        self
    }

    pub fn footer(mut self, cells: impl IntoIterator<Item = AnyElement>) -> Self {
        self.footer = cells.into_iter().collect();
        self
    }

    pub fn caption(mut self, caption: impl Into<SharedString>) -> Self {
        self.caption = Some(caption.into());
        self
    }
}

fn table_cell(column: Option<TableColumn>) -> gpui::Div {
    let cell = div().flex().items_center().min_w_0().px(px(6.)).overflow_hidden();
    match column.unwrap_or(TableColumn::Flex(1.)) {
        TableColumn::Flex(grow) => {
            let mut cell = cell.flex_basis(px(0.));
            cell.style().flex_grow = Some(grow);
            cell
        }
        TableColumn::Fixed(width) => cell.flex_none().w(width),
    }
}

impl RenderOnce for Table {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let columns = self.columns;
        let column = |index: usize| columns.get(index).copied();
        let row_count = self.rows.len();
        let header = (!self.header.is_empty()).then(|| {
            div()
                .flex()
                .h(px(32.))
                .border_b_1()
                .border_color(colors.divider)
                .bg(colors.background)
                .font_weight(typography::MEDIUM)
                .text_color(colors.muted_foreground)
                .children(self.header.into_iter().enumerate().map(|(index, title)| table_cell(column(index)).whitespace_nowrap().child(title)))
        });
        let rows = self.rows.into_iter().enumerate().map(|(index, row)| {
            let hover = colors.accent;
            div()
                .id(row.id)
                .flex()
                .py(px(6.))
                .text_color(colors.foreground)
                .when(index + 1 < row_count, |this| this.border_b_1().border_color(colors.divider))
                .map(|this| if row.selected { this.bg(colors.selected) } else { this.hover(move |style| style.bg(hover)) })
                .children(row.cells.into_iter().enumerate().map(|(index, cell)| table_cell(column(index)).child(cell)))
                .when_some(row.on_click, |this, handler| this.on_click(move |event, window, cx| handler(event, window, cx)))
        });
        let footer = (!self.footer.is_empty()).then(|| {
            div()
                .flex()
                .py(px(6.))
                .border_t_1()
                .border_color(colors.divider)
                .bg(colors.surface)
                .font_weight(typography::MEDIUM)
                .children(self.footer.into_iter().enumerate().map(|(index, cell)| table_cell(column(index)).child(cell)))
        });
        div()
            .flex()
            .flex_col()
            .w_full()
            .font_family(typography::UI_FONT)
            .text_size(typography::TEXT_SM)
            .children(header)
            .children(rows)
            .children(footer)
            .children(self.caption.map(|caption| div().mt(px(12.)).text_center().text_color(colors.muted_foreground).child(caption)))
    }
}

/// The card that opens while the pointer rests on a link or a name (`HoverCardContent`): the
/// overlay plane with the popover shadow. Show it from `.hoverable_tooltip` with
/// [`HoverCard::build`].
#[derive(IntoElement)]
pub struct HoverCard {
    size: MenuSize,
    preview: bool,
    children: Vec<AnyElement>,
}

impl HoverCard {
    pub fn new() -> Self {
        Self { size: MenuSize::Wide, preview: false, children: Vec::new() }
    }

    pub fn size(mut self, size: MenuSize) -> Self {
        self.size = size;
        self
    }

    /// No padding, for an image or a page preview that runs to the edges.
    pub fn preview(mut self) -> Self {
        self.preview = true;
        self
    }

    /// A view for `.hoverable_tooltip`, drawing `content` in a hover card.
    pub fn build(content: impl Fn(&mut Window, &mut App) -> HoverCard + 'static, cx: &mut App) -> AnyView {
        cx.new(|_| HoverCardView { content: Box::new(content) }).into()
    }
}

impl Default for HoverCard {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for HoverCard {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for HoverCard {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = cx.theme().clone();
        div()
            .id("hover-card")
            .occlude()
            .flex()
            .flex_col()
            .max_w(OVERLAY_MAX_WIDTH)
            .when_some(self.size.width(), |this, width| this.w(width))
            .map(|this| if self.preview { this.overflow_hidden() } else { this.p(px(12.)).gap(px(8.)) })
            .rounded(crate::metrics::RADIUS_XL)
            .bg(theme.colors.overlay)
            .shadow(theme.shadows.popover.clone())
            .font_family(typography::UI_FONT)
            .text_size(typography::TEXT_CHROME)
            .text_color(theme.colors.foreground)
            .children(self.children)
    }
}

struct HoverCardView {
    content: Box<dyn Fn(&mut Window, &mut App) -> HoverCard>,
}

impl Render for HoverCardView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div().pt(px(6.)).child((self.content)(window, cx))
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ViewerLayout {
    /// Fills the viewer.
    #[default]
    Fill,
    /// At least 128px tall, inside a longer page.
    Section,
}

fn viewer_frame(layout: ViewerLayout, cx: &App) -> gpui::Div {
    div()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(12.))
        .p(px(32.))
        .bg(cx.theme().colors.background)
        .font_family(typography::UI_FONT)
        .text_center()
        .map(|this| match layout {
            ViewerLayout::Fill => this.size_full(),
            ViewerLayout::Section => this.w_full().min_h(px(128.)),
        })
}

fn viewer_action(id: &'static str, label: SharedString, handler: Rc<dyn Fn(&mut Window, &mut App)>) -> Button {
    Button::new(id, label).variant(ButtonVariant::Default).on_click(move |_, window, cx| handler(window, cx))
}

/// What a viewer says when it has nothing to show or cannot show it (`ViewerState`).
#[derive(IntoElement, Default)]
pub struct ViewerState {
    title: Option<SharedString>,
    description: Option<SharedString>,
    action: Option<(SharedString, Rc<dyn Fn(&mut Window, &mut App)>)>,
    error: bool,
    layout: ViewerLayout,
}

impl ViewerState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn title(mut self, title: impl Into<SharedString>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn action(mut self, label: impl Into<SharedString>, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.action = Some((label.into(), Rc::new(handler)));
        self
    }

    /// The error tone.
    pub fn error(mut self) -> Self {
        self.error = true;
        self
    }

    pub fn layout(mut self, layout: ViewerLayout) -> Self {
        self.layout = layout;
        self
    }
}

impl RenderOnce for ViewerState {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        viewer_frame(self.layout, cx)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(4.))
                    .max_w(px(420.))
                    .children(self.title.map(|title| {
                        div().text_size(typography::TEXT_BASE).font_weight(typography::SEMIBOLD).text_color(if self.error { colors.destructive } else { colors.foreground }).child(title)
                    }))
                    .children(self.description.map(|description| div().text_size(typography::TEXT_SM).text_color(colors.muted_foreground).child(description))),
            )
            .children(self.action.map(|(label, handler)| viewer_action("viewer-state-action", label, handler)))
    }
}

/// A viewer still loading (`ViewerLoadingState`): the working orb and a label.
#[derive(IntoElement)]
pub struct ViewerLoadingState {
    label: SharedString,
    layout: ViewerLayout,
}

impl ViewerLoadingState {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self { label: label.into(), layout: ViewerLayout::Fill }
    }

    pub fn layout(mut self, layout: ViewerLayout) -> Self {
        self.layout = layout;
        self
    }
}

impl RenderOnce for ViewerLoadingState {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let muted = cx.theme().colors.muted_foreground;
        viewer_frame(self.layout, cx).child(
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .text_size(typography::TEXT_SM)
                .text_color(muted)
                .child(ThinkingOrb::new("viewer-loading-orb").state(ThinkingOrbState::Working).size(px(20.)))
                .child(self.label),
        )
    }
}

/// A viewer that failed (`ViewerErrorState`): the warning mark, the message and a retry.
#[derive(IntoElement)]
pub struct ViewerErrorState {
    message: SharedString,
    action: Option<(SharedString, Rc<dyn Fn(&mut Window, &mut App)>)>,
    layout: ViewerLayout,
}

impl ViewerErrorState {
    pub fn new(message: impl Into<SharedString>) -> Self {
        Self { message: message.into(), action: None, layout: ViewerLayout::Fill }
    }

    pub fn action(mut self, label: impl Into<SharedString>, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.action = Some((label.into(), Rc::new(handler)));
        self
    }

    pub fn layout(mut self, layout: ViewerLayout) -> Self {
        self.layout = layout;
        self
    }
}

impl RenderOnce for ViewerErrorState {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        viewer_frame(self.layout, cx)
            .px(px(24.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(8.))
                    .max_w(px(448.))
                    .child(Icon::new(IconName::WarningCircle).size(IconSize::Custom(px(20.))).color(colors.destructive))
                    .child(div().text_size(typography::TEXT_SM).text_color(colors.muted_foreground).child(self.message)),
            )
            .children(self.action.map(|(label, handler)| viewer_action("viewer-error-action", label, handler)))
    }
}

/// The artwork of an agent, by its id (`agentBrandImages`), as an asset path.
/// The transparency backdrop behind image previews (`bg-checkerboard`): 8 px squares of
/// `surface` on `background`, the top-left square of each 16 px tile being `background`.
pub fn checkerboard(colors: &theme::ThemeColors) -> impl IntoElement {
    let (light, dark) = (colors.background, colors.surface);
    gpui::canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            window.paint_quad(gpui::fill(bounds, light));
            let columns = (f32::from(bounds.size.width) / f32::from(CHECKER_SQUARE)).ceil() as usize;
            let rows = (f32::from(bounds.size.height) / f32::from(CHECKER_SQUARE)).ceil() as usize;
            window.with_content_mask(Some(gpui::ContentMask { bounds }), |window| {
                for row in 0..rows {
                    for column in (0..columns).filter(|column| (column + row) % 2 == 1) {
                        let origin = bounds.origin + gpui::point(CHECKER_SQUARE * column as f32, CHECKER_SQUARE * row as f32);
                        window.paint_quad(gpui::fill(gpui::Bounds::new(origin, gpui::size(CHECKER_SQUARE, CHECKER_SQUARE)), dark));
                    }
                }
            });
        },
    )
    .absolute()
    .inset_0()
}

const CHECKER_SQUARE: Pixels = px(8.);

pub fn agent_brand_image(agent: &str) -> Option<&'static str> {
    Some(match agent {
        "athas" => "icons/athas_mark.png",
        "claude-acp" => "file-icons/claude-color.svg",
        "gemini-cli" => "extensions/icons/athas.agent.gemini-cli.svg",
        "antigravity-acp" => "extensions/icons/athas.agent.antigravity.svg",
        "github-copilot-cli" => "extensions/icons/athas.agent.github-copilot.svg",
        "kimi-cli" => "extensions/icons/athas.agent.kimi-cli.svg",
        "opencode" => "extensions/icons/athas.agent.opencode.svg",
        "qwen-code" => "extensions/icons/athas.agent.qwen-code.svg",
        _ => return None,
    })
}

/// A third party's mark in its own colours (`brand-marks.tsx`): not a UI icon, so it keeps its
/// artwork instead of taking the text colour.
#[derive(IntoElement)]
pub struct BrandMark {
    source: BrandSource,
    size: Pixels,
}

enum BrandSource {
    Image(&'static str),
    Github,
}

impl BrandMark {
    pub fn athas() -> Self {
        Self { source: BrandSource::Image("icons/athas_mark.png"), size: px(16.) }
    }

    /// The GitHub octocat, drawn in the text colour like the web mark's `currentColor`.
    pub fn github() -> Self {
        Self { source: BrandSource::Github, size: px(16.) }
    }

    pub fn agent(agent: &str) -> Option<Self> {
        agent_brand_image(agent).map(|path| Self { source: BrandSource::Image(path), size: px(16.) })
    }

    pub fn size(mut self, size: Pixels) -> Self {
        self.size = size;
        self
    }
}

impl RenderOnce for BrandMark {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        match self.source {
            BrandSource::Image(path) => img(path).flex_none().size(self.size).into_any_element(),
            BrandSource::Github => Icon::new(IconName::Github).size(IconSize::Custom(self.size)).color(cx.theme().colors.foreground).into_any_element(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brand_images_resolve_like_athas() {
        assert_eq!(agent_brand_image("antigravity-acp"), Some("extensions/icons/athas.agent.antigravity.svg"));
        assert_eq!(agent_brand_image("unknown"), None);
        for path in ["icons/athas_mark.png", "extensions/icons/athas.agent.claude-acp.svg", "extensions/icons/athas.agent.opencode.svg"] {
            assert!(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets").join(path).exists(), "{path}");
        }
    }
}
