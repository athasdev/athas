//! Project icons (`project-icons/`): the glyph a project shows, and the picker that chooses an
//! image from the project, an emoji or an icon.

use ui::WithScrollbar;
use std::path::PathBuf;

use ui::scale::px;
use gpui::{
    AnyElement, App, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, KeyDownEvent, ObjectFit,
    Pixels, ScrollHandle, SharedString, Subscription, WeakEntity, Window, div, img, prelude::*,
};
use theme::ActiveTheme;
use ui::{Icon, IconName, IconSize, InputAppearance, TextInput, TextInputEvent, typography};
use workspace::{
    ProjectId,
    project_icons::{self, ProjectIconCategory, ProjectIconFile},
};

use crate::{
    Workbench,
    command_surface::{self, CommandRow},
};

/// A project's icon: its own (an emoji, an icon or an image), else a folder, the remote mark for
/// a remote project, or a plus with no project.
pub(crate) fn project_glyph(path: Option<&str>, custom: Option<&str>, size: Pixels, color: gpui::Hsla) -> AnyElement {
    if let Some(custom) = custom {
        return custom_icon(custom, size, color);
    }
    let icon = match path {
        Some(path) if path.starts_with("remote://") => IconName::Remote,
        Some(_) => IconName::Folder,
        None => IconName::Plus,
    };
    Icon::new(icon).size(IconSize::Custom(size)).color(color).into_any_element()
}

/// `ProjectCustomIcon`: an emoji, an Athas icon, or the image at a path.
pub(crate) fn custom_icon(value: &str, size: Pixels, color: gpui::Hsla) -> AnyElement {
    if let Some(symbol) = project_icons::find_symbol(value) {
        if let Some(emoji) = symbol.emoji {
            return div()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(size)
                .text_size(size * 0.9)
                .line_height(size)
                .child(emoji)
                .into_any_element();
        }
        if let Some(icon) = symbol.icon.and_then(IconName::from_name) {
            return Icon::new(icon).size(IconSize::Custom(size)).color(color).into_any_element();
        }
    }
    if project_icons::category(Some(value)) != ProjectIconCategory::Files {
        return Icon::new(IconName::Folder).size(IconSize::Custom(size)).color(color).into_any_element();
    }
    img(PathBuf::from(value))
        .flex_none()
        .size(size)
        .rounded(ui::metrics::radius_md())
        .object_fit(ObjectFit::Contain)
        .with_fallback(move || div().size(size).into_any_element())
        .into_any_element()
}

struct IconOption {
    value: String,
    name: String,
    description: Option<String>,
}

/// Select project icon (`project-icon-picker.tsx`).
pub(crate) struct ProjectIconPicker {
    workbench: WeakEntity<Workbench>,
    project: ProjectId,
    project_path: String,
    current: Option<String>,
    category: ProjectIconCategory,
    icons: Vec<ProjectIconFile>,
    loading: bool,
    error: bool,
    selected: usize,
    input: Entity<TextInput>,
    scroll: ScrollHandle,
    _subscription: Subscription,
}

impl EventEmitter<DismissEvent> for ProjectIconPicker {}

impl Focusable for ProjectIconPicker {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.input.focus_handle(cx)
    }
}

impl ProjectIconPicker {
    pub fn new(
        workbench: WeakEntity<Workbench>,
        project: ProjectId,
        project_path: String,
        current: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let input = cx.new(|cx| TextInput::new(window, cx).placeholder("Search project icons").appearance(InputAppearance::Bare));
        let subscription = cx.subscribe_in(&input, window, |this, _, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Changed(_) => {
                this.selected = 0;
                this.scroll.scroll_to_item(0);
                cx.notify();
            }
            TextInputEvent::Confirmed => {
                if let Some(option) = this.options(cx).into_iter().nth(this.selected) {
                    this.select(Some(option.value), window, cx);
                }
            }
            TextInputEvent::Cancelled => cx.emit(DismissEvent),
            _ => {}
        });
        input.update(cx, |input, cx| input.focus(window, cx));
        let scan_path = project_path.clone();
        let scan = cx.background_spawn(async move { project_icons::scan_icon_files(&scan_path) });
        cx.spawn(async move |this, cx| {
            let result = scan.await;
            this.update(cx, |this, cx| {
                match result {
                    Ok(icons) => this.icons = icons,
                    Err(_) => this.error = true,
                }
                this.loading = false;
                cx.notify();
            })
            .ok();
        })
        .detach();
        Self {
            workbench,
            project,
            project_path,
            category: project_icons::category(current.as_deref()),
            current,
            icons: Vec::new(),
            loading: true,
            error: false,
            selected: 0,
            input,
            scroll: ScrollHandle::new(),
            _subscription: subscription,
        }
    }

    fn options(&self, cx: &App) -> Vec<IconOption> {
        let query = self.input.read(cx).text().to_string();
        match self.category {
            ProjectIconCategory::Files => project_icons::icon_options(&self.icons, &self.project_path, &query)
                .into_iter()
                .map(|(icon, relative)| IconOption { value: icon.path.clone(), name: icon.name.clone(), description: Some(relative) })
                .collect(),
            category => project_icons::search_symbols(category, &query)
                .into_iter()
                .map(|symbol| IconOption { value: symbol.value, name: symbol.name.to_string(), description: None })
                .collect(),
        }
    }

    fn select(&mut self, icon: Option<String>, _: &mut Window, cx: &mut Context<Self>) {
        let project = self.project.clone();
        self.workbench.update(cx, |workbench, cx| workbench.update_state(cx, |state| state.set_project_icon(&project, icon))).ok();
        cx.emit(DismissEvent);
    }

    fn set_category(&mut self, category: ProjectIconCategory, cx: &mut Context<Self>) {
        self.category = category;
        self.selected = 0;
        cx.notify();
    }

    fn on_key_down(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let count = self.options(cx).len();
        if count == 0 {
            return;
        }
        let next = match event.keystroke.key.as_str() {
            "down" => (self.selected + 1) % count,
            "up" => (self.selected + count - 1) % count,
            _ => return,
        };
        cx.stop_propagation();
        self.selected = next;
        self.scroll.scroll_to_item(next);
        cx.notify();
    }
}

impl Render for ProjectIconPicker {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = theme.colors.clone();
        let options = self.options(cx);
        let tabs = [
            (ProjectIconCategory::Files, "Project Files"),
            (ProjectIconCategory::Emojis, "Emojis"),
            (ProjectIconCategory::Icons, "Icons"),
        ];
        let tab_bar = div().flex().flex_none().gap(px(2.)).px(px(8.)).pt(px(8.)).children(tabs.into_iter().enumerate().map(|(index, (category, label))| {
            let active = self.category == category;
            div()
                .id(("icon-tab", index))
                .px(px(12.))
                .h(ui::metrics::chrome_control())
                .flex()
                .items_center()
                .rounded_full()
                .text_size(typography::text_chrome())
                .font_weight(typography::MEDIUM)
                .text_color(if active { colors.foreground } else { colors.subtle_foreground })
                .when(active, |this| this.bg(colors.segment_knob).shadow(theme.shadows.raised_inset.clone()))
                .when(!active, |this| this.hover(|style| style.text_color(colors.foreground)))
                .on_click(cx.listener(move |this, _, _, cx| this.set_category(category, cx)))
                .child(label)
        }));

        let empty: Option<SharedString> = if self.category == ProjectIconCategory::Files && self.loading {
            Some("Scanning for icons…".into())
        } else if self.category == ProjectIconCategory::Files && self.error {
            Some("Could not scan project icons. Close and reopen to retry.".into())
        } else if options.is_empty() {
            Some(if self.category == ProjectIconCategory::Files && self.icons.is_empty() {
                "No icon files found in this project. Looks for icon, logo, and favicon .ico, .png, and .svg files.".into()
            } else {
                "No icons match your search.".into()
            })
        } else {
            None
        };
        let rows: Vec<AnyElement> = if empty.is_some() {
            Vec::new()
        } else {
            options
                .into_iter()
                .enumerate()
                .map(|(index, option)| {
                    let selected = index == self.selected;
                    let current = self.current.as_deref() == Some(option.value.as_str());
                    let color = if selected { colors.primary_foreground } else { colors.subtle_foreground };
                    let value = option.value.clone();
                    let mut row = CommandRow::new(("icon-option", index), option.name)
                        .leading(custom_icon(&option.value, px(20.), color))
                        .selected(selected);
                    if let Some(description) = option.description {
                        row = row.description(description);
                    }
                    if current {
                        row = row.accessory(command_surface::badge("Current", false, selected, cx));
                    }
                    div()
                        .id(("icon-option-row", index))
                        .on_mouse_move(cx.listener(move |this, _, _, cx| {
                            if this.selected != index {
                                this.selected = index;
                                cx.notify();
                            }
                        }))
                        .on_click(cx.listener(move |this, _, window, cx| this.select(Some(value.clone()), window, cx)))
                        .child(row)
                        .into_any_element()
                })
                .collect()
        };

        command_surface::panel("project-icon-picker", window, cx)
            .key_context("ProjectIconPicker")
            .on_key_down(cx.listener(Self::on_key_down))
            .child(
                command_surface::header(cx)
                    .child(Icon::new(IconName::Search).size(IconSize::Medium).color(colors.subtle_foreground))
                    .child(div().flex_1().min_w_0().h(px(32.)).flex().items_center().child(self.input.clone()))
                    .child(command_surface::close_button("icon-picker-close", cx, cx.listener(|_, _, _, cx| cx.emit(DismissEvent)))),
            )
            .child(tab_bar)
            .child(
                command_surface::list("icon-options")
                    .children(empty.map(|message| command_surface::empty(message, cx)))
                    .children(rows)
                    .scrollbar_with(&self.scroll),
            )
            .when(self.current.is_some(), |this| {
                this.child(command_surface::footer(cx).child(
                    ui::Button::new("remove-project-icon", "Remove custom icon")
                        .leading_icon(IconName::Trash)
                        .on_click(cx.listener(|this, _, window, cx| this.select(None, window, cx))),
                ))
            })
    }
}
