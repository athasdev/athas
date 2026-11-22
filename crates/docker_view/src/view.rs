//! Drawing the view: the header with its tabs, the resource tables, the log and inspect pages,
//! the form and the notice.

use web_time::{SystemTime, UNIX_EPOCH};

use ui::scale::px;
use gpui::{
    AnyElement, App, ClickEvent, Context, ElementId, HighlightStyle, Hsla, IntoElement, MouseButton, MouseDownEvent, Render,
    ScrollEvent, SharedString, StyledText, Window, div, point, prelude::*, relative, uniform_list,
};
#[cfg(target_family = "wasm")]
use crate::athas_docker;
use athas_docker::DockerNetwork;
use theme::{ActiveTheme, ThemeColors};
use ui::{
    Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, PaneTitle, Scrollbar, WithScrollbar, metrics, pane_actions,
    pane_header, typography,
};

use crate::{
    Detail, DockerView, Status, Tab, Tone,
    model::{self, ContainerState, JsonToken, image_reference, plural, short_id},
};

/// One row of a resource table.
fn row_height() -> gpui::Pixels { px(32.) }
/// One line of a log or of `docker inspect`.
fn line_height() -> gpui::Pixels { px(18.) }
/// The column of row actions at the end of each table row.
fn actions_width() -> gpui::Pixels { px(120.) }

fn now_seconds() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_secs() as i64)
}

fn tone_color(tone: model::Tone, colors: &ThemeColors) -> Hsla {
    match tone {
        model::Tone::Success => colors.success,
        model::Tone::Warning => colors.warning,
        model::Tone::Danger => colors.destructive,
        model::Tone::Accent => colors.info,
        model::Tone::Neutral => colors.subtle_foreground,
    }
}

fn syntax(colors: &ThemeColors, key: &str, fallback: Hsla) -> Hsla {
    colors.syntax.get(key).copied().unwrap_or(fallback)
}

/// Where a menu opened from a click hangs.
fn below(position: gpui::Point<gpui::Pixels>) -> gpui::Point<gpui::Pixels> {
    point(position.x + px(8.), position.y + px(8.))
}

fn status_dot(color: Hsla) -> impl IntoElement {
    div().flex_none().size(px(7.)).rounded_full().bg(color)
}

/// A table cell: a share of the row's width, one truncated line.
fn cell(share: f32) -> gpui::Div {
    div().flex_none().w(relative(share)).min_w_0().pr(px(12.)).truncate()
}

/// A small icon button inside a row; it keeps the click from reaching the row.
fn row_button(
    id: impl Into<ElementId>,
    icon: IconName,
    tooltip: &str,
    disabled: bool,
    cx: &mut Context<DockerView>,
    handler: impl Fn(&mut DockerView, &ClickEvent, &mut Window, &mut Context<DockerView>) + 'static,
) -> AnyElement {
    Button::icon(id, icon)
        .size(ButtonSize::XSmall)
        .tooltip(tooltip.to_string())
        .disabled(disabled)
        .on_click(cx.listener(move |this, event, window, cx| {
            cx.stop_propagation();
            handler(this, event, window, cx);
        }))
        .into_any_element()
}

/// A table row: leading mark, cells, then actions that show on hover beside an always-visible
/// "more" button. Clicking anywhere on the row opens its menu, like the palette's Docker page.
struct TableRow {
    id: SharedString,
    leading: AnyElement,
    cells: Vec<AnyElement>,
    actions: Vec<AnyElement>,
    more: Option<AnyElement>,
    busy: bool,
}

impl TableRow {
    fn render(
        self,
        colors: &ThemeColors,
        cx: &mut Context<DockerView>,
        on_menu: impl Fn(&mut DockerView, gpui::Point<gpui::Pixels>, &mut Window, &mut Context<DockerView>) + Clone + 'static,
    ) -> AnyElement {
        let group = SharedString::from(format!("docker-row-{}", self.id));
        let on_right = on_menu.clone();
        div()
            .id(ElementId::Name(self.id.clone()))
            .group(group.clone())
            .flex()
            .flex_none()
            .items_center()
            .gap(px(10.))
            .h(row_height())
            .px(px(10.))
            .rounded(metrics::radius_md())
            .text_size(typography::text_sm())
            .text_color(colors.muted_foreground)
            .hover(|style| style.bg(colors.accent))
            .when(self.busy, |this| this.opacity(0.55))
            .child(div().flex().flex_none().w(px(16.)).justify_center().child(self.leading))
            .child(div().flex().flex_1().min_w_0().items_center().children(self.cells))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .w(actions_width())
                    .justify_end()
                    .items_center()
                    .gap(px(2.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(2.))
                            .invisible()
                            .group_hover(group, |style| style.visible())
                            .children(self.actions),
                    )
                    .children(self.more),
            )
            .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| on_menu(this, below(event.position()), window, cx)))
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(move |this, event: &MouseDownEvent, window, cx| on_right(this, event.position, window, cx)),
            )
            .into_any_element()
    }
}

/// The column titles above a table, with the same shares as its cells.
fn table_header(columns: &[(&'static str, f32)], colors: &ThemeColors) -> impl IntoElement {
    div()
        .flex()
        .flex_none()
        .items_center()
        .gap(px(10.))
        .h(px(28.))
        .px(px(10.))
        .text_size(typography::text_caption())
        .font_weight(typography::MEDIUM)
        .text_color(colors.subtle_foreground)
        .child(div().flex_none().w(px(16.)))
        .child(div().flex().flex_1().min_w_0().children(columns.iter().map(|(title, share)| cell(*share).child(*title))))
        .child(div().flex_none().w(actions_width()))
}

fn primary(text: impl Into<SharedString>, colors: &ThemeColors) -> gpui::Div {
    div().truncate().font_weight(typography::MEDIUM).text_color(colors.foreground).child(text.into())
}

fn mono(text: impl Into<SharedString>) -> gpui::Div {
    div().truncate().font_family(typography::MONO_FONT).text_size(typography::text_caption()).child(text.into())
}

impl DockerView {
    fn filter_query(&self, cx: &Context<Self>) -> String {
        self.filter_input.read(cx).text().to_string()
    }

    fn render_tabs(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let services = self.compose.as_ref().map_or(0, |project| project.services.len());
        let tabs = [
            ("docker-tab-containers", "Containers", IconName::Cube, self.containers.len(), Tab::Containers),
            ("docker-tab-images", "Images", IconName::Stack, self.images.len(), Tab::Images),
            ("docker-tab-volumes", "Volumes", IconName::HardDrives, self.volumes.len(), Tab::Volumes),
            ("docker-tab-networks", "Networks", IconName::Sitemap, self.networks.len(), Tab::Networks),
            ("docker-tab-compose", "Compose", IconName::Nodes, services, Tab::Compose),
            ("docker-tab-project", "Project", IconName::Package, self.project.as_ref().map_or(0, crate::project::item_count), Tab::Project),
        ];
        let raised_inset = cx.theme().shadows.raised_inset.clone();
        div().flex().flex_none().items_center().gap(px(2.)).children(tabs.into_iter().map(|(id, label, icon, count, tab)| {
            let active = self.tab == tab && self.detail.is_none();
            let fg = if active { colors.foreground } else { colors.subtle_foreground };
            let hover = colors.foreground;
            div()
                .id(id)
                .flex()
                .items_center()
                .gap(px(6.))
                .h(metrics::chrome_control())
                .px(px(8.))
                .rounded_full()
                .text_size(typography::text_sm())
                .font_weight(typography::MEDIUM)
                .text_color(fg)
                .when(active, |this| this.bg(colors.raised).shadow(raised_inset.clone()))
                .hover(move |style| style.text_color(hover))
                .child(Icon::new(icon).size(IconSize::XSmall).color(fg))
                .child(label)
                .when(count > 0, |this| {
                    this.child(
                        div()
                            .text_size(typography::text_caption())
                            .text_color(colors.subtle_foreground)
                            .child(if count > 999 { "999+".to_string() } else { count.to_string() }),
                    )
                })
                .on_click(cx.listener(move |this, _, _, cx| this.show_tab(tab, cx)))
        }))
    }

    fn render_header(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let running =
            self.containers.iter().filter(|container| ContainerState::parse(&container.state) == ContainerState::Running).count();
        let detail = match self.status {
            Status::Ready => format!("{running} running"),
            _ => String::new(),
        };
        let ready = matches!(self.status, Status::Ready);
        let prune_open = self.menu_is_open("prune");
        pane_header(cx)
            .px(px(12.))
            .child(div().flex_none().child(PaneTitle::new("Docker").icon(IconName::Package).detail(detail)))
            .when(ready, |this| this.child(div().ml(px(12.)).child(self.render_tabs(colors, cx))))
            .child(
                pane_actions()
                    .gap(px(4.))
                    .when(ready && self.detail.is_none() && self.tab != Tab::Compose, |this| {
                        this.child(
                            div()
                                .w(px(180.))
                                .h(metrics::chrome_control())
                                .flex()
                                .items_center()
                                .px(px(6.))
                                .rounded(metrics::radius_md())
                                .bg(colors.field)
                                .child(self.filter_input.clone()),
                        )
                    })
                    .when(ready && self.tab == Tab::Images && self.detail.is_none(), |this| {
                        this.child(
                            Button::new("docker-pull", "Pull")
                                .leading_icon(IconName::CloudArrowDown)
                                .size(ButtonSize::Small)
                                .variant(ButtonVariant::Ghost)
                                .tooltip("Search Docker Hub and pull an image")
                                .on_click(cx.listener(|this, _, window, cx| this.open_pull_form(window, cx))),
                        )
                        .child(
                            Button::new("docker-build", "Build")
                                .leading_icon(IconName::Stack)
                                .size(ButtonSize::Small)
                                .variant(ButtonVariant::Ghost)
                                .tooltip("Build an image from a Dockerfile")
                                .on_click(cx.listener(|this, _, window, cx| this.open_build_form(None, window, cx))),
                        )
                        .child(
                            Button::icon("docker-login", IconName::Key)
                                .size(ButtonSize::Small)
                                .tooltip("Log in to a registry")
                                .on_click(cx.listener(|this, _, window, cx| this.open_login_form(window, cx))),
                        )
                    })
                    .when(ready && self.tab == Tab::Containers && self.detail.is_none(), |this| {
                        this.child(
                            Button::new("docker-run", "Run")
                                .leading_icon(IconName::Play)
                                .size(ButtonSize::Small)
                                .variant(ButtonVariant::Ghost)
                                .tooltip("Start a container from an image")
                                .on_click(cx.listener(|this, _, window, cx| this.open_run_form(None, None, window, cx))),
                        )
                    })
                    .when(ready, |this| {
                        this.child(
                            Button::new("docker-prune", "Prune")
                                .leading_icon(IconName::Broom)
                                .size(ButtonSize::Small)
                                .variant(ButtonVariant::Ghost)
                                .active(prune_open)
                                .tooltip("Remove unused resources")
                                .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                                    let entries = this.prune_menu(cx);
                                    this.show_menu("prune", entries, below(event.position()), window, cx);
                                })),
                        )
                    })
                    .child(
                        Button::icon("docker-refresh", IconName::ArrowClockwise)
                            .size(ButtonSize::Small)
                            .tooltip("Refresh")
                            .disabled(self.loading)
                            .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
                    ),
            )
    }

    fn render_unavailable(&self, error: SharedString, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let (title, guidance) = model::unavailable_copy(&error);
        let copied = error.to_string();
        div()
            .flex()
            .flex_col()
            .flex_1()
            .items_center()
            .justify_center()
            .gap(px(12.))
            .child(
                EmptyState::new(title)
                    .icon(IconName::Package)
                    .message(guidance)
                    .action(
                        Button::new("docker-retry", "Retry")
                            .leading_icon(IconName::ArrowClockwise)
                            .size(ButtonSize::Small)
                            .disabled(self.loading)
                            .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
                    )
                    .action(
                        Button::new("docker-copy-error", "Copy Error")
                            .leading_icon(IconName::Copy)
                            .size(ButtonSize::Small)
                            .variant(ButtonVariant::Ghost)
                            .on_click(cx.listener(move |this, _, _, cx| this.copy(copied.clone(), "the error", cx))),
                    ),
            )
            .child(
                div()
                    .max_w(px(520.))
                    .px(px(16.))
                    .text_center()
                    .font_family(typography::MONO_FONT)
                    .text_size(typography::text_caption())
                    .text_color(colors.subtle_foreground)
                    .child(error),
            )
            .into_any_element()
    }

    pub(crate) fn render_empty(&self, title: &str, message: &str, filtered: bool) -> AnyElement {
        let (title, message) = if filtered { ("No matches", "Nothing matches the filter.") } else { (title, message) };
        div()
            .flex()
            .flex_1()
            .items_center()
            .justify_center()
            .pb(px(40.))
            .child(EmptyState::new(title.to_string()).message(message.to_string()))
            .into_any_element()
    }

    fn table(&self, id: &'static str, header: impl IntoElement, rows: Vec<AnyElement>, window: &mut Window, cx: &mut App) -> AnyElement {
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .px(px(8.))
            .child(header)
            .child(div().id(id).flex().flex_col().flex_1().min_h_0().overflow_y_scroll().pb(px(12.)).children(rows).scrollbar(window, cx))
            .into_any_element()
    }

    fn render_containers(&self, colors: &ThemeColors, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let query = self.filter_query(cx);
        let now = now_seconds();
        let containers: Vec<_> = self
            .containers
            .iter()
            .filter(|container| {
                model::matches_query(
                    [container.name.as_str(), &container.image, &container.state, &container.status, &container.ports, &container.id],
                    &query,
                )
            })
            .cloned()
            .collect();
        if containers.is_empty() {
            return self.render_empty("No containers", "Run an image to start one.", !self.containers.is_empty());
        }
        let rows = containers
            .into_iter()
            .map(|container| {
                let state = ContainerState::parse(&container.state);
                let tone = tone_color(model::state_tone(&container.state, container.health.as_deref()), colors);
                let busy = self.busy.contains(&format!("container:{}", container.id));
                let id = container.id.clone();
                let running = state == ContainerState::Running;
                let mut actions = Vec::new();
                let (start_icon, start_tip, start_action) =
                    if running { (IconName::Stop, "Stop", "stop") } else { (IconName::Play, "Start", "start") };
                let start_id = id.clone();
                actions.push(row_button(format!("start-{id}"), start_icon, start_tip, busy, cx, move |this, _, _, cx| {
                    this.container_action(start_id.clone(), start_action, cx)
                }));
                let restart_id = id.clone();
                actions.push(row_button(format!("restart-{id}"), IconName::ArrowsClockwise, "Restart", busy || !state.is_live(), cx, move |this, _, _, cx| {
                    this.container_action(restart_id.clone(), "restart", cx)
                }));
                let (logs_id, logs_name) = (id.clone(), container.name.clone());
                actions.push(row_button(format!("logs-{id}"), IconName::List, "Logs", false, cx, move |this, _, _, cx| {
                    this.open_logs(logs_id.clone(), logs_name.clone(), cx)
                }));
                let remove_id = id.clone();
                actions.push(row_button(format!("remove-{id}"), IconName::Trash, "Remove", busy, cx, move |this, event, window, cx| {
                    this.confirm_remove_container(remove_id.clone(), below(event.position()), window, cx)
                }));
                let more_id = id.clone();
                let more = row_button(format!("more-{id}"), IconName::Dots, "More", false, cx, move |this, event, window, cx| {
                    this.show_container_menu(&more_id, below(event.position()), window, cx)
                });
                let status_label = model::state_label(&container.state, container.health.as_deref());
                let row = TableRow {
                    id: format!("container-{id}").into(),
                    leading: status_dot(tone).into_any_element(),
                    cells: vec![
                        cell(0.24)
                            .child(primary(container.name.clone(), colors))
                            .into_any_element(),
                        cell(0.22).child(container.image.clone()).into_any_element(),
                        cell(0.2)
                            .flex()
                            .gap(px(6.))
                            .child(div().flex_none().text_color(tone).font_weight(typography::MEDIUM).child(status_label))
                            .child(div().min_w_0().truncate().text_color(colors.subtle_foreground).child(container.status.clone()))
                            .into_any_element(),
                        cell(0.2).child(mono(model::format_ports(&container.ports))).into_any_element(),
                        cell(0.14)
                            .text_color(colors.subtle_foreground)
                            .child(model::container_age(&container.created_at, now))
                            .into_any_element(),
                    ],
                    actions,
                    more: Some(more),
                    busy,
                };
                row.render(colors, cx, move |this, position, window, cx| this.show_container_menu(&id, position, window, cx))
            })
            .collect();
        let header = table_header(&[("Name", 0.24), ("Image", 0.22), ("Status", 0.2), ("Ports", 0.2), ("Created", 0.14)], colors);
        self.table("docker-containers", header, rows, window, cx)
    }

    fn show_container_menu(&mut self, id: &str, position: gpui::Point<gpui::Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(container) = self.container(id).cloned() else { return };
        let entries = self.container_menu(&container, cx);
        self.show_menu(&format!("container:{id}"), entries, position, window, cx);
    }

    fn show_image_menu(&mut self, index: usize, position: gpui::Point<gpui::Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let entries = self.image_menu(index, cx);
        self.show_menu(&format!("image:{index}"), entries, position, window, cx);
    }

    fn render_images(&self, colors: &ThemeColors, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let query = self.filter_query(cx);
        let images: Vec<(usize, _)> = self
            .images
            .iter()
            .enumerate()
            .filter(|(_, image)| model::matches_query([image.repository.as_str(), &image.tag, &image.id], &query))
            .map(|(index, image)| (index, image.clone()))
            .collect();
        if images.is_empty() {
            return self.render_empty("No images", "Pull an image to get started.", !self.images.is_empty());
        }
        let rows = images
            .into_iter()
            .map(|(index, image)| {
                let reference = image_reference(&image);
                let busy = self.busy.contains(&format!("image:{}:{}", image.id, image.tag));
                let dangling = image.repository == "<none>";
                let run_ref = reference.clone();
                let tag_ref = reference.clone();
                let actions = vec![
                    row_button(format!("run-{index}"), IconName::Play, "Run…", busy, cx, move |this, _, window, cx| {
                        this.open_run_form(None, Some(run_ref.clone()), window, cx)
                    }),
                    row_button(format!("tag-{index}"), IconName::Tag, "Tag…", busy, cx, move |this, _, window, cx| {
                        this.open_tag_form(tag_ref.clone(), window, cx)
                    }),
                    row_button(format!("rmi-{index}"), IconName::Trash, "Remove", busy, cx, move |this, event, window, cx| {
                        this.confirm_remove_image(index, below(event.position()), window, cx)
                    }),
                ];
                let more = row_button(format!("image-more-{index}"), IconName::Dots, "More", false, cx, move |this, event, window, cx| {
                    this.show_image_menu(index, below(event.position()), window, cx)
                });
                let (repository, tag) = if dangling {
                    ("<none>".to_string(), image.tag.clone())
                } else {
                    (image.repository.clone(), image.tag.clone())
                };
                TableRow {
                    id: format!("image-{index}").into(),
                    leading: Icon::new(IconName::Stack).size(IconSize::XSmall).color(colors.subtle_foreground).into_any_element(),
                    cells: vec![
                        cell(0.36)
                            .flex()
                            .child(primary(repository, colors).when(dangling, |this| this.text_color(colors.subtle_foreground)))
                            .child(div().flex_none().text_color(colors.subtle_foreground).child(format!(":{tag}")))
                            .into_any_element(),
                        cell(0.2).text_color(colors.subtle_foreground).child(mono(short_id(&image.id).to_string())).into_any_element(),
                        cell(0.2).child(image.size.clone()).into_any_element(),
                        cell(0.24).text_color(colors.subtle_foreground).child(image.created_since.clone()).into_any_element(),
                    ],
                    actions,
                    more: Some(more),
                    busy,
                }
                .render(colors, cx, move |this, position, window, cx| this.show_image_menu(index, position, window, cx))
            })
            .collect();
        let header = table_header(&[("Repository", 0.36), ("Image ID", 0.2), ("Size", 0.2), ("Created", 0.24)], colors);
        self.table("docker-images", header, rows, window, cx)
    }

    fn render_volumes(&self, colors: &ThemeColors, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let query = self.filter_query(cx);
        let volumes: Vec<_> = self
            .volumes
            .iter()
            .filter(|volume| model::matches_query([volume.name.as_str(), &volume.driver, &volume.mountpoint], &query))
            .cloned()
            .collect();
        if volumes.is_empty() {
            return self.render_empty("No volumes", "Volumes that containers create show up here.", !self.volumes.is_empty());
        }
        let rows = volumes
            .into_iter()
            .map(|volume| {
                let name = volume.name.clone();
                let busy = self.busy.contains(&format!("volume:{name}"));
                let inspect_name = name.clone();
                let remove_name = name.clone();
                let menu_name = name.clone();
                let actions = vec![
                    row_button(format!("volume-inspect-{name}"), IconName::Info, "Inspect", false, cx, move |this, _, _, cx| {
                        this.open_inspect("volume", inspect_name.clone(), inspect_name.clone(), cx)
                    }),
                    row_button(format!("volume-remove-{name}"), IconName::Trash, "Remove", busy, cx, move |this, event, window, cx| {
                        this.confirm_remove_volume(remove_name.clone(), below(event.position()), window, cx)
                    }),
                ];
                TableRow {
                    id: format!("volume-{name}").into(),
                    leading: Icon::new(IconName::HardDrives).size(IconSize::XSmall).color(colors.subtle_foreground).into_any_element(),
                    cells: vec![
                        cell(0.4).child(primary(volume.name.clone(), colors)).into_any_element(),
                        cell(0.12).child(volume.driver.clone()).into_any_element(),
                        cell(0.1).text_color(colors.subtle_foreground).child(volume.scope.clone()).into_any_element(),
                        cell(0.38).text_color(colors.subtle_foreground).child(mono(volume.mountpoint.clone())).into_any_element(),
                    ],
                    actions,
                    more: None,
                    busy,
                }
                .render(colors, cx, move |this, position, window, cx| {
                    let entries = this.volume_menu(menu_name.clone(), cx);
                    this.show_menu(&format!("volume:{menu_name}"), entries, position, window, cx);
                })
            })
            .collect();
        let header = table_header(&[("Name", 0.4), ("Driver", 0.12), ("Scope", 0.1), ("Mountpoint", 0.38)], colors);
        self.table("docker-volumes", header, rows, window, cx)
    }

    fn volume_menu(&self, name: String, cx: &Context<Self>) -> Vec<ui::MenuEntry> {
        let (inspect, copy) = (name.clone(), name.clone());
        vec![
            self.item("Inspect", cx, move |this, _, cx| this.open_inspect("volume", inspect.clone(), inspect.clone(), cx)).icon(IconName::Info).into(),
            self.item("Copy Volume Name", cx, move |this, _, cx| this.copy(copy.clone(), "the volume name", cx)).icon(IconName::Copy).into(),
            ui::MenuEntry::Separator,
            self.item("Remove…", cx, move |this, window, cx| {
                let position = window.mouse_position();
                this.confirm_remove_volume(name.clone(), position, window, cx)
            })
            .icon(IconName::Trash)
            .destructive()
            .into(),
        ]
    }

    fn render_networks(&self, colors: &ThemeColors, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let query = self.filter_query(cx);
        let networks: Vec<_> = self
            .networks
            .iter()
            .filter(|network| model::matches_query([network.name.as_str(), &network.driver, &network.scope, &network.id], &query))
            .cloned()
            .collect();
        if networks.is_empty() {
            return self.render_empty("No networks", "Networks that Docker and Compose create show up here.", !self.networks.is_empty());
        }
        let rows = networks
            .into_iter()
            .map(|network| {
                let (inspect_id, inspect_name) = (network.id.clone(), network.name.clone());
                let copy_name = network.name.clone();
                let menu = network.clone();
                let actions = vec![
                    row_button(format!("network-copy-{}", network.id), IconName::Copy, "Copy Name", false, cx, move |this, _, _, cx| {
                        this.copy(copy_name.clone(), "the network name", cx)
                    }),
                    row_button(format!("network-inspect-{}", network.id), IconName::Info, "Inspect", false, cx, move |this, _, _, cx| {
                        this.open_inspect("network", inspect_id.clone(), inspect_name.clone(), cx)
                    }),
                ];
                TableRow {
                    id: format!("network-{}", network.id).into(),
                    leading: Icon::new(IconName::Sitemap).size(IconSize::XSmall).color(colors.subtle_foreground).into_any_element(),
                    cells: vec![
                        cell(0.36).child(primary(network.name.clone(), colors)).into_any_element(),
                        cell(0.24).text_color(colors.subtle_foreground).child(mono(short_id(&network.id).to_string())).into_any_element(),
                        cell(0.14).child(network.driver.clone()).into_any_element(),
                        cell(0.12).text_color(colors.subtle_foreground).child(network.scope.clone()).into_any_element(),
                        cell(0.14).text_color(colors.subtle_foreground).child(if network.internal == "true" { "Internal" } else { "" }).into_any_element(),
                    ],
                    actions,
                    more: None,
                    busy: false,
                }
                .render(colors, cx, move |this, position, window, cx| {
                    let entries = this.network_menu(&menu, cx);
                    this.show_menu(&format!("network:{}", menu.id), entries, position, window, cx);
                })
            })
            .collect();
        let header = table_header(&[("Name", 0.36), ("Network ID", 0.24), ("Driver", 0.14), ("Scope", 0.12), ("", 0.14)], colors);
        self.table("docker-networks", header, rows, window, cx)
    }

    /// `getNetworkView`: copy its name or ID, or inspect it.
    fn network_menu(&self, network: &DockerNetwork, cx: &Context<Self>) -> Vec<ui::MenuEntry> {
        let (name, id) = (network.name.clone(), network.id.clone());
        let (inspect_id, inspect_name) = (id.clone(), name.clone());
        vec![
            self.item("Copy Name", cx, move |this, _, cx| this.copy(name.clone(), "the network name", cx)).icon(IconName::Copy).into(),
            self.item("Copy Network ID", cx, move |this, _, cx| this.copy(id.clone(), "the network ID", cx)).icon(IconName::Copy).into(),
            self.item("Inspect", cx, move |this, _, cx| this.open_inspect("network", inspect_id.clone(), inspect_name.clone(), cx)).icon(IconName::Info).into(),
        ]
    }

    fn render_compose(&self, colors: &ThemeColors, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        if self.cwd.is_none() {
            return self.render_empty("No project open", "Open a project folder to manage its Compose services.", false);
        }
        if let Some(error) = &self.compose_error {
            return div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .child(
                    EmptyState::new("Couldn't load Compose services").icon(IconName::WarningCircle).message(error.clone()).action(
                        Button::new("docker-compose-retry", "Retry")
                            .size(ButtonSize::Small)
                            .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
                    ),
                )
                .into_any_element();
        }
        let Some(project) = self.compose.as_ref().filter(|project| !project.files.is_empty()) else {
            return self.render_empty(
                "No Compose file",
                "Add compose.yaml or docker-compose.yml to this project to manage its services here.",
                false,
            );
        };
        let busy = self.busy.contains("compose:");
        let files = project
            .files
            .iter()
            .map(|file| {
                let path = std::path::Path::new(file);
                self.cwd
                    .as_ref()
                    .and_then(|cwd| path.strip_prefix(cwd).ok())
                    .unwrap_or(path)
                    .to_string_lossy()
                    .into_owned()
            })
            .collect::<Vec<_>>()
            .join(", ");
        let running = project.services.iter().filter(|service| service.state == "running").count();
        let env = self.project.as_ref().map(|config| config.env_files.clone()).unwrap_or_default();
        let env_files: Vec<String> = env.iter().map(|file| file.path.clone()).collect();
        let env_labels = env.iter().map(|file| file.relative_path.clone()).collect::<Vec<_>>().join(", ");
        let project_bar = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(10.))
            .mx(px(8.))
            .mb(px(6.))
            .px(px(12.))
            .py(px(10.))
            .rounded(metrics::radius_lg())
            .bg(colors.surface)
            .child(Icon::new(IconName::Nodes).size(IconSize::Small).color(colors.subtle_foreground))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .child(primary(files, colors).text_size(typography::text_sm()))
                    .child(
                        div()
                            .text_size(typography::text_caption())
                            .text_color(colors.subtle_foreground)
                            .child(format!("{} · {running} running", plural(project.services.len(), "service"))),
                    ),
            )
            .when(!env_files.is_empty(), |this| {
                this.child(
                    Button::new("compose-up-env", "Up With Env Files")
                        .leading_icon(IconName::FileText)
                        .size(ButtonSize::Small)
                        .tooltip(env_labels.clone())
                        .disabled(busy)
                        .on_click(cx.listener(move |this, _, _, cx| this.compose_action_with(None, "up", env_files.clone(), cx))),
                )
            })
            .child(
                Button::new("compose-up", "Up")
                    .leading_icon(IconName::Play)
                    .size(ButtonSize::Small)
                    .variant(ButtonVariant::Accent)
                    .disabled(busy)
                    .on_click(cx.listener(|this, _, _, cx| this.compose_action(None, "up", cx))),
            )
            .child(
                Button::new("compose-restart", "Restart")
                    .leading_icon(IconName::ArrowsClockwise)
                    .size(ButtonSize::Small)
                    .disabled(busy)
                    .on_click(cx.listener(|this, _, _, cx| this.compose_action(None, "restart", cx))),
            )
            .child(
                Button::new("compose-down", "Down")
                    .leading_icon(IconName::Stop)
                    .size(ButtonSize::Small)
                    .disabled(busy)
                    .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                        this.confirm(
                            "Stop and remove the project's containers?",
                            "Compose Down",
                            below(event.position()),
                            window,
                            cx,
                            |this, cx| this.compose_action(None, "down", cx),
                        )
                    })),
            )
            .child(
                Button::icon("compose-save-preset", IconName::Save)
                    .size(ButtonSize::Small)
                    .tooltip("Save Up with this workspace's env files as a preset")
                    .on_click(cx.listener(|this, _, window, cx| this.save_compose_preset(window, cx))),
            );

        let rows = project
            .services
            .iter()
            .map(|service| {
                let name = service.name.clone();
                let tone = tone_color(model::state_tone(&service.state, service.health.as_deref()), colors);
                let service_busy = busy || self.busy.contains(&format!("compose:{name}"));
                let running = service.state == "running";
                let mut actions = Vec::new();
                let toggle_name = name.clone();
                actions.push(if running {
                    row_button(format!("svc-stop-{name}"), IconName::Stop, "Stop", service_busy, cx, move |this, _, _, cx| {
                        this.compose_action(Some(toggle_name.clone()), "stop", cx)
                    })
                } else {
                    row_button(format!("svc-up-{name}"), IconName::Play, "Up", service_busy, cx, move |this, _, _, cx| {
                        this.compose_action(Some(toggle_name.clone()), "up", cx)
                    })
                });
                let restart_name = name.clone();
                actions.push(row_button(format!("svc-restart-{name}"), IconName::ArrowsClockwise, "Restart", service_busy, cx, move |this, _, _, cx| {
                    this.compose_action(Some(restart_name.clone()), "restart", cx)
                }));
                let rebuild_name = name.clone();
                actions.push(row_button(format!("svc-rebuild-{name}"), IconName::Stack, "Rebuild", service_busy, cx, move |this, _, _, cx| {
                    this.compose_action(Some(rebuild_name.clone()), "rebuild", cx)
                }));
                if let Some(container_id) = service.container_id.clone() {
                    let title = service.container_name.clone().unwrap_or_else(|| name.clone());
                    actions.push(row_button(format!("svc-logs-{name}"), IconName::List, "Logs", false, cx, move |this, _, _, cx| {
                        this.open_logs(container_id.clone(), title.clone(), cx)
                    }));
                }
                let menu_service = service.clone();
                TableRow {
                    id: format!("service-{name}").into(),
                    leading: status_dot(tone).into_any_element(),
                    cells: vec![
                        cell(0.22).child(primary(name.clone(), colors)).into_any_element(),
                        cell(0.24).child(service.container_name.clone().unwrap_or_else(|| "Not created".to_string())).into_any_element(),
                        cell(0.3)
                            .flex()
                            .gap(px(6.))
                            .child(
                                div()
                                    .flex_none()
                                    .text_color(tone)
                                    .font_weight(typography::MEDIUM)
                                    .child(model::state_label(&service.state, service.health.as_deref())),
                            )
                            .child(div().min_w_0().truncate().text_color(colors.subtle_foreground).child(service.status.clone()))
                            .into_any_element(),
                        cell(0.24).child(mono(model::format_ports(&service.ports))).into_any_element(),
                    ],
                    actions,
                    more: None,
                    busy: service_busy,
                }
                .render(colors, cx, move |this, position, window, cx| {
                    let entries = this.service_menu(&menu_service, cx);
                    this.show_menu(&format!("service:{}", menu_service.name), entries, position, window, cx);
                })
            })
            .collect();
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .pt(px(4.))
            .child(project_bar)
            .child(self.table(
                "docker-services",
                table_header(&[("Service", 0.22), ("Container", 0.24), ("Status", 0.3), ("Ports", 0.24)], colors),
                rows,
                window,
                cx,
            ))
            .into_any_element()
    }

    fn service_menu(&self, service: &athas_docker::DockerComposeService, cx: &Context<Self>) -> Vec<ui::MenuEntry> {
        let name = service.name.clone();
        let action = |label: &str, icon: IconName, action: &'static str| -> ui::MenuEntry {
            let name = name.clone();
            self.item(label.to_string(), cx, move |this, _, cx| this.compose_action(Some(name.clone()), action, cx)).icon(icon).into()
        };
        let mut entries = vec![action("Up", IconName::Play, "up")];
        if service.state == "running" {
            entries.push(action("Stop", IconName::Stop, "stop"));
        }
        entries.push(action("Restart", IconName::ArrowsClockwise, "restart"));
        entries.push(action("Rebuild", IconName::Stack, "rebuild"));
        if let Some(container_id) = service.container_id.clone() {
            entries.push(ui::MenuEntry::Separator);
            let title = service.container_name.clone().unwrap_or_else(|| name.clone());
            let (logs_id, logs_title) = (container_id.clone(), title.clone());
            entries.push(
                self.item("Show Logs", cx, move |this, _, cx| this.open_logs(logs_id.clone(), logs_title.clone(), cx)).icon(IconName::List).into(),
            );
            entries.push(
                self.item("Inspect", cx, move |this, _, cx| this.open_inspect("container", container_id.clone(), title.clone(), cx))
                    .icon(IconName::Info)
                    .into(),
            );
        }
        if let Some(url) = model::service_url(&service.ports) {
            entries.push(self.item(format!("Open {url}"), cx, move |_, _, cx| cx.open_url(&url)).icon(IconName::OpenExternal).into());
        }
        entries
    }

    // Log and inspect pages.

    pub(crate) fn render_detail_bar(&self, title: SharedString, kind: &str, colors: &ThemeColors, cx: &mut Context<Self>) -> gpui::Div {
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(6.))
            .h(px(36.))
            .px(px(10.))
            .border_b_1()
            .border_color(colors.divider)
            .child(
                Button::icon("docker-detail-back", IconName::ArrowLeft)
                    .size(ButtonSize::Small)
                    .tooltip("Back")
                    .on_click(cx.listener(|this, _, _, cx| this.close_detail(cx))),
            )
            .child(div().min_w_0().truncate().text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(colors.foreground).child(title))
            .child(div().flex_none().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(kind.to_string()))
            .child(div().flex_1())
    }

    fn render_logs(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let Some(Detail::Logs(logs)) = &self.detail else { return div().into_any_element() };
        let follow = logs.follow;
        let count = logs.lines.len();
        let bar = self
            .render_detail_bar(logs.title.clone(), "Logs", colors, cx)
            .children(logs.ended.clone().map(|ended| {
                div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).mr(px(6.)).child(ended)
            }))
            .child(
                Button::new("docker-logs-follow", "Follow")
                    .leading_icon(IconName::ArrowDownToLine)
                    .size(ButtonSize::Small)
                    .variant(ButtonVariant::Ghost)
                    .active(follow)
                    .filled_when_active()
                    .tooltip(if follow { "Stop following" } else { "Follow new lines" })
                    .on_click(cx.listener(move |this, _, _, cx| this.set_follow(!follow, cx))),
            )
            .child(
                Button::icon("docker-logs-copy", IconName::Copy)
                    .size(ButtonSize::Small)
                    .tooltip("Copy log")
                    .disabled(count == 0)
                    .on_click(cx.listener(|this, _, _, cx| {
                        if let Some(Detail::Logs(logs)) = &this.detail {
                            let text = logs.lines.iter().map(|line| line.text.as_ref()).collect::<Vec<_>>().join("\n");
                            this.copy(text, "the log", cx);
                        }
                    })),
            )
            .child(
                Button::icon("docker-logs-clear", IconName::Broom)
                    .size(ButtonSize::Small)
                    .tooltip("Clear")
                    .disabled(count == 0)
                    .on_click(cx.listener(|this, _, _, cx| this.clear_logs(cx))),
            );
        let body = if count == 0 {
            div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .text_size(typography::text_sm())
                .text_color(colors.subtle_foreground)
                .child(if logs.ended.is_some() { "No log output" } else { "Waiting for log output…" })
                .into_any_element()
        } else {
            let scroll = logs.scroll.clone();
            div()
                .id("docker-logs-body")
                .relative()
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .on_scroll(cx.listener(|this, event: &ScrollEvent, _, cx| {
                    if event.delta.pixel_delta(line_height()).y > px(0.)
                        && let Some(Detail::Logs(logs)) = &this.detail
                        && logs.follow
                    {
                        this.set_follow(false, cx);
                    }
                }))
                .child(
                    uniform_list("docker-log-lines", count, cx.processor(Self::render_log_lines))
                        .track_scroll(&scroll)
                        .flex_1()
                        .py(px(6.)),
                )
                .child(Scrollbar::uniform("docker-log-scrollbar", &scroll))
                .into_any_element()
        };
        div().flex().flex_col().flex_1().min_h_0().child(bar).child(body).into_any_element()
    }

    fn render_log_lines(&mut self, range: std::ops::Range<usize>, _: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let Some(Detail::Logs(logs)) = &self.detail else { return Vec::new() };
        range
            .filter_map(|index| logs.lines.get(index))
            .map(|line| {
                div()
                    .flex()
                    .h(line_height())
                    .px(px(12.))
                    .gap(px(12.))
                    .font_family(typography::MONO_FONT)
                    .text_size(typography::text_sm())
                    .whitespace_nowrap()
                    .children(line.stamp.clone().map(|stamp| div().flex_none().w(px(92.)).text_color(colors.subtle_foreground).child(stamp)))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_color(if line.stderr { colors.destructive } else { colors.foreground })
                            .child(line.text.clone()),
                    )
                    .into_any_element()
            })
            .collect()
    }

    fn render_inspect(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let Some(Detail::Inspect(inspect)) = &self.detail else { return div().into_any_element() };
        let ready = matches!(inspect.text, Some(Ok(_)));
        let bar = self.render_detail_bar(inspect.title.clone(), "Inspect", colors, cx).child(
            Button::new("docker-inspect-copy", "Copy JSON")
                .leading_icon(IconName::Copy)
                .size(ButtonSize::Small)
                .variant(ButtonVariant::Ghost)
                .disabled(!ready)
                .on_click(cx.listener(|this, _, _, cx| {
                    if let Some(Detail::Inspect(inspect)) = &this.detail
                        && let Some(Ok(text)) = &inspect.text
                    {
                        let text = text.clone();
                        this.copy(text, "the JSON", cx);
                    }
                })),
        );
        let body = match &inspect.text {
            None => self.render_empty("Inspecting…", "", false),
            Some(Err(error)) => div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .child(EmptyState::new("Couldn't inspect").icon(IconName::WarningCircle).message(error.clone()))
                .into_any_element(),
            Some(Ok(_)) => ui::with_scrollbar(
                uniform_list("docker-inspect-lines", inspect.lines.len(), cx.processor(Self::render_inspect_lines))
                    .track_scroll(&inspect.scroll)
                    .flex_1()
                    .py(px(6.)),
                Scrollbar::uniform("docker-inspect-scrollbar", &inspect.scroll),
            )
            .into_any_element(),
        };
        div().flex().flex_col().flex_1().min_h_0().child(bar).child(body).into_any_element()
    }

    fn render_inspect_lines(&mut self, range: std::ops::Range<usize>, _: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let Some(Detail::Inspect(inspect)) = &self.detail else { return Vec::new() };
        let color = |token: JsonToken| match token {
            JsonToken::Key => syntax(&colors, "property", colors.info),
            JsonToken::String => syntax(&colors, "string", colors.success),
            JsonToken::Number => syntax(&colors, "number", colors.warning),
            JsonToken::Literal => syntax(&colors, "boolean", colors.merged),
        };
        range
            .filter_map(|index| inspect.lines.get(index))
            .map(|line| {
                let highlights = model::json_line_tokens(line)
                    .into_iter()
                    .map(|(range, token)| (range, HighlightStyle { color: Some(color(token)), ..Default::default() }));
                div()
                    .h(line_height())
                    .px(px(12.))
                    .font_family(typography::MONO_FONT)
                    .text_size(typography::text_sm())
                    .text_color(colors.muted_foreground)
                    .whitespace_nowrap()
                    .truncate()
                    .child(StyledText::new(line.clone()).with_highlights(highlights))
                    .into_any_element()
            })
            .collect()
    }

    // The foot of the view.

    fn render_form(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Option<AnyElement> {
        let form = self.form.as_ref()?;
        let theme = cx.theme().clone();
        let results = form.search.as_ref().map(|search| self.render_search(search, colors, cx));
        Some(
            div()
                .flex_none()
                .px(px(8.))
                .pb(px(8.))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(8.))
                        .p(px(12.))
                        .rounded(metrics::radius_lg())
                        .bg(colors.raised)
                        .shadow(theme.shadows.raised.clone())
                        .child(div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(colors.foreground).child(form.title.clone()))
                        .child(div().flex().flex_wrap().gap(px(8.)).children(form.fields.iter().map(|(label, input)| {
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_w(px(180.))
                                .gap(px(4.))
                                .child(div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(label.clone()))
                                .child(input.clone())
                        })))
                        .children(results)
                        .child(
                            div()
                                .flex()
                                .justify_end()
                                .gap(px(6.))
                                .children(form.secondary.clone().map(|label| {
                                    Button::new("docker-form-secondary", label)
                                        .size(ButtonSize::Small)
                                        .variant(ButtonVariant::Ghost)
                                        .on_click(cx.listener(|this, _, window, cx| this.submit_secondary(window, cx)))
                                }))
                                .child(div().flex_1())
                                .child(
                                    Button::new("docker-form-cancel", "Cancel")
                                        .size(ButtonSize::Small)
                                        .variant(ButtonVariant::Ghost)
                                        .on_click(cx.listener(|this, _, _, cx| this.close_form(cx))),
                                )
                                .child(
                                    Button::new("docker-form-submit", form.confirm.clone())
                                        .size(ButtonSize::Small)
                                        .variant(ButtonVariant::Accent)
                                        .on_click(cx.listener(|this, _, window, cx| this.submit_form(window, cx))),
                                ),
                        ),
                )
                .into_any_element(),
        )
    }

    /// Docker Hub's results under the pull form; picking one pulls it.
    fn render_search(&self, search: &crate::Search, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let status = if search.busy {
            Some(SharedString::from("Searching Docker Hub…"))
        } else {
            search.error.clone()
        };
        let rows = search.results.iter().filter(|result| result.name != search.query).take(8).map(|result| {
            let stars = (!result.star_count.is_empty() && result.star_count != "0").then(|| format!("{} stars", result.star_count));
            let detail = model::join_parts([stars.as_deref(), (result.official == "[OK]").then_some("official"), Some(result.description.as_str())]);
            let image = result.name.clone();
            div()
                .id(ElementId::Name(format!("docker-search-{}", result.name).into()))
                .flex()
                .items_center()
                .gap(px(8.))
                .h(px(26.))
                .px(px(8.))
                .rounded(metrics::radius_md())
                .text_size(typography::text_sm())
                .hover(|style| style.bg(colors.accent))
                .child(Icon::new(IconName::CloudArrowDown).size(IconSize::XSmall).color(colors.subtle_foreground))
                .child(div().flex_none().font_weight(typography::MEDIUM).text_color(colors.foreground).child(result.name.clone()))
                .child(div().flex_1().min_w_0().truncate().text_color(colors.subtle_foreground).child(detail))
                .on_click(cx.listener(move |this, _, window, cx| this.pull_result(image.clone(), window, cx)))
        });
        div()
            .flex()
            .flex_col()
            .children(status.map(|status| div().px(px(8.)).text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(status)))
            .children(rows)
            .into_any_element()
    }

    fn render_notice(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Option<AnyElement> {
        let notice = self.notice.as_ref()?;
        let (icon, tone) = match notice.tone {
            Tone::Success => (IconName::CheckCircle, colors.success),
            Tone::Error => (IconName::WarningCircle, colors.destructive),
        };
        let theme = cx.theme().clone();
        Some(
            div()
                .flex_none()
                .px(px(8.))
                .pb(px(8.))
                .child(
                    div()
                        .flex()
                        .items_start()
                        .gap(px(8.))
                        .p(px(8.))
                        .rounded(metrics::radius_lg())
                        .bg(colors.raised)
                        .shadow(theme.shadows.raised.clone())
                        .text_size(typography::text_sm())
                        .child(div().pt(px(2.)).child(Icon::new(icon).size(IconSize::XSmall).color(tone)))
                        .child(div().flex_1().min_w_0().text_color(colors.foreground).child(notice.message.clone()))
                        .child(
                            Button::icon("docker-notice-close", IconName::X)
                                .size(ButtonSize::XSmall)
                                .tooltip("Dismiss")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.notice = None;
                                    cx.notify();
                                })),
                        ),
                )
                .into_any_element(),
        )
    }
}

impl Render for DockerView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.drawn = true;
        if let Some(kind) = self.pending_form.take() {
            cx.defer_in(window, move |this, window, cx| this.open_named_form(&kind, window, cx));
        }
        let colors = cx.theme().colors.clone();
        let body = match &self.status {
            Status::Loading => div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .text_size(typography::text_sm())
                .text_color(colors.subtle_foreground)
                .child("Connecting to Docker…")
                .into_any_element(),
            Status::Unavailable(error) => self.render_unavailable(error.clone(), &colors, cx),
            Status::Ready => match (&self.detail, self.tab) {
                (Some(Detail::Logs(_)), _) => self.render_logs(&colors, cx),
                (Some(Detail::Inspect(_)), _) => self.render_inspect(&colors, cx),
                (Some(Detail::Files(_)), _) => self.render_files(&colors, window, cx),
                (None, Tab::Containers) => self.render_containers(&colors, window, cx),
                (None, Tab::Images) => self.render_images(&colors, window, cx),
                (None, Tab::Volumes) => self.render_volumes(&colors, window, cx),
                (None, Tab::Networks) => self.render_networks(&colors, window, cx),
                (None, Tab::Compose) => self.render_compose(&colors, window, cx),
                (None, Tab::Project) => self.render_project(&colors, window, cx),
            },
        };
        div()
            .id("docker-view")
            .track_focus(&self.focus_handle)
            .flex()
            .flex_col()
            .flex_1()
            .size_full()
            .min_h_0()
            .min_w_0()
            .font_family(typography::UI_FONT)
            .child(self.render_header(&colors, cx))
            .child(div().flex().flex_col().flex_1().min_h_0().child(body))
            .children(self.render_form(&colors, cx))
            .children(self.render_notice(&colors, cx))
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
    }
}
