use std::rc::Rc;

use crate::scale::px;
use gpui::{
    AnyElement, App, ClickEvent, ElementId, IntoElement, RenderOnce, SharedString, Window, div, prelude::*, relative,
};
use theme::ActiveTheme;

use crate::{Card, CardLayout, CardPlane, Icon, IconName, card::divided_rows, metrics, typography};

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ItemVariant {
    #[default]
    Default,
    Outline,
    Muted,
    /// A row inside a list card: square, split by the card's hairlines.
    List,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ItemSize {
    #[default]
    Default,
    Compact,
    /// A catalog row led by a tile, with room around it.
    Comfortable,
}

/// What leads an item.
pub enum ItemMedia {
    /// A muted 16px icon.
    Icon(IconName),
    /// A raised 40px square holding a mark or a letter, as in a catalog of apps.
    Tile(AnyElement),
    Element(AnyElement),
}

/// A row with media, a title, a description and actions (`ui/item.tsx`).
#[derive(IntoElement)]
pub struct Item {
    id: ElementId,
    variant: ItemVariant,
    size: ItemSize,
    media: Option<ItemMedia>,
    title: Option<SharedString>,
    title_trailing: Vec<AnyElement>,
    description: Option<SharedString>,
    description_lines: usize,
    actions: Vec<AnyElement>,
    children: Vec<AnyElement>,
    on_click: Option<ClickHandler>,
    hover_group: Option<SharedString>,
}

impl Item {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            variant: ItemVariant::Default,
            size: ItemSize::Default,
            media: None,
            title: None,
            title_trailing: Vec::new(),
            description: None,
            description_lines: 2,
            actions: Vec::new(),
            children: Vec::new(),
            on_click: None,
            hover_group: None,
        }
    }

    /// Names the row as a hover group, so an action can hide until the row is hovered
    /// (`div().invisible().group_hover(name, |style| style.visible())`).
    pub fn hover_group(mut self, group: impl Into<SharedString>) -> Self {
        self.hover_group = Some(group.into());
        self
    }

    pub fn variant(mut self, variant: ItemVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn size(mut self, size: ItemSize) -> Self {
        self.size = size;
        self
    }

    pub fn media(mut self, media: ItemMedia) -> Self {
        self.media = Some(media);
        self
    }

    pub fn title(mut self, title: impl Into<SharedString>) -> Self {
        self.title = Some(title.into());
        self
    }

    /// Something beside the title, such as a badge.
    pub fn title_trailing(mut self, element: impl IntoElement) -> Self {
        self.title_trailing.push(element.into_any_element());
        self
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// How many lines the description may take before it is cut off (2 by default).
    pub fn description_lines(mut self, lines: usize) -> Self {
        self.description_lines = lines.max(1);
        self
    }

    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.actions.push(action.into_any_element());
        self
    }

    /// Fills on hover, as a button row does.
    pub fn on_click(mut self, handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

impl ParentElement for Item {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Item {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let has_description = self.description.is_some();
        let media = self.media.map(|media| match media {
            ItemMedia::Icon(icon) => div()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .when(has_description, |this| this.self_start().mt(px(2.)))
                .child(Icon::new(icon).color(colors.muted_foreground))
                .into_any_element(),
            ItemMedia::Tile(content) => div()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(40.))
                .rounded(metrics::radius_md())
                .bg(colors.raised)
                .shadow(theme.shadows.raised.clone())
                .text_size(typography::text_base())
                .font_weight(typography::MEDIUM)
                .text_color(colors.muted_foreground)
                .child(content)
                .into_any_element(),
            ItemMedia::Element(element) => div()
                .flex()
                .flex_none()
                .items_center()
                .when(has_description, |this| this.self_start().mt(px(2.)))
                .child(element)
                .into_any_element(),
        });
        let content = (self.title.is_some() || has_description).then(|| {
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .children(self.title.map(|title| {
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .min_w_0()
                        .font_weight(typography::MEDIUM)
                        .line_height(relative(1.375))
                        .child(div().min_w_0().truncate().child(title))
                        .children(self.title_trailing)
                }))
                .children(self.description.map(|description| {
                    div()
                        .line_height(relative(1.5))
                        .text_color(colors.muted_foreground)
                        .line_clamp(self.description_lines)
                        .child(description)
                }))
        });
        let hover = colors.accent;
        div()
            .id(self.id)
            .when_some(self.hover_group, |this, group| this.group(group))
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(8.))
            .w_full()
            .rounded(metrics::radius_md())
            .border_1()
            .border_color(if self.variant == ItemVariant::Outline { colors.divider } else { gpui::transparent_black() })
            .px(px(8.))
            .py(px(6.))
            .font_family(typography::ui_font())
            .text_size(typography::text_sm())
            .text_color(colors.foreground)
            .when(self.variant == ItemVariant::Muted, |this| this.bg(colors.surface))
            .when(self.variant == ItemVariant::List, |this| this.min_h(px(40.)).rounded(px(0.)).px(px(12.)).py(px(8.)))
            .map(|this| match self.size {
                ItemSize::Default => this,
                ItemSize::Compact => this.min_h(metrics::chrome_control()).px(px(4.)).py(px(2.)),
                ItemSize::Comfortable => this.gap(px(12.)).px(px(8.)).py(px(8.)),
            })
            .when_some(self.on_click, |this, handler| {
                this.hover(move |style| style.bg(hover)).on_click(move |event, window, cx| handler(event, window, cx))
            })
            .children(media)
            .children(content)
            .children(self.children)
            .when(!self.actions.is_empty(), |this| this.child(div().flex().flex_none().items_center().gap(px(8.)).children(self.actions)))
    }
}

/// A stack of items 4px apart.
pub fn item_group() -> gpui::Div {
    div().flex().flex_col().w_full().gap(px(4.))
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum GroupedSectionVariant {
    /// Rows inside one grouped card on the background plane, split by inset hairlines.
    #[default]
    Group,
    /// Rows directly on the current plane under a heading, split by hairlines, no card.
    Flat,
    /// Content that brings its own layout.
    Bare,
    /// Borderless rows under a heading, in two columns.
    Grid,
}

/// A small muted title over a grouped card of rows, as in Settings (`ui/grouped-section.tsx`).
#[derive(IntoElement)]
pub struct GroupedSection {
    title: SharedString,
    icon: Option<AnyElement>,
    description: Option<SharedString>,
    actions: Vec<AnyElement>,
    variant: GroupedSectionVariant,
    danger: bool,
    highlighted: bool,
    children: Vec<AnyElement>,
}

impl GroupedSection {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self {
            title: title.into(),
            icon: None,
            description: None,
            actions: Vec::new(),
            variant: GroupedSectionVariant::Group,
            danger: false,
            highlighted: false,
            children: Vec::new(),
        }
    }

    pub fn icon(mut self, icon: impl IntoElement) -> Self {
        self.icon = Some(icon.into_any_element());
        self
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.actions.push(action.into_any_element());
        self
    }

    pub fn variant(mut self, variant: GroupedSectionVariant) -> Self {
        self.variant = variant;
        self
    }

    /// A destructive zone, such as resetting or deleting data.
    pub fn danger(mut self) -> Self {
        self.danger = true;
        self
    }

    /// Rings the card, as a search result.
    pub fn highlighted(mut self, highlighted: bool) -> Self {
        self.highlighted = highlighted;
        self
    }
}

impl ParentElement for GroupedSection {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for GroupedSection {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let heading = matches!(self.variant, GroupedSectionVariant::Flat | GroupedSectionVariant::Grid);
        let title_color = if self.danger {
            colors.destructive
        } else if heading {
            colors.foreground
        } else {
            colors.muted_foreground
        };
        let grid = self.variant == GroupedSectionVariant::Grid;
        let body = match self.variant {
            GroupedSectionVariant::Group => Card::new()
                .layout(CardLayout::List)
                .plane(CardPlane::Background)
                .highlighted(self.highlighted)
                .children(self.children)
                .into_any_element(),
            GroupedSectionVariant::Flat => div().flex().flex_col().min_w_0().children(divided_rows(self.children, colors.divider)).into_any_element(),
            GroupedSectionVariant::Grid => div()
                .grid()
                .grid_cols(2)
                .gap_x(px(24.))
                .gap_y(px(2.))
                .min_w_0()
                .children(self.children)
                .into_any_element(),
            GroupedSectionVariant::Bare => div().flex().flex_col().gap(px(8.)).min_w_0().children(self.children).into_any_element(),
        };
        div()
            .flex()
            .flex_col()
            .min_w_0()
            .gap(px(6.))
            .when(grid, |this| this.mx(px(-8.)))
            .font_family(typography::ui_font())
            .child(
                div()
                    .flex()
                    .items_center()
                    .min_h(px(24.))
                    .min_w_0()
                    .gap(px(8.))
                    .px(if grid { px(8.) } else { px(12.) })
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
                                    .min_w_0()
                                    .gap(px(6.))
                                    .font_weight(typography::MEDIUM)
                                    .text_size(if heading { typography::text_base() } else { typography::text_sm() })
                                    .text_color(title_color)
                                    .children(self.icon)
                                    .child(div().truncate().child(self.title)),
                            )
                            .children(self.description.map(|description| {
                                div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(description)
                            })),
                    )
                    .when(!self.actions.is_empty(), |this| this.child(div().flex().flex_none().items_center().gap(px(4.)).children(self.actions))),
            )
            .child(body)
    }
}
