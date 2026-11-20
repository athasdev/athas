use std::rc::Rc;

use gpui::{
    AnyElement, App, ClickEvent, ElementId, Hsla, IntoElement, ParentElement, RenderOnce,
    SharedString, StatefulInteractiveElement, Styled, Window, div, prelude::FluentBuilder, px,
};
use gpui::prelude::*;
use theme::ActiveTheme;

use crate::{Icon, IconName, IconSize, Tooltip, TooltipExt, typography};

/// How a button is filled.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ButtonVariant {
    /// Neutral filled button: secondary actions, form controls.
    #[default]
    Default,
    /// Solid primary button: the one call to action on a surface.
    Accent,
    /// An action that deletes or discards something.
    Destructive,
    /// A field-shaped trigger: selects and pickers that sit among inputs.
    Outline,
    /// Borderless: toolbars, icon buttons, quiet actions.
    Ghost,
    /// A view switch in a header: no fill, the active one reads by tone.
    Tab,
}

/// Colour of the label, for status-bearing actions.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ButtonTone {
    #[default]
    Default,
    Neutral,
    Accent,
    Success,
    Warning,
    Danger,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ButtonSize {
    /// Inside inputs and table cells.
    XSmall,
    /// Toolbars, chrome bars, sidebars.
    Small,
    /// Forms, dialogs, and page content.
    #[default]
    Medium,
    /// The activity rail and other primary navigation.
    Large,
}

/// The plane a control sits on. On the page (the sidebar and the rail) a selected control lifts
/// as a raised pill instead of taking the selected grey.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Plane {
    #[default]
    Content,
    Page,
}

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Button {
    id: ElementId,
    label: Option<SharedString>,
    icon: Option<IconName>,
    icon_path: Option<&'static str>,
    trailing_icon: Option<IconName>,
    leading: Option<AnyElement>,
    variant: ButtonVariant,
    tone: ButtonTone,
    size: ButtonSize,
    plane: Plane,
    icon_only: bool,
    active: bool,
    disabled: bool,
    full_width: bool,
    align_start: bool,
    align_between: bool,
    medium_weight: bool,
    filled_when_active: bool,
    shrink: bool,
    tooltip: Option<SharedString>,
    tooltip_side: crate::TooltipSide,
    shortcut: Option<SharedString>,
    secondary_label: Option<SharedString>,
    forced_hover: bool,
    on_click: Option<ClickHandler>,
}

impl Button {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            label: Some(label.into()),
            ..Self::empty(id)
        }
    }

    /// A square button that only shows an icon; give it a tooltip.
    pub fn icon(id: impl Into<ElementId>, icon: IconName) -> Self {
        Self {
            icon: Some(icon),
            icon_only: true,
            variant: ButtonVariant::Ghost,
            ..Self::empty(id)
        }
    }

    fn empty(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            label: None,
            icon: None,
            icon_path: None,
            trailing_icon: None,
            leading: None,
            variant: ButtonVariant::default(),
            tone: ButtonTone::default(),
            size: ButtonSize::default(),
            plane: Plane::default(),
            icon_only: false,
            active: false,
            disabled: false,
            full_width: false,
            align_start: false,
            align_between: false,
            medium_weight: true,
            filled_when_active: false,
            shrink: false,
            tooltip: None,
            tooltip_side: crate::TooltipSide::Top,
            shortcut: None,
            secondary_label: None,
            forced_hover: false,
            on_click: None,
        }
    }

    /// A square button: for a custom icon or a glyph given through `icon_path` or `leading`.
    pub fn icon_only(mut self) -> Self {
        self.icon_only = true;
        self.label = None;
        self
    }

    pub fn leading_icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    /// An icon outside the Nucleo set, such as the GitHub mark.
    pub fn icon_path(mut self, path: &'static str) -> Self {
        self.icon_path = Some(path);
        self
    }

    pub fn trailing_icon(mut self, icon: IconName) -> Self {
        self.trailing_icon = Some(icon);
        self
    }

    /// Something other than an icon before the label, such as a project glyph.
    pub fn leading(mut self, element: impl IntoElement) -> Self {
        self.leading = Some(element.into_any_element());
        self
    }

    pub fn variant(mut self, variant: ButtonVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn tone(mut self, tone: ButtonTone) -> Self {
        self.tone = tone;
        self
    }

    pub fn size(mut self, size: ButtonSize) -> Self {
        self.size = size;
        self
    }

    pub fn plane(mut self, plane: Plane) -> Self {
        self.plane = plane;
        self
    }

    pub fn active(mut self, active: bool) -> Self {
        self.active = active;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn full_width(mut self) -> Self {
        self.full_width = true;
        self
    }

    /// Label at the start and the trailing icon at the end (`align="between"`), for full-width
    /// pickers.
    pub fn align_between(mut self) -> Self {
        self.align_start = true;
        self.align_between = true;
        self
    }

    pub fn align_start(mut self) -> Self {
        self.align_start = true;
        self
    }

    pub fn regular_weight(mut self) -> Self {
        self.medium_weight = false;
        self
    }

    /// Shows the icon's solid variant while active, as the activity rail does.
    pub fn filled_when_active(mut self) -> Self {
        self.filled_when_active = true;
        self
    }

    /// Lets the button narrow with its row, truncating its label.
    pub fn shrinkable(mut self) -> Self {
        self.shrink = true;
        self
    }

    pub fn tooltip(mut self, tooltip: impl Into<SharedString>) -> Self {
        self.tooltip = Some(tooltip.into());
        self
    }

    /// Draws the hover state without the pointer (state galleries and snapshots).
    pub fn force_hover(mut self, hovered: bool) -> Self {
        self.forced_hover = hovered;
        self
    }

    /// Which side the tooltip opens on (top by default; the activity bar's open to the right).
    pub fn tooltip_side(mut self, side: crate::TooltipSide) -> Self {
        self.tooltip_side = side;
        self
    }

    /// Quieter text after the label, as in "Opus 5.5 Medium".
    pub fn secondary_label(mut self, text: impl Into<SharedString>) -> Self {
        self.secondary_label = Some(text.into());
        self
    }

    pub fn shortcut(mut self, shortcut: impl Into<SharedString>) -> Self {
        self.shortcut = Some(shortcut.into());
        self
    }

    pub fn on_click(mut self, handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

struct SizeSpec {
    height: f32,
    padding: f32,
    gap: f32,
    text: gpui::Pixels,
    icon: IconSize,
    radius: Option<gpui::Pixels>,
}

impl ButtonSize {
    fn spec(self) -> SizeSpec {
        match self {
            ButtonSize::XSmall => SizeSpec {
                height: 20.,
                padding: 6.,
                gap: 4.,
                text: typography::TEXT_CAPTION,
                icon: IconSize::XSmall,
                radius: None,
            },
            ButtonSize::Small => SizeSpec {
                height: 24.,
                padding: 8.,
                gap: 4.,
                text: typography::TEXT_CHROME,
                icon: IconSize::XSmall,
                radius: None,
            },
            ButtonSize::Medium => SizeSpec {
                height: 28.,
                padding: 10.,
                gap: 6.,
                text: typography::TEXT_SM,
                icon: IconSize::Small,
                radius: None,
            },
            ButtonSize::Large => SizeSpec {
                height: 32.,
                padding: 12.,
                gap: 8.,
                text: typography::TEXT_BASE,
                icon: IconSize::Medium,
                radius: None,
            },
        }
    }
}

/// The hover group each button names, so its icon follows its hover colour.
const BUTTON_GROUP: &str = "ui-button";

impl RenderOnce for Button {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        let muted = colors.muted_foreground;
        let shadows = &cx.theme().shadows;
        let spec = self.size.spec();
        let transparent = gpui::transparent_black();

        // (fill, text, hover fill, hover text)
        let (mut bg, mut fg, mut hover_bg, mut hover_fg): (Hsla, Hsla, Hsla, Hsla) = match self.variant {
            ButtonVariant::Default => (colors.accent, colors.foreground, colors.selected, colors.foreground),
            ButtonVariant::Accent => {
                (colors.primary, colors.primary_foreground, colors.primary_hover, colors.primary_foreground)
            }
            ButtonVariant::Destructive => {
                let hover = colors.destructive.opacity(0.2);
                (colors.destructive_soft, colors.destructive, hover, colors.destructive)
            }
            ButtonVariant::Outline => (colors.raised, colors.foreground, colors.accent, colors.foreground),
            // The window tab's look, Athas's trigger style: a soft track on hover, a raised knob
            // while active (the sidebar toggle, the project switcher, the rail).
            ButtonVariant::Ghost => (transparent, colors.subtle_foreground, colors.segment_track, colors.foreground),
            ButtonVariant::Tab => (transparent, colors.subtle_foreground, transparent, colors.foreground),
        };
        let mut shadow = (self.variant == ButtonVariant::Outline).then(|| shadows.raised.clone());

        if self.active {
            match self.variant {
                ButtonVariant::Default => bg = colors.selected,
                ButtonVariant::Accent => bg = colors.primary_hover,
                ButtonVariant::Outline => bg = colors.selected,
                ButtonVariant::Ghost => {
                    fg = colors.foreground;
                    bg = colors.segment_knob;
                    shadow = Some(shadows.raised_inset.clone());
                    hover_bg = bg;
                }
                ButtonVariant::Tab => fg = colors.foreground,
                ButtonVariant::Destructive => {}
            }
        }

        let tone = match self.tone {
            ButtonTone::Default => None,
            ButtonTone::Neutral => Some(colors.foreground),
            ButtonTone::Accent => Some(colors.primary),
            ButtonTone::Success => Some(colors.success),
            ButtonTone::Warning => Some(colors.warning),
            ButtonTone::Danger => Some(colors.destructive),
        };
        if let Some(tone) = tone {
            fg = tone;
            hover_fg = tone;
            if self.tone == ButtonTone::Danger && self.variant == ButtonVariant::Ghost {
                hover_bg = colors.destructive_soft;
            }
        }
        if self.active && self.variant == ButtonVariant::Ghost {
            hover_fg = fg;
        }

        if self.forced_hover && !self.disabled {
            bg = hover_bg;
            fg = hover_fg;
        }
        let icon_color = fg;
        // Icons are `currentColor` in the original: they follow the label on hover.
        let icon_hover = (!self.disabled && hover_fg != fg).then_some(hover_fg);
        let icon = |name: IconName, filled: bool| {
            let icon = Icon::new(name).size(spec.icon).color(icon_color).filled(filled);
            match icon_hover {
                Some(color) => icon.group_hover_color(BUTTON_GROUP, color),
                None => icon,
            }
        };
        let filled = self.filled_when_active && self.active;

        let mut button = div()
            .id(self.id.clone())
            .group(BUTTON_GROUP)
            .flex()
            .when(!self.shrink, |this| this.flex_none())
            .when(self.shrink, |this| this.flex_shrink(1.).max_w_full().overflow_hidden())
            .items_center()
            .justify_center()
            .h(px(spec.height))
            .min_w_0()
            .gap(px(spec.gap))
            .text_size(spec.text)
            .line_height(gpui::relative(typography::LEADING_ROW))
            .whitespace_nowrap()
            .bg(bg)
            .text_color(fg)
            .when(self.medium_weight, |this| this.font_weight(typography::MEDIUM))
            .when_some(spec.radius, |this, radius| this.rounded(radius))
            .when(spec.radius.is_none(), |this| this.rounded_full())
            .when_some(shadow, |this, shadow| this.shadow(shadow))
            .when(self.icon_only, |this| this.w(px(spec.height)))
            .when(!self.icon_only, |this| this.px(px(spec.padding)))
            .when(self.full_width, |this| this.w_full())
            .when(self.align_start, |this| this.justify_start());

        if !self.disabled {
            button = button.hover(move |style| style.bg(hover_bg).text_color(hover_fg));
        } else {
            button = button.opacity(0.5);
        }

        if let Some(path) = self.icon_path {
            let icon = Icon::from_path(path).size(spec.icon).color(icon_color);
            button = button.child(match icon_hover {
                Some(color) => icon.group_hover_color(BUTTON_GROUP, color),
                None => icon,
            });
        }
        if let Some(leading) = self.leading {
            button = button.child(leading);
        }
        if let Some(name) = self.icon {
            button = button.child(icon(name, filled));
        }
        if let Some(label) = self.label.filter(|label| !label.is_empty()) {
            button = button.child(div().min_w_0().truncate().child(label));
        }
        if let Some(text) = self.secondary_label.filter(|text| !text.is_empty()) {
            button = button.child(div().flex_none().font_weight(gpui::FontWeight::NORMAL).text_color(muted).child(text));
        }
        if let Some(name) = self.trailing_icon {
            if self.align_between {
                button = button.child(div().flex_1());
            }
            button = button.child(icon(name, false));
        }

        if let (Some(handler), false) = (self.on_click, self.disabled) {
            button = button.on_click(move |event, window, cx| handler(event, window, cx));
        }

        if let Some(tooltip) = self.tooltip {
            let shortcut = self.shortcut;
            let side = self.tooltip_side;
            button = button.relative().anchored_tooltip(move || Tooltip::new(tooltip.clone()).shortcut(shortcut.clone()).side(side));
        }

        button
    }
}
