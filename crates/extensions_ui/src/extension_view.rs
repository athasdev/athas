//! Draws a UI extension's view with the shared controls (`extension-view-renderer.tsx`,
//! `extension-view-controls.tsx`, `-tree`, `-activity`, `-visualizations`,
//! `extension-diff-preview.tsx`, `external-extension-view.tsx`, `generative-ui-renderer.tsx`).
//! Every control's action goes back to the extension; a view action re-renders the view.

use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use extension_host::adapter::{OPEN_EXTERNAL_VIEW_COMMAND, normalize_generative_view, resolve_external_url};
use extension_host::view::{
    self, ActivityState, BarItem, ButtonTone as ViewButtonTone, CalloutTone, CardVariant as ViewCardVariant, ChoiceValue, DiffLine, DiffLineType, Node,
    TreeItem, ViewValue,
};
use extension_host::{Action, view::Tone as ViewTone};
use ui::scale::px;
use gpui::{
    AnyElement, App, ClickEvent, Context, Entity, Hsla, PathBuilder, ScrollHandle, SharedString, Subscription, WeakEntity, Window, canvas, div, point,
    prelude::*, relative,
};
use serde_json::{Map, Value, json};
use theme::{ActiveTheme, ThemeColors};
use ui::{
    AccordionItem, Alert, Badge, Button, ButtonSize, ButtonTone, ButtonVariant, Card, CardHeader, CardVariant, Checkbox, EmptyState, Icon, IconName,
    IconSize, Item, ItemVariant, NumberInput, NumberInputEvent, Progress, SectionLabel, Select, SelectEvent, SelectOption, SidebarListItem, Spinner,
    Switch, Table, TableColumn, TableRow, Tabs, TabsTrigger, TextArea, TextAreaEvent, TextInput, TextInputEvent, ToggleGroup, ToggleOption, Tone,
    WithScrollbar, card_content, metrics, typography,
};

use crate::ui_extensions::{self, UiExtensions};

/// Where the view is drawn: a sidebar panel, or inside other content (a dialog, a message).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Surface {
    Sidebar,
    Embedded,
}

#[derive(Clone, Debug)]
enum Source {
    Extension { extension_id: String, view_id: String },
    Generative,
}

enum ControlEntity {
    Input(Entity<TextInput>),
    TextArea(Entity<TextArea>),
    Number(Entity<NumberInput>),
    Select(Entity<Select>),
}

struct Control {
    initial: Value,
    entity: ControlEntity,
    _subscription: Subscription,
}

#[derive(Default)]
struct FormState {
    initial: Map<String, Value>,
    values: Map<String, Value>,
    attempted: bool,
    too_large: bool,
}

struct Binding {
    form: Option<String>,
    name: Option<String>,
    on_change: Option<Action>,
    on_submit: Option<Action>,
}

pub struct ExtensionView {
    source: Source,
    surface: Surface,
    node: Option<Rc<Node>>,
    error: Option<SharedString>,
    action_error: Option<SharedString>,
    revision: Option<u64>,
    controls: HashMap<String, Control>,
    forms: HashMap<String, FormState>,
    pending: HashSet<String>,
    local: HashMap<String, (Value, Value)>,
    scroll: ScrollHandle,
    _subscriptions: Vec<Subscription>,
}

fn icon_for(name: &str) -> IconName {
    let pascal: String = name
        .split(['-', '_', ' '])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars.next().map(|first| first.to_uppercase().chain(chars).collect::<String>()).unwrap_or_default()
        })
        .collect();
    IconName::from_name(&pascal).unwrap_or(IconName::PuzzlePiece)
}

fn badge_tone(tone: Option<ViewTone>) -> Tone {
    match tone {
        Some(ViewTone::Error) => Tone::Danger,
        Some(ViewTone::Accent) => Tone::Accent,
        Some(ViewTone::Success) => Tone::Success,
        Some(ViewTone::Warning) => Tone::Warning,
        _ => Tone::Neutral,
    }
}

fn metric_color(tone: Option<ViewTone>, colors: &ThemeColors) -> Hsla {
    match tone {
        Some(ViewTone::Accent) => colors.primary,
        Some(ViewTone::Success) => colors.success,
        Some(ViewTone::Warning) => colors.warning,
        Some(ViewTone::Error) => colors.destructive,
        Some(ViewTone::Muted) => colors.subtle_foreground,
        _ => colors.foreground,
    }
}

fn text_color(tone: Option<ViewTone>, colors: &ThemeColors) -> Hsla {
    match tone {
        None | Some(ViewTone::Default) | Some(ViewTone::Muted) => colors.subtle_foreground,
        tone => metric_color(tone, colors),
    }
}

fn element_id(path: &str, part: &str) -> SharedString {
    SharedString::from(format!("extension-view-{path}-{part}"))
}

impl ExtensionView {
    /// A registered view of a running extension; it re-renders whenever the extension
    /// invalidates it.
    pub fn for_extension(extension_id: impl Into<String>, view_id: impl Into<String>, surface: Surface, cx: &mut Context<Self>) -> Self {
        let subscriptions = vec![cx.observe_global::<UiExtensions>(|this, cx| this.refresh(cx))];
        let mut view = Self::empty(Source::Extension { extension_id: extension_id.into(), view_id: view_id.into() }, surface, subscriptions);
        view.refresh(cx);
        view
    }

    /// A view an agent message carries (a view node or the older component shape); its actions
    /// may only open links or run registered extension commands.
    pub fn generative(value: &Value, cx: &mut Context<Self>) -> Self {
        // The Pro gate follows the account (signing in, the plan loading).
        let subscriptions = account::AccountStore::global(cx).map(|store| cx.observe(&store, |_, _, cx| cx.notify())).into_iter().collect();
        let mut view = Self::empty(Source::Generative, Surface::Embedded, subscriptions);
        match normalize_generative_view(value) {
            Ok(node) => view.set_node(node),
            Err(error) => view.error = Some(error.to_string().into()),
        }
        view
    }

    fn empty(source: Source, surface: Surface, subscriptions: Vec<Subscription>) -> Self {
        Self {
            source,
            surface,
            node: None,
            error: None,
            action_error: None,
            revision: None,
            controls: HashMap::new(),
            forms: HashMap::new(),
            pending: HashSet::new(),
            local: HashMap::new(),
            scroll: ScrollHandle::new(),
            _subscriptions: subscriptions,
        }
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        let Source::Extension { extension_id, view_id } = &self.source else { return };
        if !cx.has_global::<UiExtensions>() {
            return;
        }
        let host = ui_extensions::host(cx);
        let revision = host.with_store(|store| {
            let shown = store.sidebar_views.contains_key(view_id) || store.dialogs.iter().any(|dialog| dialog.id == *view_id);
            shown.then(|| store.revision(view_id))
        });
        if revision.is_none() || revision == self.revision {
            return;
        }
        self.revision = revision;
        let task = host.render_view(extension_id, view_id);
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                match result {
                    Ok(node) => {
                        this.error = None;
                        this.set_node(node);
                    }
                    Err(error) => this.error = Some(error.into()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn set_node(&mut self, node: Node) {
        let mut forms = HashMap::new();
        collect_forms(&node, "0", &mut forms);
        for (path, initial) in forms {
            let state = self.forms.entry(path).or_default();
            if state.initial != initial {
                *state = FormState { values: initial.clone(), initial, attempted: false, too_large: false };
            }
        }
        self.node = Some(Rc::new(node));
    }

    pub fn node(&self) -> Option<&Node> {
        self.node.as_deref()
    }

    pub fn error(&self) -> Option<&SharedString> {
        self.error.as_ref()
    }

    /// Runs `action` with the given extra arguments; `pending` names the control that shows
    /// progress until it finishes (a second press meanwhile does nothing).
    fn execute(&mut self, action: Action, extra: Vec<Value>, pending: Option<String>, cx: &mut Context<Self>) {
        if let Some(key) = &pending {
            if !self.pending.insert(key.clone()) {
                return;
            }
            cx.notify();
        }
        self.action_error = None;
        let arguments = action.arguments(extra);
        let task: gpui::Task<Result<Value, String>> = match &self.source {
            Source::Extension { extension_id, view_id } => {
                let request = ui_extensions::host(cx).execute_view_action(extension_id, view_id, &action.command, arguments);
                cx.background_executor().spawn(request)
            }
            Source::Generative if action.command == OPEN_EXTERNAL_VIEW_COMMAND => {
                let result = resolve_external_url(arguments.first()).map(|url| {
                    cx.open_url(&url);
                    Value::Null
                });
                gpui::Task::ready(result)
            }
            Source::Generative if cx.has_global::<UiExtensions>() => {
                let request = ui_extensions::host(cx).run_registered_command(&action.command, arguments);
                cx.background_executor().spawn(request)
            }
            Source::Generative => gpui::Task::ready(Err(format!("Generated UI command is not available: {}", action.command))),
        };
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if let Some(key) = &pending {
                    this.pending.remove(key);
                }
                if let Err(error) = result {
                    match this.source {
                        Source::Extension { .. } => this.error = Some(error.into()),
                        Source::Generative => this.action_error = Some(error.into()),
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn set_form_value(&mut self, form: Option<&str>, name: Option<&str>, value: Value) {
        if let (Some(form), Some(name)) = (form, name)
            && let Some(state) = self.forms.get_mut(form)
        {
            state.values.insert(name.to_string(), value);
            state.too_large = false;
        }
    }

    fn submit_form(&mut self, path: &str, cx: &mut Context<Self>) {
        let Some(Node::Form { on_submit, children, .. }) = self.node.clone().and_then(|node| find(&node, "0", path).cloned()) else {
            return;
        };
        let Some(state) = self.forms.get_mut(path) else { return };
        state.attempted = true;
        let fields = view::collect_form_fields(&children);
        if !view::missing_form_fields(&fields, &state.values).is_empty() {
            cx.notify();
            return;
        }
        if !view::form_payload_fits(&state.values) {
            state.too_large = true;
            cx.notify();
            return;
        }
        let values = Value::Object(state.values.clone());
        self.execute(on_submit, vec![values], Some(path.to_string()), cx);
    }

    fn bound(&mut self, binding: &Binding, value: Value, submit: bool, cx: &mut Context<Self>) {
        if submit {
            if let Some(action) = binding.on_submit.clone() {
                self.execute(action, vec![value], None, cx);
            }
            return;
        }
        self.set_form_value(binding.form.as_deref(), binding.name.as_deref(), value.clone());
        if let Some(action) = binding.on_change.clone() {
            self.execute(action, vec![value], None, cx);
        }
        cx.notify();
    }

    /// Makes the field entities the view needs, keeping those whose value the extension did not
    /// change, and drops the rest.
    fn sync_controls(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(node) = self.node.clone() else { return };
        let mut wanted = Vec::new();
        collect_controls(&node, "0".to_string(), None, &mut wanted);
        let keep: HashSet<String> = wanted.iter().map(|(path, ..)| path.clone()).collect();
        self.controls.retain(|path, _| keep.contains(path));
        for (path, node, form) in wanted {
            let initial = control_value(&node);
            if self.controls.get(&path).is_some_and(|control| control.initial == initial) {
                continue;
            }
            if let Some(control) = self.make_control(&node, form, initial, window, cx) {
                self.controls.insert(path, control);
            }
        }
    }

    fn make_control(&mut self, node: &Node, form: Option<String>, initial: Value, window: &mut Window, cx: &mut Context<Self>) -> Option<Control> {
        let binding = |name: &Option<String>, on_change: &Option<Action>, on_submit: Option<&Action>| Binding {
            form: form.clone(),
            name: name.clone(),
            on_change: on_change.clone(),
            on_submit: on_submit.cloned(),
        };
        let (entity, subscription) = match node {
            Node::Input { field, value, placeholder, input_type, on_change, on_submit, disabled, .. } => {
                let binding = binding(&field.name, on_change, on_submit.as_ref());
                let text = value.clone().unwrap_or_default();
                let masked = *input_type == Some(view::InputType::Password);
                let disabled = disabled.unwrap_or(false);
                let input = cx.new(|cx| {
                    let mut input = TextInput::new(window, cx).placeholder(placeholder.clone().unwrap_or_default());
                    if masked {
                        input = input.masked();
                    }
                    input.set_text(text, cx);
                    input.set_disabled(disabled, cx);
                    input
                });
                let subscription = cx.subscribe(&input, move |this, input, event: &TextInputEvent, cx| match event {
                    TextInputEvent::Changed(text) => this.bound(&binding, json!(text.to_string()), false, cx),
                    TextInputEvent::Confirmed => {
                        let text = input.read(cx).text().to_string();
                        this.bound(&binding, json!(text), true, cx);
                    }
                    _ => {}
                });
                (ControlEntity::Input(input), subscription)
            }
            Node::Textarea { field, value, placeholder, rows, on_change, on_submit, disabled, .. } => {
                let binding = binding(&field.name, on_change, on_submit.as_ref());
                let text = value.clone().unwrap_or_default();
                let rows = rows.unwrap_or(4) as usize;
                let disabled = disabled.unwrap_or(false);
                let area = cx.new(|cx| {
                    let mut area = TextArea::new(cx).rows(rows).placeholder(placeholder.clone().unwrap_or_default());
                    area.set_text(text, cx);
                    area.set_disabled(disabled, cx);
                    area
                });
                let subscription = cx.subscribe(&area, move |this, area, event: &TextAreaEvent, cx| {
                    let text = json!(area.read(cx).text().to_string());
                    match event {
                        TextAreaEvent::Changed => this.bound(&binding, text, false, cx),
                        TextAreaEvent::Submit => this.bound(&binding, text, true, cx),
                        TextAreaEvent::Cancelled => {}
                    }
                });
                (ControlEntity::TextArea(area), subscription)
            }
            Node::NumberInput { field, value, min, max, step, on_change, on_submit, disabled, .. } => {
                let binding = binding(&field.name, on_change, on_submit.as_ref());
                let (value, min, max, step, disabled) = (*value, *min, *max, *step, disabled.unwrap_or(false));
                let number = cx.new(|cx| {
                    let mut number = NumberInput::new(value, window, cx).range(min, max, cx).full_width();
                    if let Some(step) = step {
                        number = number.step(step, cx);
                    }
                    number.set_disabled(disabled, cx);
                    number
                });
                let subscription = cx.subscribe(&number, move |this, _, event: &NumberInputEvent, cx| {
                    let NumberInputEvent::Changed(value) = event;
                    this.bound(&binding, json!(value), false, cx);
                });
                (ControlEntity::Number(number), subscription)
            }
            Node::Select { field, value, placeholder, options, on_change, .. } => {
                let binding = binding(&field.name, on_change, None);
                let options: Vec<SelectOption> =
                    options.iter().map(|option| SelectOption::new(option.value.clone(), option.label.clone()).disabled(option.disabled == Some(true))).collect();
                let value = value.clone().unwrap_or_default();
                let placeholder = placeholder.clone();
                let select = cx.new(|cx| {
                    let select = Select::new(options, value, cx);
                    match placeholder {
                        Some(placeholder) => select.placeholder(placeholder),
                        None => select,
                    }
                });
                let subscription = cx.subscribe(&select, move |this, _, event: &SelectEvent, cx| {
                    if let SelectEvent::Changed(value) = event {
                        this.bound(&binding, json!(value.to_string()), false, cx);
                    }
                });
                (ControlEntity::Select(select), subscription)
            }
            _ => return None,
        };
        Some(Control { initial, entity, _subscription: subscription })
    }

    /// The local value of a toggle, checkbox or choice: what the extension last sent until the
    /// user changes it.
    fn local_value(&mut self, path: &str, initial: Value) -> Value {
        let entry = self.local.entry(path.to_string()).or_insert_with(|| (initial.clone(), initial.clone()));
        if entry.0 != initial {
            *entry = (initial.clone(), initial);
        }
        entry.1.clone()
    }

    fn render_children(&mut self, children: &[Node], path: &str, form: Option<&str>, colors: &ThemeColors, cx: &mut Context<Self>) -> Vec<AnyElement> {
        children.iter().enumerate().map(|(index, child)| self.render_node(child, &format!("{path}.{index}"), form, colors, cx)).collect()
    }

    fn field_label(label: Option<&String>, required: bool, colors: &ThemeColors) -> Option<AnyElement> {
        label.map(|label| {
            div()
                .text_size(typography::text_sm())
                .text_color(colors.subtle_foreground)
                .child(if required { format!("{label} *") } else { label.clone() })
                .into_any_element()
        })
    }

    fn required_error(&self, form: Option<&str>, name: Option<&String>, colors: &ThemeColors) -> Option<AnyElement> {
        let (form, name) = (form?, name?);
        let state = self.forms.get(form)?;
        if !state.attempted {
            return None;
        }
        let node = self.node.clone()?;
        let Node::Form { children, .. } = find(&node, "0", form)? else { return None };
        let missing = view::missing_form_fields(&view::collect_form_fields(children), &state.values);
        missing.contains(name).then(|| div().text_size(typography::text_sm()).text_color(colors.destructive).child("This field is required.").into_any_element())
    }

    fn render_node(&mut self, node: &Node, path: &str, form: Option<&str>, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let surface = self.surface;
        match node {
            Node::Screen { title, actions, children } => {
                let actions: Vec<AnyElement> = actions
                    .iter()
                    .flatten()
                    .enumerate()
                    .map(|(index, item)| {
                        let key = format!("{path}:action{index}");
                        let pending = self.pending.contains(&key);
                        let action = item.action.clone();
                        let button = match &item.icon {
                            Some(icon) => Button::icon(element_id(path, &format!("action{index}")), icon_for(icon)),
                            None => Button::new(element_id(path, &format!("action{index}")), item.label.clone()),
                        };
                        button
                            .size(ButtonSize::Small)
                            .variant(ButtonVariant::Ghost)
                            .tooltip(item.label.clone())
                            .disabled(pending)
                            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.execute(action.clone(), Vec::new(), Some(key.clone()), cx)))
                            .into_any_element()
                    })
                    .collect();
                let body = self.render_children(children, path, form, colors, cx);
                let header = (title.is_some() || !actions.is_empty()).then(|| {
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .justify_between()
                        .gap(px(8.))
                        .min_w_0()
                        .when(surface == Surface::Sidebar, |this| this.h(metrics::pane_header()).px(px(12.)).border_b_1().border_color(colors.divider))
                        .child(
                            div()
                                .min_w_0()
                                .truncate()
                                .text_size(if surface == Surface::Sidebar { typography::text_base() } else { typography::text_sm() })
                                .font_weight(typography::MEDIUM)
                                .text_color(colors.foreground)
                                .child(title.clone().unwrap_or_default()),
                        )
                        .child(div().flex().items_center().gap(px(2.)).children(actions))
                });
                if surface == Surface::Embedded {
                    return div().flex().flex_col().gap(px(8.)).min_w_0().children(header).child(div().flex().flex_col().gap(px(8.)).min_w_0().children(body)).into_any_element();
                }
                div()
                    .flex()
                    .flex_col()
                    .size_full()
                    .min_h_0()
                    .children(header)
                    .child(
                        div()
                            .id(element_id(path, "scroll"))
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                            .child(div().flex().flex_col().gap(px(8.)).p(px(8.)).children(body))
                            .scrollbar_with(&self.scroll),
                    )
                    .into_any_element()
            }
            Node::Stack { children } => div().flex().flex_col().gap(px(8.)).min_w_0().children(self.render_children(children, path, form, colors, cx)).into_any_element(),
            Node::Row { children } => div().flex().flex_wrap().items_center().gap(px(8.)).min_w_0().children(self.render_children(children, path, form, colors, cx)).into_any_element(),
            Node::List { children } => div().flex().flex_col().gap(px(2.)).min_w_0().children(self.render_children(children, path, form, colors, cx)).into_any_element(),
            Node::Section { title, children } => {
                let label: AnyElement = match surface {
                    Surface::Sidebar => SectionLabel::new(title.clone()).into_any_element(),
                    Surface::Embedded => div().mb(px(4.)).text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(colors.foreground).child(title.clone()).into_any_element(),
                };
                div().min_w_0().child(label).child(div().flex().flex_col().gap(px(2.)).children(self.render_children(children, path, form, colors, cx))).into_any_element()
            }
            Node::Card { title, description, variant, children } => {
                let mut card = Card::new().variant(if *variant == Some(ViewCardVariant::Outline) { CardVariant::Outline } else { CardVariant::Default });
                if *variant == Some(ViewCardVariant::Muted) {
                    card = card.plane(ui::CardPlane::Surface);
                }
                if let Some(title) = title {
                    let mut header = CardHeader::new(title.clone());
                    if let Some(description) = description {
                        header = header.description(description.clone());
                    }
                    card = card.child(header);
                } else if let Some(description) = description {
                    card = card.child(div().text_size(typography::text_sm()).text_color(colors.muted_foreground).child(description.clone()));
                }
                if !children.is_empty() {
                    card = card.child(card_content().flex().flex_col().gap(px(8.)).min_w_0().children(self.render_children(children, path, form, colors, cx)));
                }
                card.into_any_element()
            }
            Node::Form { submit_label, pending_label, disabled, children, .. } => {
                let fields = self.render_children(children, path, Some(path), colors, cx);
                let pending = self.pending.contains(path);
                let state = self.forms.get(path);
                let missing = state.is_some_and(|state| {
                    state.attempted && !view::missing_form_fields(&view::collect_form_fields(children), &state.values).is_empty()
                });
                let too_large = state.is_some_and(|state| state.too_large);
                let form_path = path.to_string();
                let label = if pending { pending_label.clone().unwrap_or_else(|| submit_label.clone()) } else { submit_label.clone() };
                div()
                    .flex()
                    .flex_col()
                    .gap(px(12.))
                    .min_w_0()
                    .child(div().flex().flex_col().gap(px(8.)).min_w_0().children(fields))
                    .when(missing, |this| this.child(div().text_size(typography::text_sm()).text_color(colors.destructive).child("Complete the required fields before continuing.")))
                    .when(too_large, |this| {
                        this.child(
                            div()
                                .text_size(typography::text_sm())
                                .text_color(colors.destructive)
                                .child(format!("Form values must be smaller than {}KB.", view::limits::MAX_FORM_PAYLOAD_CHARACTERS / 1000)),
                        )
                    })
                    .child(
                        div().flex().justify_end().child(
                            Button::new(element_id(path, "submit"), label)
                                .variant(ButtonVariant::Accent)
                                .size(ButtonSize::Small)
                                .disabled(disabled.unwrap_or(false) || pending)
                                .when(pending, |this| this.leading(Spinner::new(element_id(path, "spinner")).compact()))
                                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.submit_form(&form_path, cx))),
                        ),
                    )
                    .into_any_element()
            }
            Node::Text { value, tone } => div().text_size(typography::text_sm()).text_color(text_color(*tone, colors)).child(value.clone()).into_any_element(),
            Node::Badge { label, tone } => div().flex().child(Badge::new(label.clone()).tone(badge_tone(*tone))).into_any_element(),
            Node::Metric { label, value, detail, tone } => div().flex_1().flex_basis(px(96.)).min_w_0().child(Card::new()
                .child(
                    div()
                        .flex()
                        .items_end()
                        .justify_between()
                        .gap(px(8.))
                        .min_w_0()
                        .p(px(10.))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .child(div().truncate().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(label.clone()))
                                .child(div().truncate().text_size(typography::text_lg()).font_weight(typography::MEDIUM).text_color(metric_color(*tone, colors)).child(value.to_string())),
                        )
                        .children(detail.clone().map(|detail| div().flex_none().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(detail))),
                ))
                .into_any_element(),
            Node::Progress { value, label, detail } => {
                let mut progress = Progress::new(*value as f32).value_label(detail.clone().unwrap_or_else(|| format!("{}%", value.round())));
                if let Some(label) = label {
                    progress = progress.label(label.clone());
                }
                progress.into_any_element()
            }
            Node::Sparkline { label, values, detail, tone } => sparkline(label, values, detail.as_ref(), *tone, colors),
            Node::BarChart { label, items } => bar_chart(label.as_ref(), items, colors),
            Node::Callout { title, description, tone } => {
                let (tone, icon) = match tone {
                    Some(CalloutTone::Info) => (Tone::Info, IconName::Info),
                    Some(CalloutTone::Success) => (Tone::Success, IconName::CheckCircle),
                    Some(CalloutTone::Warning) => (Tone::Warning, IconName::Warning),
                    Some(CalloutTone::Error) => (Tone::Danger, IconName::WarningCircle),
                    _ => (Tone::Neutral, IconName::Info),
                };
                let mut alert = Alert::new().tone(tone).icon(icon).title(title.clone());
                if let Some(description) = description {
                    alert = alert.description(description.clone());
                }
                alert.into_any_element()
            }
            Node::Table { columns, rows, caption } => {
                let mut table = Table::new(columns.iter().map(|_| TableColumn::Flex(1.)).collect()).header(columns.clone());
                for (index, row) in rows.iter().enumerate() {
                    let mut table_row = TableRow::new(element_id(path, &format!("row{index}")));
                    for column in 0..columns.len() {
                        table_row = table_row.cell(div().truncate().child(row.get(column).map(ViewValue::to_string).unwrap_or_default()));
                    }
                    table = table.row(table_row);
                }
                if let Some(caption) = caption {
                    table = table.caption(caption.clone());
                }
                div().w_full().overflow_hidden().rounded(metrics::radius_lg()).border_1().border_color(colors.border).child(table).into_any_element()
            }
            Node::Code { value, wrap, .. } => div()
                .id(element_id(path, "code"))
                .max_w_full()
                .p(px(8.))
                .rounded(metrics::radius_lg())
                .bg(colors.surface)
                .font_family(typography::MONO_FONT)
                .text_size(typography::text_sm())
                .text_color(colors.foreground)
                .when(!wrap.unwrap_or(false), |this| this.overflow_x_scroll().whitespace_nowrap())
                .children(value.lines().map(|line| div().child(if line.is_empty() { " ".to_string() } else { line.to_string() })))
                .into_any_element(),
            Node::Diff { file_path, old_path, lines, truncated, .. } => diff_preview(file_path, old_path.as_ref(), lines, truncated.unwrap_or(false), colors),
            Node::Activity { items } => {
                let rows: Vec<AnyElement> = items
                    .iter()
                    .enumerate()
                    .map(|(index, item)| {
                        let (dot, icon) = match item.state {
                            Some(ActivityState::Running) => (colors.primary, IconName::CircleDotted),
                            Some(ActivityState::Success) => (colors.success, IconName::CheckCircle),
                            Some(ActivityState::Warning) => (colors.warning, IconName::Warning),
                            Some(ActivityState::Error) => (colors.destructive, IconName::WarningCircle),
                            _ => (colors.subtle_foreground, IconName::CircleDot),
                        };
                        let icon = item.icon.as_deref().map(icon_for).unwrap_or(icon);
                        let action = item.on_select.clone();
                        let hover = colors.accent;
                        div()
                            .id(element_id(path, &format!("activity{index}")))
                            .flex()
                            .items_start()
                            .gap(px(8.))
                            .px(px(6.))
                            .py(px(4.))
                            .rounded(metrics::radius_md())
                            .when(action.is_some(), |this| this.hover(move |style| style.bg(hover)))
                            .child(div().pt(px(1.)).child(Icon::new(icon).size(IconSize::Small).color(dot)))
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
                                            .gap(px(6.))
                                            .child(div().flex_1().min_w_0().truncate().text_size(typography::text_sm()).text_color(colors.foreground).child(item.title.clone()))
                                            .children(item.meta.clone().map(|meta| div().flex_none().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(meta))),
                                    )
                                    .children(item.description.clone().map(|text| div().text_size(typography::text_sm()).text_color(colors.muted_foreground).child(text))),
                            )
                            .when_some(action, |this, action| {
                                this.on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.execute(action.clone(), Vec::new(), None, cx)))
                            })
                            .into_any_element()
                    })
                    .collect();
                div().flex().flex_col().gap(px(2.)).children(rows).into_any_element()
            }
            Node::Button { label, pending_label, action, tone, disabled } => {
                let pending = self.pending.contains(path);
                let (variant, button_tone) = match tone {
                    Some(ViewButtonTone::Accent) => (ButtonVariant::Accent, ButtonTone::Default),
                    Some(ViewButtonTone::Ghost) => (ButtonVariant::Ghost, ButtonTone::Default),
                    Some(ViewButtonTone::Danger) => (ButtonVariant::Ghost, ButtonTone::Danger),
                    _ => (ButtonVariant::Default, ButtonTone::Default),
                };
                let label = if pending { pending_label.clone().unwrap_or_else(|| label.clone()) } else { label.clone() };
                let action = action.clone();
                let key = path.to_string();
                div()
                    .flex()
                    .child(
                        Button::new(element_id(path, "button"), label)
                            .variant(variant)
                            .tone(button_tone)
                            .size(ButtonSize::Small)
                            .disabled(disabled.unwrap_or(false) || pending)
                            .when(pending, |this| this.leading(Spinner::new(element_id(path, "spinner")).compact()))
                            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.execute(action.clone(), Vec::new(), Some(key.clone()), cx))),
                    )
                    .into_any_element()
            }
            Node::Input { field, label, .. } | Node::Textarea { field, label, .. } | Node::NumberInput { field, label, .. } | Node::Select { field, label, .. } => {
                let control: Option<AnyElement> = self.controls.get(path).map(|control| match &control.entity {
                    ControlEntity::Input(input) => div()
                        .flex()
                        .items_center()
                        .h(px(28.))
                        .px(px(8.))
                        .rounded(metrics::radius_md())
                        .bg(colors.field)
                        .border_1()
                        .border_color(colors.border)
                        .child(input.clone())
                        .into_any_element(),
                    ControlEntity::TextArea(area) => area.clone().into_any_element(),
                    ControlEntity::Number(number) => number.clone().into_any_element(),
                    ControlEntity::Select(select) => select.clone().into_any_element(),
                });
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .min_w_0()
                    .children(Self::field_label(label.as_ref(), field.required == Some(true), colors))
                    .children(control)
                    .children(self.required_error(form, field.name.as_ref(), colors))
                    .into_any_element()
            }
            Node::Toggle { field, label, description, checked, on_change, disabled } | Node::Checkbox { field, label, description, checked, on_change, disabled } => {
                let is_toggle = matches!(node, Node::Toggle { .. });
                let value = self.local_value(path, json!(checked)).as_bool().unwrap_or(*checked);
                let binding = Rc::new(Binding { form: form.map(str::to_string), name: field.name.clone(), on_change: on_change.clone(), on_submit: None });
                let this = cx.entity().downgrade();
                let key = path.to_string();
                let change = move |checked: bool, _: &mut Window, cx: &mut App| {
                    let (binding, key) = (binding.clone(), key.clone());
                    update(&this, cx, move |view, cx| {
                        if let Some(entry) = view.local.get_mut(&key) {
                            entry.1 = json!(checked);
                        }
                        view.bound(&binding, json!(checked), false, cx);
                    });
                };
                let disabled = disabled.unwrap_or(false);
                let control: AnyElement = if is_toggle {
                    Switch::new(element_id(path, "switch"), value).disabled(disabled).on_change(change).into_any_element()
                } else {
                    Checkbox::new(element_id(path, "checkbox"), value).disabled(disabled).on_change(change).into_any_element()
                };
                let text = div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .child(div().text_size(typography::text_sm()).text_color(colors.foreground).child(if field.required == Some(true) { format!("{label} *") } else { label.clone() }))
                    .children(description.clone().map(|text| div().text_size(typography::text_sm()).text_color(colors.muted_foreground).child(text)));
                let row = div().flex().items_start().gap(px(8.));
                let row = if is_toggle {
                    row.child(text).child(div().flex_none().child(control))
                } else {
                    row.child(div().pt(px(1.)).flex_none().child(control)).child(text)
                };
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(row)
                    .children(self.required_error(form, field.name.as_ref(), colors))
                    .into_any_element()
            }
            Node::Choice { field, label, description, multiple, value, options, on_change, disabled } => {
                let initial = match value {
                    ChoiceValue::One(value) => json!(value),
                    ChoiceValue::Many(values) => json!(values),
                };
                let current = self.local_value(path, initial);
                let toggle_options: Vec<ToggleOption> = options.iter().map(|option| ToggleOption::new(option.value.clone(), option.label.clone()).disabled(option.disabled == Some(true))).collect();
                let binding = Rc::new(Binding { form: form.map(str::to_string), name: field.name.clone(), on_change: on_change.clone(), on_submit: None });
                let this = cx.entity().downgrade();
                let key = path.to_string();
                let group = if *multiple {
                    let values: Vec<SharedString> = current.as_array().into_iter().flatten().filter_map(Value::as_str).map(|value| SharedString::from(value.to_string())).collect();
                    ToggleGroup::multiple(element_id(path, "choice"), toggle_options, values).on_change_multiple(move |values, _, cx| {
                        let value = json!(values.iter().map(|value| value.to_string()).collect::<Vec<_>>());
                        let (binding, key) = (binding.clone(), key.clone());
                        update(&this, cx, move |view, cx| {
                            if let Some(entry) = view.local.get_mut(&key) {
                                entry.1 = value.clone();
                            }
                            view.bound(&binding, value, false, cx);
                        });
                    })
                } else {
                    ToggleGroup::new(element_id(path, "choice"), toggle_options, current.as_str().unwrap_or_default().to_string()).on_change(move |value, _, cx| {
                        let value = json!(value.to_string());
                        let (binding, key) = (binding.clone(), key.clone());
                        update(&this, cx, move |view, cx| {
                            if let Some(entry) = view.local.get_mut(&key) {
                                entry.1 = value.clone();
                            }
                            view.bound(&binding, value, false, cx);
                        });
                    })
                };
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .children(Self::field_label(label.as_ref(), field.required == Some(true), colors))
                    .children(description.clone().map(|text| div().text_size(typography::text_sm()).text_color(colors.muted_foreground).child(text)))
                    .child(div().flex().child(group.disabled(disabled.unwrap_or(false))))
                    .children(self.required_error(form, field.name.as_ref(), colors))
                    .into_any_element()
            }
            Node::Tabs { value, tabs, on_change } => {
                let first = tabs.iter().find(|tab| tab.disabled != Some(true)).map(|tab| tab.value.clone()).unwrap_or_default();
                let selected = self.local_value(path, json!(value.clone().filter(|value| !value.is_empty()).unwrap_or(first))).as_str().unwrap_or_default().to_string();
                let triggers = tabs.iter().map(|tab| TabsTrigger::new(tab.value.clone(), tab.label.clone()).disabled(tab.disabled == Some(true))).collect();
                let active = tabs.iter().position(|tab| tab.value == selected);
                let panel = active.map(|index| {
                    let tab_path = format!("{path}.t{index}");
                    self.render_children(&tabs[index].children, &tab_path, form, colors, cx)
                });
                let this = cx.entity().downgrade();
                let key = path.to_string();
                let on_change = on_change.clone();
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .min_w_0()
                    .child(Tabs::new(element_id(path, "tabs"), triggers, selected).on_change(move |value, _, cx| {
                        let value = value.to_string();
                        let (key, on_change) = (key.clone(), on_change.clone());
                        update(&this, cx, move |view, cx| {
                            if let Some(entry) = view.local.get_mut(&key) {
                                entry.1 = json!(value);
                            }
                            if let Some(action) = on_change {
                                view.execute(action, vec![json!(value)], None, cx);
                            }
                            cx.notify();
                        });
                    }))
                    .child(div().flex().flex_col().gap(px(8.)).min_w_0().children(panel.into_iter().flatten()))
                    .into_any_element()
            }
            Node::Disclosure { title, description, open, children, on_change } => {
                let is_open = self.local_value(path, json!(open.unwrap_or(false))).as_bool().unwrap_or(false);
                let body = if is_open { self.render_children(children, path, form, colors, cx) } else { Vec::new() };
                let this = cx.entity().downgrade();
                let key = path.to_string();
                let on_change = on_change.clone();
                let label = div()
                    .flex()
                    .flex_col()
                    .min_w_0()
                    .child(div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(colors.foreground).child(title.clone()))
                    .children(description.clone().map(|text| div().text_size(typography::text_sm()).text_color(colors.muted_foreground).child(text)));
                AccordionItem::new(element_id(path, "disclosure"), label)
                    .open(is_open)
                    .on_toggle(move |open, _, cx| {
                        let (key, on_change) = (key.clone(), on_change.clone());
                        update(&this, cx, move |view, cx| {
                            if let Some(entry) = view.local.get_mut(&key) {
                                entry.1 = json!(open);
                            }
                            if let Some(action) = on_change {
                                view.execute(action, vec![json!(open)], None, cx);
                            }
                            cx.notify();
                        });
                    })
                    .children(body)
                    .into_any_element()
            }
            Node::KeyValue { items } => div()
                .flex()
                .flex_col()
                .gap(px(4.))
                .min_w_0()
                .text_size(typography::text_sm())
                .children(items.iter().map(|item| {
                    div()
                        .flex()
                        .gap(px(12.))
                        .min_w_0()
                        .child(div().w(px(84.)).flex_none().truncate().text_color(colors.subtle_foreground).child(item.label.clone()))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .text_color(metric_color(item.tone, colors))
                                .when(item.monospace == Some(true), |this| this.font_family(typography::MONO_FONT))
                                .child(item.value.to_string()),
                        )
                }))
                .into_any_element(),
            Node::Tree { items, .. } => {
                let mut rows = Vec::new();
                self.tree_rows(items, path, 0, &mut rows, colors, cx);
                div().flex().flex_col().min_w_0().children(rows).into_any_element()
            }
            Node::ListItem { title, description, meta, badges, on_select } => {
                let trailing = (meta.is_some() || badges.as_ref().is_some_and(|badges| !badges.is_empty())).then(|| {
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.))
                        .text_size(typography::text_caption())
                        .text_color(colors.subtle_foreground)
                        .children(badges.iter().flatten().map(|badge| Badge::new(badge.label.clone()).tone(badge_tone(badge.tone))))
                        .children(meta.clone())
                });
                let action = on_select.clone();
                match surface {
                    Surface::Embedded => {
                        let mut item = Item::new(element_id(path, "item")).variant(ItemVariant::Muted).title(title.clone());
                        if let Some(description) = description {
                            item = item.description(description.clone());
                        }
                        if let Some(trailing) = trailing {
                            item = item.action(trailing);
                        }
                        if let Some(action) = action {
                            item = item.on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.execute(action.clone(), Vec::new(), None, cx)));
                        }
                        item.into_any_element()
                    }
                    Surface::Sidebar => {
                        let mut item = SidebarListItem::new(element_id(path, "item"), title.clone()).in_content();
                        if let Some(description) = description {
                            item = item.description(description.clone());
                        }
                        if let Some(trailing) = trailing {
                            item = item.trailing(trailing);
                        }
                        if let Some(action) = action {
                            item = item.on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.execute(action.clone(), Vec::new(), None, cx)));
                        }
                        item.into_any_element()
                    }
                }
            }
            Node::Empty { message, description } => state_panel(EmptyState::new(message.clone()).icon(IconName::Package), description.as_ref()),
            Node::Loading { message } => div()
                .flex()
                .justify_center()
                .py(px(16.))
                .child(Spinner::new(element_id(path, "loading")).label(message.clone().unwrap_or_else(|| "Loading".into())).show_label().compact())
                .into_any_element(),
            Node::Error { message, description } => state_panel(EmptyState::new(message.clone()).icon(IconName::WarningCircle), description.as_ref()),
            Node::Divider => div().h(px(1.)).w_full().bg(colors.divider).into_any_element(),
        }
    }

    fn tree_rows(&mut self, items: &[TreeItem], path: &str, depth: usize, rows: &mut Vec<AnyElement>, colors: &ThemeColors, cx: &mut Context<Self>) {
        for item in items {
            let key = format!("{path}#{}", item.id);
            let has_children = item.children.as_ref().is_some_and(|children| !children.is_empty());
            let expanded = self.local_value(&key, json!(item.expanded.unwrap_or(false))).as_bool().unwrap_or(false);
            let action = item.on_select.clone();
            let toggle_key = key.clone();
            let hover = colors.accent;
            rows.push(
                div()
                    .id(SharedString::from(format!("extension-tree-{key}")))
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .h(metrics::list_row())
                    .pl(px(4. + depth as f32 * 14.))
                    .pr(px(6.))
                    .rounded(metrics::radius_md())
                    .hover(move |style| style.bg(hover))
                    .child(div().w(px(14.)).flex_none().when(has_children, |this| {
                        this.child(Icon::new(if expanded { IconName::ChevronDown } else { IconName::ChevronRight }).size(IconSize::XSmall).color(colors.subtle_foreground))
                    }))
                    .children(item.icon.as_deref().map(|icon| Icon::new(icon_for(icon)).size(IconSize::Small).color(colors.muted_foreground)))
                    .child(div().flex_1().min_w_0().truncate().text_size(typography::text_sm()).text_color(colors.foreground).child(item.title.clone()))
                    .children(item.badges.iter().flatten().map(|badge| Badge::new(badge.label.clone()).tone(badge_tone(badge.tone))))
                    .children(item.meta.clone().map(|meta| div().flex_none().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(meta)))
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                        if has_children && let Some(entry) = this.local.get_mut(&toggle_key) {
                            entry.1 = json!(!expanded);
                        }
                        if let Some(action) = action.clone() {
                            this.execute(action, Vec::new(), None, cx);
                        }
                        cx.notify();
                    }))
                    .into_any_element(),
            );
            if has_children && expanded {
                self.tree_rows(item.children.as_deref().unwrap_or_default(), path, depth + 1, rows, colors, cx);
            }
        }
    }
}

fn update(view: &WeakEntity<ExtensionView>, cx: &mut App, change: impl FnOnce(&mut ExtensionView, &mut Context<ExtensionView>)) {
    view.update(cx, change).ok();
}

fn state_panel(state: EmptyState, description: Option<&String>) -> AnyElement {
    let state = match description {
        Some(description) => state.message(description.clone()),
        None => state,
    };
    div().flex().justify_center().py(px(16.)).child(state).into_any_element()
}

fn sparkline(label: &str, values: &[f64], detail: Option<&String>, tone: Option<ViewTone>, colors: &ThemeColors) -> AnyElement {
    let color = match tone {
        None | Some(ViewTone::Default) => colors.primary,
        tone => metric_color(tone, colors),
    };
    let points = values.to_vec();
    let (min, max) = points.iter().fold((f64::MAX, f64::MIN), |(min, max), value| (min.min(*value), max.max(*value)));
    let range = if max > min { max - min } else { 1. };
    div()
        .flex()
        .flex_col()
        .gap(px(4.))
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .text_size(typography::text_sm())
                .child(div().text_color(colors.subtle_foreground).child(label.to_string()))
                .children(detail.map(|detail| div().text_color(colors.foreground).child(detail.clone()))),
        )
        .child(
            canvas(
                |_, _, _| {},
                move |bounds, _, window, _| {
                    let count = points.len().max(2) - 1;
                    let at = |index: usize, value: f64| {
                        let x = bounds.origin.x + bounds.size.width * (index as f32 / count as f32);
                        let y = bounds.origin.y + px(2.) + (bounds.size.height - px(4.)) * (1. - ((value - min) / range) as f32);
                        point(x, y)
                    };
                    let mut line = PathBuilder::stroke(px(1.5));
                    for (index, value) in points.iter().enumerate() {
                        if index == 0 {
                            line.move_to(at(index, *value));
                        } else {
                            line.line_to(at(index, *value));
                        }
                    }
                    if let Ok(path) = line.build() {
                        window.paint_path(path, color);
                    }
                },
            )
            .w_full()
            .h(px(32.)),
        )
        .into_any_element()
}

fn bar_chart(label: Option<&String>, items: &[BarItem], colors: &ThemeColors) -> AnyElement {
    let max = items.iter().map(|item| item.value).fold(0., f64::max);
    div()
        .flex()
        .flex_col()
        .gap(px(6.))
        .text_size(typography::text_sm())
        .children(label.map(|label| div().text_color(colors.subtle_foreground).child(label.clone())))
        .children(items.iter().map(|item| {
            let fraction = if max > 0. { (item.value / max) as f32 } else { 0. };
            let color = match item.tone {
                None | Some(ViewTone::Default) => colors.primary,
                tone => metric_color(tone, colors),
            };
            div()
                .flex()
                .flex_col()
                .gap(px(2.))
                .child(
                    div()
                        .flex()
                        .justify_between()
                        .gap(px(8.))
                        .child(div().truncate().text_color(colors.foreground).child(item.label.clone()))
                        .child(div().flex_none().text_color(colors.subtle_foreground).child(item.detail.clone().unwrap_or_else(|| view::format_number(item.value)))),
                )
                .child(div().h(px(6.)).w_full().rounded_full().bg(colors.accent).child(div().h_full().w(relative(fraction)).rounded_full().bg(color)))
        }))
        .into_any_element()
}

fn diff_preview(file_path: &str, old_path: Option<&String>, lines: &[DiffLine], truncated: bool, colors: &ThemeColors) -> AnyElement {
    let title = match old_path {
        Some(old) if old != file_path => format!("{old} → {file_path}"),
        _ => file_path.to_string(),
    };
    let added = lines.iter().filter(|line| line.kind == DiffLineType::Added).count();
    let removed = lines.iter().filter(|line| line.kind == DiffLineType::Removed).count();
    let number = |value: Option<u32>| div().w(px(32.)).flex_none().text_right().pr(px(6.)).text_color(colors.subtle_foreground).child(value.map(|n| n.to_string()).unwrap_or_default());
    div()
        .flex()
        .flex_col()
        .min_w_0()
        .overflow_hidden()
        .rounded(metrics::radius_lg())
        .border_1()
        .border_color(colors.border)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .px(px(8.))
                .py(px(6.))
                .bg(colors.surface)
                .text_size(typography::text_sm())
                .child(div().flex_1().min_w_0().truncate().text_color(colors.foreground).child(title))
                .child(div().text_color(colors.git_added).child(format!("+{added}")))
                .child(div().text_color(colors.git_deleted).child(format!("-{removed}"))),
        )
        .children(lines.iter().map(|line| {
            let (bg, fg, sign) = match line.kind {
                DiffLineType::Added => (colors.success_soft, colors.foreground, "+"),
                DiffLineType::Removed => (colors.destructive_soft, colors.foreground, "-"),
                DiffLineType::Header => (colors.info_soft, colors.info, ""),
                DiffLineType::Context => (gpui::transparent_black(), colors.muted_foreground, " "),
            };
            div()
                .flex()
                .bg(bg)
                .font_family(typography::MONO_FONT)
                .text_size(typography::text_caption())
                .child(number(line.old_line))
                .child(number(line.new_line))
                .child(div().w(px(12.)).flex_none().text_color(fg).child(sign))
                .child(div().flex_1().min_w_0().whitespace_nowrap().overflow_hidden().text_color(fg).child(line.content.clone()))
        }))
        .when(truncated, |this| this.child(div().px(px(8.)).py(px(4.)).text_size(typography::text_caption()).text_color(colors.subtle_foreground).child("Diff truncated")))
        .into_any_element()
}

fn control_value(node: &Node) -> Value {
    match node {
        Node::Input { value, .. } | Node::Textarea { value, .. } | Node::Select { value, .. } => json!(value),
        Node::NumberInput { value, min, max, step, .. } => json!([value, min, max, step]),
        _ => Value::Null,
    }
}

fn collect_controls(node: &Node, path: String, form: Option<String>, out: &mut Vec<(String, Node, Option<String>)>) {
    match node {
        Node::Input { .. } | Node::Textarea { .. } | Node::NumberInput { .. } | Node::Select { .. } => out.push((path, node.clone(), form)),
        Node::Form { children, .. } => {
            for (index, child) in children.iter().enumerate() {
                collect_controls(child, format!("{path}.{index}"), Some(path.clone()), out);
            }
        }
        Node::Tabs { tabs, .. } => {
            for (tab_index, tab) in tabs.iter().enumerate() {
                for (index, child) in tab.children.iter().enumerate() {
                    collect_controls(child, format!("{path}.t{tab_index}.{index}"), form.clone(), out);
                }
            }
        }
        Node::Screen { children, .. }
        | Node::Stack { children }
        | Node::Row { children }
        | Node::List { children }
        | Node::Section { children, .. }
        | Node::Card { children, .. }
        | Node::Disclosure { children, .. } => {
            for (index, child) in children.iter().enumerate() {
                collect_controls(child, format!("{path}.{index}"), form.clone(), out);
            }
        }
        _ => {}
    }
}

fn collect_forms(node: &Node, path: &str, out: &mut HashMap<String, Map<String, Value>>) {
    if let Node::Form { children, .. } = node {
        out.insert(path.to_string(), view::initial_form_values(&view::collect_form_fields(children)));
        return;
    }
    match node {
        Node::Tabs { tabs, .. } => {
            for (tab_index, tab) in tabs.iter().enumerate() {
                for (index, child) in tab.children.iter().enumerate() {
                    collect_forms(child, &format!("{path}.t{tab_index}.{index}"), out);
                }
            }
        }
        _ => {
            for (index, child) in direct_children(node).iter().enumerate() {
                collect_forms(child, &format!("{path}.{index}"), out);
            }
        }
    }
}

fn direct_children(node: &Node) -> &[Node] {
    match node {
        Node::Screen { children, .. }
        | Node::Stack { children }
        | Node::Row { children }
        | Node::List { children }
        | Node::Section { children, .. }
        | Node::Card { children, .. }
        | Node::Form { children, .. }
        | Node::Disclosure { children, .. } => children,
        _ => &[],
    }
}

/// The node at `target`, a path the renderer gave it.
fn find<'a>(node: &'a Node, path: &str, target: &str) -> Option<&'a Node> {
    if path == target {
        return Some(node);
    }
    if !target.starts_with(&format!("{path}.")) {
        return None;
    }
    if let Node::Tabs { tabs, .. } = node {
        for (tab_index, tab) in tabs.iter().enumerate() {
            for (index, child) in tab.children.iter().enumerate() {
                if let Some(found) = find(child, &format!("{path}.t{tab_index}.{index}"), target) {
                    return Some(found);
                }
            }
        }
        return None;
    }
    direct_children(node).iter().enumerate().find_map(|(index, child)| find(child, &format!("{path}.{index}"), target))
}

/// `useProFeature().hasIntelligence`.
fn has_intelligence(cx: &App) -> bool {
    account::AccountStore::global(cx).is_some_and(|store| {
        let store = store.read(cx);
        account::gates::ProFeatures::resolve(store.user(), store.subscription()).intelligence
    })
}

/// `pro-gate.tsx`: a lock in a soft primary circle, "Pro Feature" with the Pro badge, and the
/// upgrade line.
fn pro_gate(colors: &theme::ThemeColors) -> gpui::Div {
    div()
        .flex()
        .flex_col()
        .items_center()
        .gap(px(8.))
        .p(px(12.))
        .text_center()
        .child(
            div()
                .mb(px(4.))
                .size(px(40.))
                .flex()
                .items_center()
                .justify_center()
                .rounded_full()
                .bg(colors.primary_soft)
                .child(Icon::new(IconName::Lock).size(IconSize::Custom(px(20.))).color(colors.primary)),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .text_size(typography::text_base())
                .font_weight(typography::MEDIUM)
                .child("Pro Feature")
                .child(ui::Badge::new("Pro").tone(Tone::Accent)),
        )
        .child(div().text_size(typography::text_sm()).text_color(colors.muted_foreground).child("Upgrade to Pro to unlock this feature."))
}

impl Render for ExtensionView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let sidebar = self.surface == Surface::Sidebar;
        let base = div().flex().flex_col().min_w_0().when(sidebar, |this| this.size_full()).font_family(typography::ui_font()).text_color(colors.foreground);
        // `ProGate`: generated views are a Pro feature.
        if matches!(self.source, Source::Generative) && !has_intelligence(cx) {
            return base.child(pro_gate(&colors));
        }
        if let Some(error) = self.error.clone() {
            let title = if matches!(self.source, Source::Generative) { "Generated UI unavailable" } else { "Integration error" };
            return match self.source {
                Source::Generative => base.child(Alert::new().tone(Tone::Danger).icon(IconName::WarningCircle).title(title).description(error)),
                Source::Extension { .. } => base.justify_center().child(state_panel(EmptyState::new(title).icon(IconName::WarningCircle), Some(&error.to_string()))),
            };
        }
        let Some(node) = self.node.clone() else {
            return base.justify_center().child(div().flex().justify_center().py(px(16.)).child(Spinner::new("extension-view-loading").label("Loading integration").show_label().compact()));
        };
        self.sync_controls(window, cx);
        let content = self.render_node(&node, "0", None, &colors, cx);
        base.children(self.action_error.clone().map(|error| Alert::new().tone(Tone::Danger).icon(IconName::WarningCircle).title("Generated UI unavailable").description(error))).child(content)
    }
}
