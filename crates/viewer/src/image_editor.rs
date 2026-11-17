//! The image viewer's editing chrome (`image-editor-toolbar.tsx`, `image-context-menu.tsx`,
//! `image-resize-dialog.tsx`, `image-format-dialog.tsx`).

use gpui::{Anchor, App, ClipboardItem, Context, Entity, MouseButton, MouseDownEvent, Point, Pixels, SharedString, Subscription, Window, div, point, prelude::*, px};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, Dialog, DialogSize, Field, IconName, MenuEntry, MenuItem, OpenMenu, TextInput, TextInputEvent, Switch, metrics, typography};

use crate::{
    Content, FileViewer, binary,
    image_edit::{EditedImage, History, ImageFormat, Operation, QUALITY_PRESETS, RECOMMENDED_QUALITY, keep_aspect},
};

pub(crate) enum ImageDialog {
    Resize { width: Entity<TextInput>, height: Entity<TextInput>, keep_aspect: bool, original: (u32, u32), _subscriptions: Vec<Subscription> },
    Convert { format: ImageFormat, quality: f32, estimate: Option<Result<u64, SharedString>> },
}

#[derive(Default)]
pub(crate) struct ImageEdits {
    pub history: Option<History>,
    pub processing: bool,
    pub error: Option<SharedString>,
    pub dialog: Option<ImageDialog>,
}

impl ImageEdits {
    pub fn current(&self) -> Option<&EditedImage> {
        self.history.as_ref().filter(|history| history.can_undo() || history.has_changes()).and_then(History::current)
    }
}

fn parse_size(input: &Entity<TextInput>, cx: &App) -> Option<u32> {
    input.read(cx).text().trim().parse().ok().filter(|value| *value > 0)
}

impl FileViewer {
    fn edits(&mut self) -> Option<&mut ImageEdits> {
        match &mut self.content {
            Content::Image(state) => Some(&mut state.edits),
            _ => None,
        }
    }

    pub(crate) fn can_edit_image(&self) -> bool {
        crate::extension(&self.path) != "svg"
    }

    /// Runs `operation` on the image as it stands, off the UI thread, as a new history entry.
    pub(crate) fn edit_image(&mut self, operation: Operation, cx: &mut Context<Self>) {
        let path = self.path.clone();
        let Some(edits) = self.edits() else { return };
        if edits.processing {
            return;
        }
        let current = edits.history.as_ref().and_then(History::current).cloned();
        edits.processing = true;
        edits.error = None;
        let task = cx.background_spawn(async move {
            let base = match current {
                Some(current) => current,
                None => EditedImage::read(std::fs::read(&path)?)?,
            };
            let edited = base.apply(operation)?;
            anyhow::Ok((base, edited))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                let Some(edits) = this.edits() else { return };
                edits.processing = false;
                match result {
                    Ok((base, edited)) => {
                        edits.history.get_or_insert_with(|| History::new(base)).push(edited);
                    }
                    Err(error) => edits.error = Some(format!("{error:#}").into()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
        cx.notify();
    }

    fn step_history(&mut self, redo: bool, cx: &mut Context<Self>) {
        if let Some(history) = self.edits().filter(|edits| !edits.processing).and_then(|edits| edits.history.as_mut()) {
            if redo { history.redo() } else { history.undo() }
            cx.notify();
        }
    }

    /// Save: asks where, then writes the image in the format the chosen extension names.
    pub(crate) fn save_image(&mut self, cx: &mut Context<Self>) {
        let Some(current) = self.edits().and_then(|edits| edits.history.as_ref()).and_then(History::current).cloned() else { return };
        let stem = self.path.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_else(|| "image".into());
        let suggested = format!("{stem}.{}", current.format.extension());
        let directory = self.path.parent().map(|dir| dir.to_path_buf()).unwrap_or_default();
        let chosen = cx.prompt_for_new_path(&directory, Some(&suggested));
        cx.spawn(async move |this, cx| {
            let Ok(Ok(Some(path))) = chosen.await else { return };
            let result = cx.background_spawn(async move { current.bytes_for(&path).and_then(|bytes| Ok(std::fs::write(&path, bytes)?)) }).await;
            this.update(cx, |this, cx| {
                let Some(edits) = this.edits() else { return };
                match result {
                    Ok(()) => {
                        if let Some(history) = edits.history.as_mut() {
                            history.mark_saved();
                        }
                    }
                    Err(error) => edits.error = Some(format!("{error:#}").into()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn open_resize(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let size = match &self.content {
            Content::Image(state) => state.edits.history.as_ref().and_then(History::current).map(|image| image.size).or(state.size),
            _ => None,
        };
        let Some(original) = size else { return };
        let field = |value: u32, window: &mut Window, cx: &mut Context<Self>| {
            cx.new(|cx| {
                let mut input = TextInput::new(window, cx);
                input.set_text(value.to_string(), cx);
                input
            })
        };
        let width = field(original.0, window, cx);
        let height = field(original.1, window, cx);
        let follow = |source: &Entity<TextInput>, is_width: bool, window: &mut Window, cx: &mut Context<Self>| {
            cx.subscribe_in(source, window, move |this, _, event: &TextInputEvent, window, cx| match event {
                TextInputEvent::Changed(_) => this.resize_follow(is_width, window, cx),
                TextInputEvent::Confirmed => this.confirm_resize(cx),
                TextInputEvent::Cancelled => this.close_dialog(cx),
                _ => {}
            })
        };
        let subscriptions = vec![follow(&width, true, window, cx), follow(&height, false, window, cx)];
        width.update(cx, |input, cx| {
            input.select_all_text(cx);
            input.focus(window, cx);
        });
        if let Some(edits) = self.edits() {
            edits.dialog = Some(ImageDialog::Resize { width, height, keep_aspect: true, original, _subscriptions: subscriptions });
        }
        cx.notify();
    }

    /// With the aspect ratio kept, typing one side sets the other.
    fn resize_follow(&mut self, from_width: bool, _: &mut Window, cx: &mut Context<Self>) {
        let Some(ImageDialog::Resize { width, height, keep_aspect: true, original, .. }) = self.edits().and_then(|edits| edits.dialog.as_ref()) else { return };
        let (width, height, original) = (width.clone(), height.clone(), *original);
        let (source, target) = if from_width { (&width, &height) } else { (&height, &width) };
        let Some(value) = parse_size(source, cx) else { return };
        let (new_width, new_height) = if from_width { keep_aspect(original, Some(value), None) } else { keep_aspect(original, None, Some(value)) };
        let other = if from_width { new_height } else { new_width };
        if parse_size(target, cx) != Some(other) {
            target.update(cx, |input, cx| input.set_text(other.to_string(), cx));
        }
    }

    fn confirm_resize(&mut self, cx: &mut Context<Self>) {
        let Some(ImageDialog::Resize { width, height, .. }) = self.edits().and_then(|edits| edits.dialog.as_ref()) else { return };
        let (Some(width), Some(height)) = (parse_size(width, cx), parse_size(height, cx)) else { return };
        self.close_dialog(cx);
        self.edit_image(Operation::Resize { width, height }, cx);
    }

    fn close_dialog(&mut self, cx: &mut Context<Self>) {
        if let Some(edits) = self.edits() {
            edits.dialog = None;
        }
        cx.notify();
    }

    fn open_convert(&mut self, format: ImageFormat, cx: &mut Context<Self>) {
        if let Some(edits) = self.edits() {
            edits.dialog = Some(ImageDialog::Convert { format, quality: RECOMMENDED_QUALITY, estimate: None });
        }
        self.estimate_conversion(cx);
    }

    /// The size the conversion would come to, encoded off the UI thread.
    fn estimate_conversion(&mut self, cx: &mut Context<Self>) {
        let path = self.path.clone();
        let Some(edits) = self.edits() else { return };
        let Some(ImageDialog::Convert { format, quality, estimate }) = edits.dialog.as_mut() else { return };
        *estimate = None;
        let (format, quality) = (*format, format.supports_quality().then_some(*quality));
        let current = edits.history.as_ref().and_then(History::current).cloned();
        let task = cx.background_spawn(async move {
            let base = match current {
                Some(current) => current,
                None => EditedImage::read(std::fs::read(&path)?)?,
            };
            Ok::<u64, anyhow::Error>(base.apply(Operation::Convert { format, quality })?.bytes.len() as u64)
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if let Some(ImageDialog::Convert { format: shown, quality: shown_quality, estimate }) = this.edits().and_then(|edits| edits.dialog.as_mut())
                    && *shown == format
                    && (!format.supports_quality() || Some(*shown_quality) == quality)
                {
                    *estimate = Some(result.map_err(|error| SharedString::from(format!("{error:#}"))));
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
        cx.notify();
    }

    fn menu_entries(&self, context: bool, cx: &mut Context<Self>) -> Vec<MenuEntry> {
        let weak = cx.weak_entity();
        let item = |label: &str, icon: IconName, run: fn(&mut FileViewer, &mut Window, &mut Context<FileViewer>)| {
            let weak = weak.clone();
            MenuEntry::from(MenuItem::new(label.to_string()).icon(icon).on_select(move |window, cx| {
                weak.update(cx, |this, cx| run(this, window, cx)).ok();
            }))
        };
        let (can_undo, can_redo, changed, processing) = match &self.content {
            Content::Image(state) => {
                let history = state.edits.history.as_ref();
                (
                    history.is_some_and(History::can_undo),
                    history.is_some_and(History::can_redo),
                    history.is_some_and(History::has_changes),
                    state.edits.processing,
                )
            }
            _ => (false, false, false, false),
        };
        let edit_ops = [
            item("Rotate 90° CW", IconName::ArrowClockwise, |this, _, cx| this.edit_image(Operation::Rotate(90), cx)),
            item("Rotate 90° CCW", IconName::ArrowCounterClockwise, |this, _, cx| this.edit_image(Operation::Rotate(270), cx)),
            item("Rotate 180°", IconName::ArrowClockwise, |this, _, cx| this.edit_image(Operation::Rotate(180), cx)),
        ];
        let flips = [
            item("Flip Horizontal", IconName::FlipHorizontal, |this, _, cx| this.edit_image(Operation::FlipHorizontal, cx)),
            item("Flip Vertical", IconName::FlipVertical, |this, _, cx| this.edit_image(Operation::FlipVertical, cx)),
        ];
        let resize = item("Resize...", IconName::Image, |this, window, cx| this.open_resize(window, cx));
        let converts = self.convert_entries(true, cx);
        let mut entries = Vec::new();
        if !context {
            entries.push(resize);
            entries.push(MenuEntry::Separator);
            entries.extend(edit_ops);
            entries.push(MenuEntry::Separator);
            entries.extend(flips);
            return entries.into_iter().map(|entry| disable(entry, processing)).collect();
        }
        entries.extend(edit_ops);
        entries.extend(flips);
        entries.push(resize);
        entries.push(MenuEntry::Separator);
        entries.extend(converts);
        entries.push(MenuEntry::Separator);
        let undo = item("Undo", IconName::ArrowCounterClockwise, |this, _, cx| this.step_history(false, cx));
        let redo = item("Redo", IconName::ArrowClockwise, |this, _, cx| this.step_history(true, cx));
        entries.push(disable(undo, !can_undo));
        entries.push(disable(redo, !can_redo));
        if changed {
            entries.push(item("Save", IconName::Save, |this, _, cx| this.save_image(cx)));
        }
        entries.push(MenuEntry::Separator);
        entries.push(item("Show in Finder", IconName::FolderOpen, |this, _, cx| cx.reveal_path(&this.path)));
        entries.push(item("Copy Path", IconName::Copy, |this, _, cx| {
            cx.write_to_clipboard(ClipboardItem::new_string(this.path.to_string_lossy().into_owned()))
        }));
        entries
    }

    /// Convert to PNG / JPEG / WebP / AVIF, each opening the Convert dialog.
    fn convert_entries(&self, context: bool, cx: &mut Context<Self>) -> Vec<MenuEntry> {
        let weak = cx.weak_entity();
        ImageFormat::ALL
            .iter()
            .map(|format| {
                let (weak, format) = (weak.clone(), *format);
                let label = if context { format!("Convert to {}...", format.label()) } else { format.label().to_string() };
                MenuEntry::from(MenuItem::new(label).icon(IconName::Image).on_select(move |_, cx| {
                    weak.update(cx, |this, cx| this.open_convert(format, cx)).ok();
                }))
            })
            .collect()
    }

    fn open_menu(&mut self, key: &'static str, context: bool, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let entries = self.menu_entries(context, cx);
        self.menu = Some(OpenMenu::new(key, entries, position, Anchor::TopLeft, window, cx, |this: &mut Self, _| this.menu = None));
        cx.notify();
    }

    pub(crate) fn image_context_menu(&mut self, event: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.can_edit_image() {
            self.open_menu("image-context", true, event.position, window, cx);
        }
    }

    /// Edit ▾, Convert ▾, undo, redo and Save, for the toolbar.
    pub(crate) fn edit_controls(&self, cx: &mut Context<Self>) -> Vec<gpui::AnyElement> {
        let Content::Image(state) = &self.content else { return Vec::new() };
        if !self.can_edit_image() {
            return Vec::new();
        }
        let history = state.edits.history.as_ref();
        let processing = state.edits.processing;
        let dropdown = |id: &'static str, label: &'static str, tooltip: &'static str, cx: &mut Context<Self>| {
            Button::new(id, label)
                .size(ButtonSize::Small)
                .variant(ButtonVariant::Ghost)
                .trailing_icon(IconName::ChevronDown)
                .tooltip(tooltip)
                .disabled(processing)
                .on_click(cx.listener(move |this, event: &gpui::ClickEvent, window, cx| {
                    let position = event.position();
                    let position = point(position.x, position.y + px(10.));
                    if id == "image-edit-menu" {
                        this.open_menu("image-edit", false, position, window, cx);
                    } else {
                        let entries = this.convert_entries(false, cx);
                        this.menu = Some(OpenMenu::new("image-convert", entries, position, Anchor::TopLeft, window, cx, |this: &mut Self, _| this.menu = None));
                        cx.notify();
                    }
                }))
        };
        vec![
            dropdown("image-edit-menu", "Edit", "Edit operations", cx).into_any_element(),
            dropdown("image-convert-menu", "Convert", "Convert format", cx).into_any_element(),
            Button::icon("image-undo", IconName::ArrowCounterClockwise)
                .size(ButtonSize::Small)
                .tooltip("Undo last operation")
                .disabled(processing || !history.is_some_and(History::can_undo))
                .on_click(cx.listener(|this, _, _, cx| this.step_history(false, cx)))
                .into_any_element(),
            Button::icon("image-redo", IconName::ArrowClockwise)
                .size(ButtonSize::Small)
                .tooltip("Redo last operation")
                .disabled(processing || !history.is_some_and(History::can_redo))
                .on_click(cx.listener(|this, _, _, cx| this.step_history(true, cx)))
                .into_any_element(),
            Button::icon("image-save", IconName::Save)
                .size(ButtonSize::Small)
                .tooltip("Save image")
                .disabled(processing || !history.is_some_and(History::has_changes))
                .on_click(cx.listener(|this, _, _, cx| this.save_image(cx)))
                .into_any_element(),
        ]
    }

    /// The open dialog over the stage, and the edit error under the toolbar.
    pub(crate) fn render_image_overlays(&self, cx: &mut Context<Self>) -> Vec<gpui::AnyElement> {
        let Content::Image(state) = &self.content else { return Vec::new() };
        let colors = cx.theme().colors.clone();
        let mut overlays = Vec::new();
        if let Some(error) = &state.edits.error {
            overlays.push(
                div()
                    .absolute()
                    .top(px(8.))
                    .left(px(8.))
                    .right(px(8.))
                    .px(px(12.))
                    .py(px(8.))
                    .rounded(metrics::RADIUS_LG)
                    .bg(colors.destructive_soft)
                    .text_size(typography::TEXT_SM)
                    .text_color(colors.destructive)
                    .child(error.clone())
                    .into_any_element(),
            );
        }
        let Some(dialog) = &state.edits.dialog else { return overlays };
        let close = cx.listener(|this, _, _, cx| this.close_dialog(cx));
        let entity = cx.entity().downgrade();
        let dialog = match dialog {
            ImageDialog::Resize { width, height, keep_aspect, original, .. } => {
                let valid = parse_size(width, cx).is_some() && parse_size(height, cx).is_some();
                let keep = *keep_aspect;
                Dialog::new("image-resize", "Resize Image")
                    .icon(IconName::Image)
                    .size(DialogSize::Sm)
                    .on_close(move |_, cx| {
                        entity.update(cx, |this, cx| this.close_dialog(cx)).ok();
                    })
                    .footer([
                        Button::new("image-resize-cancel", "Cancel").variant(ButtonVariant::Ghost).on_click(close).into_any_element(),
                        Button::new("image-resize-apply", "Resize")
                            .variant(ButtonVariant::Accent)
                            .disabled(!valid)
                            .on_click(cx.listener(|this, _, _, cx| this.confirm_resize(cx)))
                            .into_any_element(),
                    ])
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(12.))
                            .child(div().text_size(typography::TEXT_SM).text_color(colors.muted_foreground).child(format!("Current size: {} × {}", original.0, original.1)))
                            .child(
                                div()
                                    .flex()
                                    .gap(px(12.))
                                    .child(div().flex_1().child(Field::new().label("Width").control(width.clone())))
                                    .child(div().flex_1().child(Field::new().label("Height").control(height.clone()))),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .text_size(typography::TEXT_SM)
                                    .child("Maintain aspect ratio")
                                    .child(Switch::new("image-resize-aspect", keep).on_change({
                                        let weak = cx.weak_entity();
                                        move |checked, _, cx| {
                                            weak.update(cx, |this, cx| {
                                                if let Some(ImageDialog::Resize { keep_aspect, .. }) = this.edits().and_then(|edits| edits.dialog.as_mut()) {
                                                    *keep_aspect = checked;
                                                }
                                                cx.notify();
                                            })
                                            .ok();
                                        }
                                    })),
                            ),
                    )
            }
            ImageDialog::Convert { format, quality, estimate } => {
                let format = *format;
                let current_size = state.edits.history.as_ref().and_then(History::current).map_or(state.bytes, |image| image.bytes.len() as u64);
                let estimate_text = match estimate {
                    None => "Estimating size…".to_string(),
                    Some(Err(error)) => error.to_string(),
                    Some(Ok(size)) => {
                        let change = (*size as f64 - current_size as f64) / current_size.max(1) as f64 * 100.;
                        format!("{} → {} ({}{:.0}%)", binary::format_size(current_size), binary::format_size(*size), if change > 0. { "+" } else { "" }, change)
                    }
                };
                let presets = format.supports_quality().then(|| {
                    div().flex().flex_col().gap(px(4.)).child(div().font_weight(typography::SEMIBOLD).text_size(typography::TEXT_SM).child("Quality Setting")).children(
                        QUALITY_PRESETS.iter().enumerate().map(|(index, (label, value))| {
                            let value = *value;
                            let active = (*quality - value).abs() < f32::EPSILON;
                            div()
                                .id(("image-quality", index))
                                .flex()
                                .items_center()
                                .justify_between()
                                .px(px(10.))
                                .py(px(6.))
                                .rounded(metrics::RADIUS_MD)
                                .text_size(typography::TEXT_SM)
                                .when(active, |this| this.bg(colors.selected))
                                .hover(|style| style.bg(colors.accent))
                                .child(
                                    div().flex().gap(px(6.)).child(label.to_string()).when((value - RECOMMENDED_QUALITY).abs() < f32::EPSILON, |this| {
                                        this.child(div().text_color(colors.subtle_foreground).child("Recommended"))
                                    }),
                                )
                                .child(div().text_color(colors.muted_foreground).child(format!("{}%", (value * 100.).round())))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    if let Some(ImageDialog::Convert { quality, .. }) = this.edits().and_then(|edits| edits.dialog.as_mut()) {
                                        *quality = value;
                                    }
                                    this.estimate_conversion(cx);
                                }))
                        }),
                    )
                });
                let ready = matches!(estimate, Some(Ok(_)));
                let quality = format.supports_quality().then_some(*quality);
                Dialog::new("image-convert", format!("Convert to {}", format.label()))
                    .icon(IconName::Image)
                    .size(DialogSize::Sm)
                    .on_close(move |_, cx| {
                        entity.update(cx, |this, cx| this.close_dialog(cx)).ok();
                    })
                    .footer([
                        Button::new("image-convert-cancel", "Cancel").variant(ButtonVariant::Ghost).on_click(close).into_any_element(),
                        Button::new("image-convert-apply", "Convert")
                            .variant(ButtonVariant::Accent)
                            .disabled(!ready)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.close_dialog(cx);
                                this.edit_image(Operation::Convert { format, quality }, cx);
                            }))
                            .into_any_element(),
                    ])
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(12.))
                            .child(div().text_size(typography::TEXT_SM).child(format.description()))
                            .children(presets)
                            .child(div().text_size(typography::TEXT_SM).text_color(colors.muted_foreground).child(estimate_text)),
                    )
            }
        };
        overlays.push(
            div()
                .absolute()
                .inset_0()
                .flex()
                .items_center()
                .justify_center()
                .p(px(16.))
                .bg(gpui::black().opacity(0.3))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .child(dialog)
                .into_any_element(),
        );
        overlays
    }
}

fn disable(entry: MenuEntry, disabled: bool) -> MenuEntry {
    match entry {
        MenuEntry::Item(item) => MenuEntry::Item(item.disabled(disabled)),
        other => other,
    }
}
