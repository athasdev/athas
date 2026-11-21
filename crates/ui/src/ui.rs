//! The workbench's shared controls, drawn the way `src/ui` draws them in the web workbench.

mod assets;
pub mod avatar;
mod badge;
mod breadcrumb;
mod button;
mod card;
mod checkbox;
mod controls;
mod dialog;
mod disclosure;
mod dropdown;
mod empty_state;
mod field;
mod icon;
mod item;
mod kbd;
mod list;
mod loading;
mod menu;
mod message;
mod native_menu;
pub mod metrics;
pub mod occlusion;
pub mod orb;
mod number_input;
mod pane;
mod popover;
mod progress;
mod questionnaire;
mod resource_drag;
mod scroll_area;
mod select;
mod step_slider;
mod surfaces;
mod switch;
mod tab;
pub mod text_area;
pub mod text_input;
mod tooltip;
pub mod typography;

pub use assets::{Assets, load_fonts};
pub use avatar::{Avatar, Person};
pub use badge::{Badge, Marker, MarkerVariant, StatusDot, Tone};
pub use breadcrumb::{Breadcrumb, PathBreadcrumb};
pub use button::{Button, ButtonSize, ButtonTone, ButtonVariant, Plane};
pub use card::{Alert, AlertVariant, Card, CardHeader, CardLayout, CardPlane, CardVariant, card_content, card_footer};
pub use checkbox::{Checkbox, CheckboxSize};
pub use controls::{
    ButtonGroup, ButtonGroupSeparator, ButtonGroupVariant, ChoiceCard, ChoiceCardSize, ChoiceCards, Menubar, Tabs, TabsTrigger, TabsVariant, Toggle, ToggleSize,
    ToggleTone, ToggleVariant,
};
pub use disclosure::{Accordion, AccordionItem, AccordionTrigger, Collapsible};
pub use dialog::{AlertAction, AlertDialog, ConfirmOptions, DIALOG_RADIUS, Dialog, DialogLayout, DialogSize, PromptDialog, focus_ring};
pub use dropdown::{DropdownAlign, DropdownMenu};
pub use empty_state::EmptyState;
pub use field::{Field, FieldOrientation, FieldSeparator, InputGroup, InputGroupVariant, Label, Separator, input_group_text};
pub use icon::{Icon, IconName, IconSize};
pub use item::{GroupedSection, GroupedSectionVariant, Item, ItemMedia, ItemSize, ItemVariant, item_group};
pub use kbd::{Kbd, shortcut_text};
pub use list::{SectionHeader, SectionLabel, SidebarListItem, SidebarListItemTone, section_switcher, sidebar_row};
pub use loading::{Shimmer, Skeleton, Spinner, ThinkingOrb, ThinkingOrbState, shimmer_band};
pub use menu::{CloseSubmenu, Menu, MenuEntry, MenuItem, MenuItemTone, MenuQuerySource, MenuSize, OVERLAY_MAX_HEIGHT, OVERLAY_MAX_WIDTH, OpenMenu};
pub use message::{Attachment, AttachmentState, Message, ResourceSection, ResourceSummary, message_action};
pub use number_input::{NumberInput, NumberInputEvent};
pub use occlusion::occluder;
pub use pane::{PaneTitle, island, pane_actions, pane_header};
pub use popover::{Popover, PopoverHeader, anchored_overlay};
pub use progress::{Progress, ProgressCircle, ProgressTone, ToggleGroup, ToggleOption};
pub use questionnaire::{Questionnaire, QuestionnaireChoice, QuestionnaireEvent, QuestionnaireQuestion};
pub use resource_drag::{DraggedResource, DraggedResourcePreview, WORKTREE_KIND};
pub use scroll_area::{AlwaysShowScrollbars, ScrollArea, Scrollbar, WithScrollbar, with_scrollbar};
pub use select::{Select, SelectEvent, SelectOption, SelectSearch, SelectVariant, SelectWidth};
pub use step_slider::{StepSlider, StepSliderStep};
pub use surfaces::{
    BrandMark, HoverCard, Table, TableColumn, TableRow, ViewerErrorState, ViewerLayout, ViewerLoadingState, ViewerState, agent_brand_image, checkerboard,
};
pub use switch::Switch;
pub use tab::Tab;
pub use text_area::{TextArea, TextAreaEvent, TextAreaHighlighter, TextAreaVariant};
pub use text_input::{InputAppearance, TextInput, TextInputEvent};
pub use tooltip::{TOOLTIP_DELAY, Tooltip, TooltipAnchor, TooltipExt, TooltipSide, tooltip_origin};

/// Binds the keys the shared controls use.
pub fn init(cx: &mut gpui::App) {
    bind_keys_once(cx, "text_input", text_input::init);
}

/// The functions that bind each crate's keys, kept so every binding can be made again after the
/// keymap reloads (a new keybinding preset clears all bindings).
#[derive(Default)]
struct KeyBinders(Vec<(&'static str, fn(&mut gpui::App))>);

impl gpui::Global for KeyBinders {}

/// Binds a crate's keys the first time it asks, and again whenever the keymap reloads.
pub fn bind_keys_once(cx: &mut gpui::App, owner: &'static str, bind: fn(&mut gpui::App)) {
    let binders = cx.default_global::<KeyBinders>();
    if binders.0.iter().any(|(name, _)| *name == owner) {
        return;
    }
    binders.0.push((owner, bind));
    bind(cx);
}

/// Binds every crate's keys again, after `App::clear_key_bindings`.
pub fn rebind_all(cx: &mut gpui::App) {
    let binders: Vec<fn(&mut gpui::App)> = cx.default_global::<KeyBinders>().0.iter().map(|(_, bind)| *bind).collect();
    for bind in binders {
        bind(cx);
    }
}

pub mod prelude {
    pub use crate::metrics;
    pub use crate::typography::{self, TextStyleExt};
    pub use gpui::prelude::*;
    pub use theme::ActiveTheme;
}
