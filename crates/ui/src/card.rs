use crate::scale::px;
use gpui::{AnyElement, App, Hsla, IntoElement, RenderOnce, SharedString, Window, div, prelude::*, relative};
use theme::ActiveTheme;

use crate::{Icon, IconName, Tone, metrics, typography};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CardVariant {
    /// A raised panel: separated from its plane by a shadow ring, not a border.
    #[default]
    Default,
    /// A hairline only, for grouping content that stays on the current plane.
    Outline,
    /// A `Default` card that fills on hover.
    Interactive,
    /// Floats over the content it belongs to.
    Elevated,
}

/// The plane the card's fill comes from.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CardPlane {
    #[default]
    Raised,
    Surface,
    Background,
    Overlay,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CardLayout {
    /// Header, content and footer 12px apart.
    #[default]
    Stack,
    /// No spacing of its own.
    Flush,
    /// Short rows packed close.
    Compact,
    /// Rows split by hairlines inset from the card edge; each row owns its padding.
    List,
}

/// A panel of related content (`ui/card.tsx`). Compose it from `CardHeader`, `card_content` and
/// `card_footer`, or any rows.
#[derive(IntoElement)]
pub struct Card {
    variant: CardVariant,
    plane: CardPlane,
    layout: CardLayout,
    accent: bool,
    highlighted: bool,
    children: Vec<AnyElement>,
}

impl Card {
    pub fn new() -> Self {
        Self {
            variant: CardVariant::Default,
            plane: CardPlane::Raised,
            layout: CardLayout::Stack,
            accent: false,
            highlighted: false,
            children: Vec::new(),
        }
    }

    pub fn variant(mut self, variant: CardVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn plane(mut self, plane: CardPlane) -> Self {
        self.plane = plane;
        self
    }

    pub fn layout(mut self, layout: CardLayout) -> Self {
        self.layout = layout;
        self
    }

    /// Tinted with the primary colour, for a callout or a plan.
    pub fn accent(mut self) -> Self {
        self.accent = true;
        self
    }

    /// Rings the card, as a search result.
    pub fn highlighted(mut self, highlighted: bool) -> Self {
        self.highlighted = highlighted;
        self
    }
}

impl Default for Card {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for Card {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

/// Puts an inset hairline above every row but the first.
pub(crate) fn divided_rows(rows: Vec<AnyElement>, divider: Hsla) -> Vec<AnyElement> {
    rows.into_iter()
        .enumerate()
        .map(|(index, row)| {
            div()
                .relative()
                .child(row)
                .when(index > 0, |this| {
                    this.child(div().absolute().top_0().left(px(12.)).right(px(12.)).h(px(1.)).bg(divider))
                })
                .into_any_element()
        })
        .collect()
}

impl RenderOnce for Card {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let fill = match (self.variant, self.plane) {
            (CardVariant::Outline, _) => None,
            (_, CardPlane::Raised) => Some(colors.raised),
            (_, CardPlane::Surface) => Some(colors.surface),
            (_, CardPlane::Background) => Some(colors.background),
            (_, CardPlane::Overlay) => Some(colors.overlay),
        };
        let fill = if self.accent { Some(colors.primary_soft) } else { fill };
        let mut shadow = match self.variant {
            CardVariant::Default | CardVariant::Interactive if !self.accent => theme.shadows.raised.clone(),
            CardVariant::Elevated => theme.shadows.popover.clone(),
            _ => Vec::new(),
        };
        if self.highlighted {
            shadow.push(gpui::BoxShadow {
                color: colors.focus_ring,
                offset: gpui::point(px(0.), px(0.)),
                blur_radius: px(0.),
                spread_radius: px(1.),
                inset: false,
            });
        }
        let children = if self.layout == CardLayout::List { divided_rows(self.children, colors.divider) } else { self.children };
        let hover = colors.accent;
        div()
            .flex()
            .flex_col()
            .overflow_hidden()
            .rounded(metrics::radius_lg())
            .font_family(typography::ui_font())
            .text_size(typography::text_sm())
            .text_color(colors.foreground)
            .when_some(fill, |this, fill| this.bg(fill))
            .when(!shadow.is_empty(), |this| this.shadow(shadow))
            .when(self.variant == CardVariant::Outline, |this| this.border_1().border_color(colors.divider))
            .when(self.variant == CardVariant::Interactive, |this| this.hover(move |style| style.bg(hover)))
            .map(|this| match self.layout {
                CardLayout::Stack => this.gap(px(12.)).py(px(12.)),
                CardLayout::Compact => this.gap(px(6.)).px(px(12.)).py(px(10.)),
                CardLayout::Flush | CardLayout::List => this,
            })
            .children(children)
    }
}

/// A card's title and description, with an action beside them.
#[derive(IntoElement)]
pub struct CardHeader {
    title: SharedString,
    description: Option<SharedString>,
    action: Option<AnyElement>,
}

impl CardHeader {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self { title: title.into(), description: None, action: None }
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.action = Some(action.into_any_element());
        self
    }
}

impl RenderOnce for CardHeader {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .flex()
            .items_start()
            .gap(px(4.))
            .px(px(12.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .gap(px(4.))
                    .child(div().font_weight(typography::MEDIUM).line_height(relative(1.375)).child(self.title))
                    .children(self.description.map(|description| {
                        div().line_height(relative(1.5)).text_color(colors.muted_foreground).child(description)
                    })),
            )
            .children(self.action.map(|action| div().flex_none().child(action)))
    }
}

/// A card's body, inset like its header.
pub fn card_content() -> gpui::Div {
    div().px(px(12.))
}

/// A card's closing row of actions, under a hairline.
pub fn card_footer(cx: &App) -> gpui::Div {
    div().flex().items_center().px(px(12.)).pt(px(12.)).border_t_1().border_color(cx.theme().colors.divider)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum AlertVariant {
    /// A rounded block inside content.
    #[default]
    Card,
    /// Edge to edge, for a strip attached to a pane or popover edge.
    Banner,
    /// A calm notice on the content plane, the tone carried by the icon.
    Inset,
}

/// A notice inside content (`ui/alert.tsx`): an icon, a title, a description and actions.
#[derive(IntoElement)]
pub struct Alert {
    tone: Option<Tone>,
    variant: AlertVariant,
    icon: Option<IconName>,
    title: Option<SharedString>,
    description: Option<SharedString>,
    actions: Vec<AnyElement>,
    corner_action: Option<AnyElement>,
}

impl Alert {
    pub fn new() -> Self {
        Self { tone: None, variant: AlertVariant::Card, icon: None, title: None, description: None, actions: Vec::new(), corner_action: None }
    }

    /// `Neutral` is the default surface-filled alert.
    pub fn tone(mut self, tone: Tone) -> Self {
        self.tone = Some(tone);
        self
    }

    pub fn variant(mut self, variant: AlertVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn title(mut self, title: impl Into<SharedString>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Buttons in their own column, centred beside the text.
    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.actions.push(action.into_any_element());
        self
    }

    /// One control floating in the top-right corner, such as a dismiss button.
    pub fn corner_action(mut self, action: impl IntoElement) -> Self {
        self.corner_action = Some(action.into_any_element());
        self
    }
}

impl Default for Alert {
    fn default() -> Self {
        Self::new()
    }
}

impl RenderOnce for Alert {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        let tone = self.tone.unwrap_or(Tone::Neutral);
        let (fill, icon_color) = match tone {
            Tone::Neutral | Tone::Merged => (colors.surface, colors.muted_foreground),
            Tone::Accent | Tone::Info => (colors.info_soft, colors.info),
            Tone::Success => (colors.success_soft, colors.success),
            Tone::Warning => (colors.warning_soft, colors.warning),
            Tone::Danger => (colors.destructive_soft, colors.destructive),
        };
        let fill = if self.variant == AlertVariant::Inset { colors.background } else { fill };
        let title_color = if tone == Tone::Danger { colors.destructive } else { colors.foreground };
        div()
            .relative()
            .flex()
            .items_start()
            .gap(px(8.))
            .w_full()
            .px(px(10.))
            .py(px(8.))
            .bg(fill)
            .when(self.variant != AlertVariant::Banner, |this| this.rounded(metrics::radius_md()))
            .when(self.corner_action.is_some(), |this| this.pr(px(72.)))
            .font_family(typography::ui_font())
            .text_size(typography::text_sm())
            .text_color(colors.foreground)
            .children(self.icon.map(|icon| div().flex_none().pt(px(2.)).child(Icon::new(icon).color(icon_color))))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .gap(px(2.))
                    .children(self.title.map(|title| div().font_weight(typography::MEDIUM).text_color(title_color).child(title)))
                    .children(self.description.map(|description| {
                        div().line_height(relative(1.5)).text_color(colors.muted_foreground).child(description)
                    })),
            )
            .when(!self.actions.is_empty(), |this| {
                this.child(div().flex().flex_none().self_center().items_center().gap(px(4.)).ml(px(4.)).children(self.actions))
            })
            .children(self.corner_action.map(|action| div().absolute().top(px(6.)).right(px(6.)).child(action)))
    }
}
