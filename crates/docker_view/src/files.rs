//! A running container's files (`useDockerContainerFiles`): a folder listed with `docker cp -`,
//! folders opened in place, and files or folders copied to and from the host.

#[cfg(target_family = "wasm")]
use crate::athas_docker;
use athas_docker::DockerContainerFileEntry;
use ui::scale::px;
use gpui::{AnyElement, ClickEvent, Context, ElementId, IntoElement, SharedString, Window, div, prelude::*,};
use theme::ThemeColors;
use ui::{Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, WithScrollbar, metrics, typography};

use crate::{Detail, DockerView, model, runtime};

pub(crate) struct Files {
    pub container: String,
    pub name: String,
    pub path: String,
    /// `None` while the folder loads.
    pub entries: Option<Result<Vec<DockerContainerFileEntry>, String>>,
    epoch: usize,
}

impl DockerView {
    pub(crate) fn open_files(&mut self, container: String, name: String, cx: &mut Context<Self>) {
        self.detail = Some(Detail::Files(Files { container, name, path: "/".to_string(), entries: None, epoch: 0 }));
        self.reload_files(cx);
    }

    pub(crate) fn show_folder(&mut self, path: String, cx: &mut Context<Self>) {
        if let Some(Detail::Files(files)) = &mut self.detail {
            files.path = path;
            self.reload_files(cx);
        }
    }

    pub(crate) fn reload_files(&mut self, cx: &mut Context<Self>) {
        let docker = self.docker();
        let Some(Detail::Files(files)) = &mut self.detail else { return };
        files.epoch += 1;
        files.entries = None;
        let (epoch, container, path) = (files.epoch, files.container.clone(), files.path.clone());
        // The epoch starts over for each container's browser: the container is checked too, so
        // a late listing of the previous one is not shown under this one.
        let for_container = container.clone();
        let task = runtime::spawn(async move { docker.list_container_files(container, Some(path)).await });
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if let Some(Detail::Files(files)) = &mut this.detail
                    && files.epoch == epoch
                    && files.container == for_container
                {
                    files.entries = Some(result.map(|mut entries| {
                        entries.sort_by(|a, b| b.is_directory.cmp(&a.is_directory).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
                        entries
                    }));
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn render_files(&self, colors: &ThemeColors, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let Some(Detail::Files(files)) = &self.detail else { return div().into_any_element() };
        let (container, name, path) = (files.container.clone(), files.name.clone(), files.path.clone());
        let at_root = path == "/";
        let busy = self.busy.contains(&format!("copy:{container}"));
        let parent = model::parent_container_path(&path);
        let (from_container, from_name, from_path) = (container.clone(), name.clone(), path.clone());
        let (to_container, to_name, to_path) = (container.clone(), name.clone(), path.clone());
        let bar = self
            .render_detail_bar(format!("{name}:{path}").into(), "Files", colors, cx)
            .child(
                Button::icon("docker-files-up", IconName::ArrowUp)
                    .size(ButtonSize::Small)
                    .tooltip("Parent folder")
                    .disabled(at_root)
                    .on_click(cx.listener(move |this, _, _, cx| this.show_folder(parent.clone(), cx))),
            )
            .child(
                Button::new("docker-files-copy-from", "Copy to Host")
                    .leading_icon(IconName::Download)
                    .size(ButtonSize::Small)
                    .variant(ButtonVariant::Ghost)
                    .tooltip("Copy this folder to the host")
                    .disabled(busy)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.open_copy_from_form(from_container.clone(), from_name.clone(), Some(from_path.clone()), window, cx)
                    })),
            )
            .child(
                Button::new("docker-files-copy-to", "Copy Here")
                    .leading_icon(IconName::Upload)
                    .size(ButtonSize::Small)
                    .variant(ButtonVariant::Ghost)
                    .tooltip("Copy a host file or folder into this folder")
                    .disabled(busy)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.open_copy_to_form(to_container.clone(), to_name.clone(), to_path.clone(), true, window, cx)
                    })),
            )
            .child(
                Button::icon("docker-files-refresh", IconName::ArrowClockwise)
                    .size(ButtonSize::Small)
                    .tooltip("Refresh")
                    .on_click(cx.listener(|this, _, _, cx| this.reload_files(cx))),
            );
        let body = match &files.entries {
            None => self.render_empty("Loading files…", "", false),
            Some(Err(error)) => div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .child(EmptyState::new("Couldn't list files").icon(IconName::WarningCircle).message(error.clone()))
                .into_any_element(),
            Some(Ok(entries)) if entries.is_empty() => self.render_empty("Empty folder", "Nothing in this folder.", false),
            Some(Ok(entries)) => {
                let rows = entries.iter().map(|entry| self.render_file_row(entry, &container, &name, colors, cx)).collect::<Vec<_>>();
                div()
                    .id("docker-files")
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .px(px(8.))
                    .py(px(6.))
                    .children(rows)
                    .scrollbar(window, cx)
                    .into_any_element()
            }
        };
        div().flex().flex_col().flex_1().min_h_0().child(bar).child(body).into_any_element()
    }

    fn render_file_row(&self, entry: &DockerContainerFileEntry, container: &str, name: &str, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let detail = model::join_parts([
            Some(if entry.is_directory { "Directory".to_string() } else { model::format_file_size(entry.size) }.as_str()),
            entry.mode.as_deref(),
        ]);
        let (path, directory) = (entry.path.clone(), entry.is_directory);
        let (container, name) = (container.to_string(), name.to_string());
        div()
            .id(ElementId::Name(SharedString::from(format!("docker-file-{}", entry.path))))
            .flex()
            .flex_none()
            .items_center()
            .gap(px(10.))
            .h(px(28.))
            .px(px(10.))
            .rounded(metrics::radius_md())
            .text_size(typography::text_sm())
            .hover(|style| style.bg(colors.accent))
            .child(extensions::entry_icon(&entry.name, directory, false, px(14.), cx).unwrap_or_else(|| {
                Icon::new(if directory { IconName::Folder } else { IconName::File }).size(IconSize::XSmall).color(colors.subtle_foreground).into_any_element()
            }))
            .child(div().flex_1().min_w_0().truncate().text_color(colors.foreground).child(entry.name.clone()))
            .child(div().flex_none().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(detail))
            .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
                if directory {
                    this.show_folder(path.clone(), cx);
                } else {
                    this.open_copy_from_form(container.clone(), name.clone(), Some(path.clone()), window, cx);
                }
            }))
            .into_any_element()
    }
}
