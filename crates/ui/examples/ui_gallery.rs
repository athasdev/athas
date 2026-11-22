//! Renders the shared controls to a PNG with the GPU but without a window, to compare them with
//! `src/ui` in the web workbench.
//!
//! `cargo run -p ui --example ui_gallery -- out.png [dark|light] [page]`
//! Pages: `controls` (default), `overlays`, `primitives`, `states` (each control at rest, hovered,
//! active and disabled, the focused input, a highlighted menu row and an open tooltip).

use std::sync::Arc;

use anyhow::{Context as _, Result};
use gpui::{AppContext, Context, Entity, Focusable, HeadlessAppContext, IntoElement, Render, SharedString, Window, div, prelude::*, px, size};
use theme::{ActiveTheme, Appearance};
use ui::*;

struct Gallery {
    page: String,
    input: Entity<TextInput>,
    input_focused: Entity<TextInput>,
    text_area: Entity<TextArea>,
    select_ghost: Entity<Select>,
    select_surface: Entity<Select>,
    select_open: Entity<Select>,
    combobox: Entity<Select>,
    number: Entity<NumberInput>,
    menu: Entity<Menu>,
    dropdown: Entity<DropdownMenu>,
    alert: Entity<AlertDialog>,
    questionnaire: Entity<Questionnaire>,
}

fn options() -> Vec<SelectOption> {
    vec![
        SelectOption::new("system", "System").icon(IconName::Monitor),
        SelectOption::new("light", "Light").icon(IconName::Sun),
        SelectOption::new("dark", "Dark").icon(IconName::Moon),
        SelectOption::new("contrast", "High contrast").icon(IconName::Eye).disabled(true),
    ]
}

impl Gallery {
    fn new(page: String, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = cx.new(|cx| TextInput::new(window, cx).placeholder("Search files"));
        let input_focused = cx.new(|cx| TextInput::new(window, cx).placeholder("Focused"));
        let text_area = cx.new(|cx| {
            let mut area = TextArea::new(cx).auto_size(3, 6).placeholder("Commit message");
            area.set_text("Port the shared primitives\n\nDialogs, selects, menus and form fields now match src/ui.", cx);
            area
        });
        let select_ghost = cx.new(|cx| Select::new(options(), "dark", cx));
        let select_surface = cx.new(|cx| Select::new(options(), "light", cx).variant(SelectVariant::Surface).width(SelectWidth::Full));
        let select_open = cx.new(|cx| {
            Select::new(options(), "dark", cx).variant(SelectVariant::Surface).width(SelectWidth::Full).searchable(SelectSearch::Menu, window, cx)
        });
        let combobox = cx.new(|cx| {
            Select::combobox(
                vec![
                    SelectOption::new("main", "main").icon(IconName::GitBranch),
                    SelectOption::new("dev", "dev").icon(IconName::GitBranch),
                    SelectOption::new("release", "release/0.16").icon(IconName::GitBranch),
                ],
                "main",
                window,
                cx,
            )
            .placeholder("Branch")
        });
        let number = cx.new(|cx| NumberInput::new(14., window, cx).range(Some(8.), Some(32.), cx));
        let menu = Menu::build_sized(
            vec![
                MenuEntry::Label("File".into()),
                MenuEntry::Text("Actions for the selected file".into()),
                MenuItem::new("Open").icon(IconName::FolderOpen).shortcut("⌘O").into(),
                MenuItem::new("Copy path").icon(IconName::Copy).shortcut("⌥⌘C").into(),
                MenuItem::new("Reveal in Finder").icon(IconName::OpenExternal).into(),
                MenuEntry::Separator,
                MenuItem::new("Sort by")
                    .value("Name")
                    .submenu(vec![
                        MenuItem::new("Name").checked(true).into(),
                        MenuItem::new("Date modified").checked(false).into(),
                        MenuItem::new("Kind").checked(false).into(),
                    ])
                    .into(),
                MenuItem::new("Show hidden files").checked(true).into(),
                MenuItem::new("Rename").trailing_text("F2").into(),
                MenuItem::new("Disabled action").disabled(true).into(),
                MenuEntry::Separator,
                MenuItem::new("Move to Trash").destructive().into(),
            ],
            MenuSize::Default,
            window,
            cx,
        );
        let dropdown = cx.new(|_| {
            DropdownMenu::new(
                |open, _, _| Button::icon("more", IconName::Dots).active(open).into_any_element(),
                |_, _| vec![MenuItem::new("Pin").icon(IconName::Pin).into(), MenuItem::new("Archive").icon(IconName::Archive).into()],
            )
        });
        let alert = AlertDialog::confirm(
            "Discard changes?",
            "Your edits to settings.json will be lost. This cannot be undone.",
            ConfirmOptions { confirm_label: "Discard".into(), destructive: true, ..Default::default() },
            |_, _| {},
            cx,
        );
        let questionnaire = cx.new(|cx| {
            let mut questionnaire = Questionnaire::new(
                vec![
                    QuestionnaireQuestion::new("scope", "Which files should the agent touch?")
                        .description("It asks before editing anything outside them.")
                        .choice(QuestionnaireChoice::new("open", "Open files").description("The tabs in this window"))
                        .choice(QuestionnaireChoice::new("changed", "Changed files"))
                        .choice(QuestionnaireChoice::new("all", "The whole project"))
                        .required(),
                    QuestionnaireQuestion::new("note", "Anything else?").input("Add a note"),
                ],
                window,
                cx,
            );
            questionnaire.choose("changed".into(), cx);
            questionnaire
        });
        Self { page, input, input_focused, text_area, select_ghost, select_surface, select_open, combobox, number, menu, dropdown, alert, questionnaire }
    }

    fn controls(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let column = || div().flex().flex_col().gap(px(16.)).w(px(420.));
        let caption = |text: &'static str| div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(text);
        div()
            .flex()
            .gap(px(24.))
            .child(
                column()
                    .child(caption("Buttons, badges, toggles"))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(8.))
                            .child(Button::new("b1", "Default"))
                            .child(Button::new("b2", "Accent").variant(ButtonVariant::Accent))
                            .child(Button::new("b3", "Delete").variant(ButtonVariant::Destructive))
                            .child(Button::new("b4", "Outline").variant(ButtonVariant::Outline))
                            .child(Button::new("b5", "Ghost").variant(ButtonVariant::Ghost))
                            .child(self.dropdown.clone()),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .gap(px(6.))
                            .child(Badge::new("12"))
                            .child(Badge::new("Pro").tone(Tone::Accent))
                            .child(Badge::new("Passing").tone(Tone::Success).icon(IconName::Check))
                            .child(Badge::new("Draft").tone(Tone::Warning))
                            .child(Badge::new("Failed").tone(Tone::Danger))
                            .child(Badge::new("Merged").tone(Tone::Merged))
                            .child(Badge::new("bug").label_color(gpui::rgb(0xd73a4a).into()))
                            .child(StatusDot::live())
                            .child(StatusDot::unread()),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.))
                            .child(ToggleGroup::new(
                                "tg",
                                vec![ToggleOption::new("files", "Files"), ToggleOption::new("changes", "Changes"), ToggleOption::new("history", "History")],
                                "changes",
                            ))
                            .child(ToggleGroup::new(
                                "tg-icons",
                                vec![
                                    ToggleOption::new("list", "List").icon(IconName::List),
                                    ToggleOption::new("grid", "Grid").icon(IconName::Grid),
                                ],
                                "grid",
                            )
                            .icon_only()),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(16.))
                            .child(Checkbox::new("c1", true).label("Stage all"))
                            .child(Checkbox::new("c2", false).label("Amend"))
                            .child(Checkbox::new("c3", true).size(CheckboxSize::Sm))
                            .child(Checkbox::new("c4", false).size(CheckboxSize::Sm))
                            .child(Switch::new("s1", true))
                            .child(Switch::new("s2", false)),
                    )
                    .child(caption("Fields"))
                    .child(Field::new().label("Search").description("Matches file names and paths.").control(self.input.clone()))
                    .child(Field::new().label("Font size").description("Pixels, between 8 and 32.").horizontal().control(div().w(px(140.)).child(self.number.clone())))
                    .child(Field::new().label("Theme").horizontal().control(self.select_ghost.clone()))
                    .child(Field::new().label("Appearance").control(self.select_surface.clone()))
                    .child(Field::new().label("Branch").control(self.combobox.clone()))
                    .child(Field::new().label("Message").control(self.text_area.clone()).error(Some("A summary line is required.")))
                    .child(
                        InputGroup::new(div().text_color(colors.subtle_foreground).child("athas.dev"))
                            .start(input_group_text("https://", cx))
                            .end(Button::icon("ig-copy", IconName::Copy).size(ButtonSize::XSmall)),
                    )
                    .child(FieldSeparator::new(Some("or".into()))),
            )
            .child(
                column()
                    .child(caption("Progress and steps"))
                    .child(Progress::new(42.).label("Indexing").show_percent())
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.))
                            .child(div().flex_1().child(Progress::new(80.).tone(ProgressTone::Warning)))
                            .child(ProgressCircle::new(30.))
                            .child(ProgressCircle::new(75.).tone(ProgressTone::Warning))
                            .child(ProgressCircle::new(100.)),
                    )
                    .child(
                        StepSlider::new(
                            "effort",
                            "Reasoning effort",
                            vec![
                                StepSliderStep::new("low", "Low"),
                                StepSliderStep::new("medium", "Medium"),
                                StepSliderStep::new("high", "High"),
                                StepSliderStep::new("max", "Max"),
                            ],
                            "high",
                        )
                        .auto_step(StepSliderStep::new("auto", "Auto"))
                        .marked("high", "default"),
                    )
                    .child(caption("Alerts and markers"))
                    .child(Alert::new().tone(Tone::Info).icon(IconName::Info).title("Update ready").description("Restart Athas to finish installing 0.16.0."))
                    .child(
                        Alert::new()
                            .tone(Tone::Danger)
                            .icon(IconName::WarningCircle)
                            .title("Push failed")
                            .description("The remote rejected the update.")
                            .action(Button::new("retry", "Retry").size(ButtonSize::Small)),
                    )
                    .child(Marker::new("Today").variant(MarkerVariant::Separator))
                    .child(Marker::new("Context compacted").icon(IconName::Archive))
                    .child(caption("Breadcrumbs"))
                    .child(PathBreadcrumb::from_path("path", "athas-gpui/crates/ui/src/select.rs").on_segment_click(|_, _, _, _| {}))
                    .child(Breadcrumb::new("crumbs").item("Settings", |_, _, _| {}).item("Editor", |_, _, _| {}).page("Font"))
                    .child(caption("Grouped section and items"))
                    .child(
                        GroupedSection::new("Integrations")
                            .action(Button::new("gs-add", "Add").size(ButtonSize::Small))
                            .child(
                                Item::new("i1")
                                    .variant(ItemVariant::List)
                                    .size(ItemSize::Comfortable)
                                    .media(ItemMedia::Tile(Icon::new(IconName::Github).size(IconSize::Custom(px(20.))).into_any_element()))
                                    .title("GitHub")
                                    .title_trailing(Badge::new("Connected").tone(Tone::Success))
                                    .description("Pull requests, issues and checks.")
                                    .action(Switch::new("i1s", true)),
                            )
                            .child(
                                Item::new("i2")
                                    .variant(ItemVariant::List)
                                    .media(ItemMedia::Icon(IconName::Cube))
                                    .title("Docker")
                                    .description("3 containers running")
                                    .action(Button::new("i2b", "Open").size(ButtonSize::Small)),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .gap(px(8.))
                            .child(Attachment::new("a1", "screenshot.png").description("240 KB").icon(IconName::Image))
                            .child(Attachment::new("a2", "notes.md").description("Upload failed").icon(IconName::FileText).state(AttachmentState::Error)),
                    ),
            )
            .child(
                column()
                    .w(px(360.))
                    .child(caption("Cards"))
                    .child(
                        Card::new()
                            .child(CardHeader::new("Usage").description("Resets on the 1st.").action(Badge::new("Pro").tone(Tone::Accent)))
                            .child(card_content().child(Progress::new(64.).show_percent()))
                            .child(card_footer(cx).child(Button::new("cf", "Manage").size(ButtonSize::Small))),
                    )
                    .child(Card::new().variant(CardVariant::Outline).layout(CardLayout::Compact).child("An outlined, compact card."))
                    .child(caption("Popover"))
                    .child(
                        Popover::new()
                            .child(PopoverHeader::new("Share session").description("Anyone on the team can open it."))
                            .child(Button::new("pop", "Copy link").variant(ButtonVariant::Accent).full_width()),
                    )
                    .child(caption("Message"))
                    .child(
                        Message::new()
                            .leading(Avatar::new("Mehmet Ozgul"))
                            .footer([message_action("m-copy", IconName::Copy, "Copy"), message_action("m-retry", IconName::ArrowClockwise, "Retry")])
                            .child("The dialogs now wear the 12px radius and the dialog shadow, as in the web app."),
                    )
                    .child(caption("Scroll area"))
                    .child(
                        div().h(px(96.)).flex().flex_col().rounded(metrics::radius_lg()).bg(colors.surface).child(
                            ScrollArea::new("scroll").children((1..=12).map(|line| div().px(px(10.)).py(px(4.)).text_size(typography::text_sm()).child(format!("Line {line}")))),
                        ),
                    ),
            )
    }

    fn overlays(&self, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .gap(px(24.))
            .items_start()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(24.))
                    .w(px(448.))
                    .child(
                        Dialog::new("dialog", "Rename branch")
                            .icon(IconName::GitBranch)
                            .size(DialogSize::Md)
                            .layout(DialogLayout::Form)
                            .footer([
                                Button::new("d-cancel", "Cancel").into_any_element(),
                                Button::new("d-ok", "Rename").variant(ButtonVariant::Accent).into_any_element(),
                            ])
                            .child(Field::new().label("New name").control(self.input.clone()))
                            .child(Checkbox::new("d-push", true).label("Push to origin")),
                    )
                    .child(self.alert.clone()),
            )
            .child(div().flex().flex_col().gap(px(8.)).w(px(260.)).child(self.select_open.clone()).child(div().h(px(260.))))
            .child(div().w(px(420.)).child(self.menu.clone()))
    }
}

impl Gallery {
    fn primitives(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let column = || div().flex().flex_col().gap(px(16.)).w(px(400.));
        let caption = |text: &'static str| div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(text);
        let swatch = |background: gpui::Hsla, foreground: gpui::Hsla| {
            div().size_full().flex().items_center().justify_center().bg(background).child(div().w(px(40.)).h(px(6.)).rounded_full().bg(foreground))
        };
        let tabs = |variant| {
            Tabs::new(
                SharedString::from(format!("tabs-{variant:?}")),
                vec![TabsTrigger::new("general", "General"), TabsTrigger::new("editor", "Editor").icon(IconName::Code), TabsTrigger::new("ai", "AI").disabled(true)],
                "editor",
            )
            .variant(variant)
        };
        div()
            .flex()
            .gap(px(24.))
            .child(
                column()
                    .child(caption("Accordion"))
                    .child(
                        Accordion::new()
                            .gap(px(4.))
                            .child(
                                AccordionItem::new("acc-errors", div().flex().items_center().gap(px(6.)).child(Icon::new(IconName::WarningCircle).size(IconSize::XSmall).color(colors.destructive)).child("Errors").child(Badge::new("2")))
                                    .open(true)
                                    .action(Button::icon("acc-more", IconName::Dots).size(ButtonSize::XSmall))
                                    .child(div().px(px(8.)).text_color(colors.muted_foreground).child("mismatched types"))
                                    .child(div().px(px(8.)).text_color(colors.muted_foreground).child("cannot borrow `cx` twice")),
                            )
                            .child(AccordionItem::new("acc-warnings", "Warnings").child("hidden"))
                            .child(AccordionItem::new("acc-disabled", "Info").disabled(true)),
                    )
                    .child(caption("Collapsible"))
                    .child(
                        Collapsible::new("collapsible")
                            .open(true)
                            .trigger(div().flex().items_center().gap(px(4.)).text_color(colors.muted_foreground).child(Icon::new(IconName::ChevronDown).size(IconSize::XSmall)).child("Advanced"))
                            .child(div().pl(px(16.)).pt(px(4.)).child(Checkbox::new("col-c", true).label("Format on save"))),
                    )
                    .child(caption("Tabs: segmented, line, text"))
                    .child(tabs(TabsVariant::Default))
                    .child(tabs(TabsVariant::Line))
                    .child(tabs(TabsVariant::Text))
                    .child(caption("Toggles and button groups"))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .child(Toggle::new("t1", IconName::TextAlignLeft).tooltip("Wrap"))
                            .child(Toggle::new("t2", IconName::Eye).pressed(true))
                            .child(Toggle::new("t3", IconName::Sparkle).pressed(true).tone(ToggleTone::Accent))
                            .child(Toggle::new("t4", IconName::Pin).variant(ToggleVariant::Outline).size(ToggleSize::Sm))
                            .child(Toggle::new("t5", IconName::Files).size(ToggleSize::Lg).pressed(true))
                            .child(Toggle::new("t6", IconName::Check).label("Done").pressed(true)),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.))
                            .child(
                                ButtonGroup::new()
                                    .child(Button::new("bg1", "Commit").variant(ButtonVariant::Ghost))
                                    .child(ButtonGroupSeparator::new())
                                    .child(Button::icon("bg2", IconName::ChevronDown).variant(ButtonVariant::Ghost)),
                            )
                            .child(
                                ButtonGroup::new()
                                    .variant(ButtonGroupVariant::Accent)
                                    .child(Button::new("bg3", "Run").variant(ButtonVariant::Ghost))
                                    .child(ButtonGroupSeparator::new())
                                    .child(Button::icon("bg4", IconName::ChevronDown).variant(ButtonVariant::Ghost)),
                            ),
                    )
                    .child(caption("Menubar"))
                    .child(Menubar::new("menubar").menu("file", "File").menu("edit", "Edit").menu("view", "View").menu("help", "Help").value(Some("edit".into())))
                    .child(caption("Choice cards"))
                    .child(
                        ChoiceCards::new("scheme", "dark")
                            .card(ChoiceCard::new("light", "Light", swatch(gpui::rgb(0xf5f5f4).into(), gpui::rgb(0x2563eb).into())))
                            .card(ChoiceCard::new("dark", "Dark", swatch(gpui::rgb(0x1c1c1e).into(), gpui::rgb(0x60a5fa).into())))
                            .card(ChoiceCard::new("system", "System", swatch(colors.surface, colors.primary)).disabled(true)),
                    ),
            )
            .child(
                column()
                    .child(caption("Table"))
                    .child(
                        div().rounded(metrics::radius_lg()).bg(colors.background).p(px(4.)).child(
                            Table::new(vec![TableColumn::Flex(2.), TableColumn::Flex(1.), TableColumn::Fixed(px(64.))])
                                .header(["Name", "Type", "Size"])
                                .row(TableRow::new("r1").cell("users").cell("table").cell("12 MB"))
                                .row(TableRow::new("r2").cell("sessions").cell("table").cell("3 MB").selected(true))
                                .row(TableRow::new("r3").cell("active_users").cell("view").cell("—"))
                                .footer([div().child("3 objects").into_any_element()])
                                .caption("public schema"),
                        ),
                    )
                    .child(caption("Loading"))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(16.))
                            .child(Spinner::new("sp1"))
                            .child(Spinner::new("sp2").compact())
                            .child(Spinner::new("sp3").label("Indexing").show_label())
                            .child(ThinkingOrb::new("orb1").size(px(24.)))
                            .child(ThinkingOrb::new("orb2").state(ThinkingOrbState::Working).size(px(24.)))
                            .child(ThinkingOrb::new("orb3").size(px(64.)))
                            .child(ThinkingOrb::new("orb4").state(ThinkingOrbState::Working).size(px(64.))),
                    )
                    .child(Shimmer::new("shimmer", "Thinking about the borrow checker…").duration(std::time::Duration::from_millis(1800)))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(6.))
                            .child(Skeleton::new("sk1").h(px(12.)).w(px(220.)))
                            .child(Skeleton::new("sk2").h(px(12.)).w(px(300.)))
                            .child(Skeleton::new("sk3").h(px(12.)).w(px(160.))),
                    )
                    .child(caption("Hover card"))
                    .child(
                        HoverCard::new()
                            .child(div().flex().items_center().gap(px(8.)).child(Avatar::new("Mehmet Ozgul")).child(div().font_weight(typography::MEDIUM).child("mehmetozgul")))
                            .child(div().text_color(colors.muted_foreground).child("Maintainer of athasdev/athas. 412 contributions this year.")),
                    )
                    .child(caption("Brand marks"))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(10.))
                            .child(BrandMark::athas().size(px(20.)))
                            .child(BrandMark::github().size(px(20.)))
                            .children(["claude-acp", "gemini-cli", "github-copilot-cli", "opencode"].into_iter().filter_map(|agent| BrandMark::agent(agent)).map(|mark| mark.size(px(20.)))),
                    ),
            )
            .child(
                column()
                    .w(px(380.))
                    .child(caption("Questionnaire"))
                    .child(div().p(px(12.)).rounded(metrics::radius_lg()).bg(colors.background).child(self.questionnaire.clone()))
                    .child(caption("Viewer states"))
                    .child(div().rounded(metrics::radius_lg()).overflow_hidden().child(ViewerState::new().title("Nothing to preview").description("Binary files open in the hex viewer.").action("Open as text", |_, _| {}).layout(ViewerLayout::Section)))
                    .child(div().rounded(metrics::radius_lg()).overflow_hidden().child(ViewerLoadingState::new("Loading image…").layout(ViewerLayout::Section)))
                    .child(div().rounded(metrics::radius_lg()).overflow_hidden().child(ViewerErrorState::new("The PDF could not be read: unexpected end of file.").action("Retry", |_, _| {}).layout(ViewerLayout::Section))),
            )
    }
}

impl Gallery {
    fn states(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let caption = |text: &'static str| div().w(px(120.)).flex_none().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(text);
        let head = |text: &'static str| div().w(px(150.)).flex_none().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(text);
        let cell = || div().w(px(150.)).flex_none().flex().items_center().gap(px(8.));
        let row = |name: &'static str, cells: Vec<gpui::AnyElement>| {
            div().flex().items_center().min_h(px(36.)).child(caption(name)).children(cells.into_iter().map(|c| cell().child(c)))
        };
        let states = ["rest", "hover", "active", "disabled"];
        let button_row = |name: &'static str, variant: ButtonVariant| {
            row(
                name,
                states
                    .iter()
                    .map(|state| {
                        Button::new(SharedString::from(format!("{name}-{state}")), name)
                            .variant(variant)
                            .force_hover(*state == "hover")
                            .active(*state == "active")
                            .disabled(*state == "disabled")
                            .into_any_element()
                    })
                    .collect(),
            )
        };
        let icon_row = |name: &'static str, plane: Plane| {
            row(
                name,
                states
                    .iter()
                    .map(|state| {
                        Button::icon(SharedString::from(format!("{name}-{state}")), IconName::Files)
                            .size(ButtonSize::Large)
                            .plane(plane)
                            .filled_when_active()
                            .force_hover(*state == "hover")
                            .active(*state == "active")
                            .disabled(*state == "disabled")
                            .into_any_element()
                    })
                    .collect(),
            )
        };
        div()
            .flex()
            .flex_col()
            .gap(px(2.))
            .child(div().flex().child(div().w(px(120.))).children(states.iter().map(|state| head(state))))
            .child(button_row("Default", ButtonVariant::Default))
            .child(button_row("Accent", ButtonVariant::Accent))
            .child(button_row("Outline", ButtonVariant::Outline))
            .child(button_row("Ghost", ButtonVariant::Ghost))
            .child(button_row("Destructive", ButtonVariant::Destructive))
            .child(icon_row("Icon (content)", Plane::Content))
            .child(icon_row("Icon (page)", Plane::Page))
            .child(row(
                "Toggle",
                vec![
                    Toggle::new("tg-rest", IconName::TextAlignLeft).into_any_element(),
                    Toggle::new("tg-hover", IconName::TextAlignLeft).force_hover(true).into_any_element(),
                    Toggle::new("tg-on", IconName::TextAlignLeft).pressed(true).into_any_element(),
                    Toggle::new("tg-off", IconName::TextAlignLeft).disabled(true).into_any_element(),
                ],
            ))
            .child(row(
                "Editor tab",
                vec![
                    Tab::new("tab-rest", "main.rs").icon(IconName::File).into_any_element(),
                    Tab::new("tab-hover", "main.rs").icon(IconName::File).force_hover(true).into_any_element(),
                    Tab::new("tab-active", "main.rs").icon(IconName::File).active(true).dirty(true).into_any_element(),
                    Tab::new("tab-pinned", "lib.rs").icon(IconName::File).pinned(true).into_any_element(),
                ],
            ))
            .child(row(
                "Sidebar row",
                vec![
                    SidebarListItem::new("row-rest", "Fix the login test").leading_icon(IconName::ChatBubbleText).into_any_element(),
                    SidebarListItem::new("row-hover", "Fix the login test").leading_icon(IconName::ChatBubbleText).force_hover(true).into_any_element(),
                    SidebarListItem::new("row-active", "Fix the login test").leading_icon(IconName::ChatBubbleText).active(true).into_any_element(),
                    SidebarListItem::new("row-content", "In content").leading_icon(IconName::ChatBubbleText).in_content().force_hover(true).into_any_element(),
                    SidebarListItem::new("row-emphasized", "Focused sidebar").leading_icon(IconName::ChatBubbleText).active(true).emphasized(true).into_any_element(),
                    SidebarListItem::new("row-error", "Failed run").leading_icon(IconName::Xcircle).tone(ui::SidebarListItemTone::Error).into_any_element(),
                ],
            ))
            .child(row(
                "Checkbox",
                vec![
                    Checkbox::new("cb-rest", false).into_any_element(),
                    Checkbox::new("cb-hover", false).force_hover(true).into_any_element(),
                    Checkbox::new("cb-on", true).into_any_element(),
                    Checkbox::new("cb-off", true).disabled(true).into_any_element(),
                ],
            ))
            .child(row(
                "Switch",
                vec![
                    Switch::new("sw-rest", false).into_any_element(),
                    Switch::new("sw-hover", false).into_any_element(),
                    Switch::new("sw-on", true).into_any_element(),
                    Switch::new("sw-off", true).disabled(true).into_any_element(),
                ],
            ))
            .child(row(
                "Segmented",
                vec![
                    ToggleGroup::new("seg", vec![ToggleOption::new("a", "Files"), ToggleOption::new("b", "Changes")], "b").into_any_element(),
                    Tabs::new("tabs", vec![TabsTrigger::new("a", "General"), TabsTrigger::new("b", "Editor")], "b").into_any_element(),
                ],
            ))
            .child(row(
                "Badges",
                vec![
                    Badge::new("12").into_any_element(),
                    Badge::new("Pro").tone(Tone::Accent).into_any_element(),
                    Badge::new("Passing").tone(Tone::Success).into_any_element(),
                    Badge::new("Failed").tone(Tone::Danger).into_any_element(),
                ],
            ))
            .child(row(
                "Input",
                vec![
                    div().w(px(140.)).child(self.input.clone()).into_any_element(),
                    div().w(px(140.)).child(self.input_focused.clone()).into_any_element(),
                ],
            ))
            .child(
                div()
                    .flex()
                    .gap(px(24.))
                    .pt(px(12.))
                    .child(caption("Menu, tooltip"))
                    .child(div().w(px(260.)).child(self.menu.clone()))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .items_center()
                            .gap(px(4.))
                            .child(Tooltip::bubble("Toggle Sidebar", Some("⌘B".into()), cx))
                            .child(Button::icon("tooltip-anchor", IconName::Sidebar).force_hover(true)),
                    ),
            )
    }
}

impl Render for Gallery {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let content = match self.page.as_str() {
            "overlays" => self.overlays(cx).into_any_element(),
            "primitives" => self.primitives(cx).into_any_element(),
            "states" => self.states(cx).into_any_element(),
            _ => self.controls(cx).into_any_element(),
        };
        div()
            .size_full()
            .p(px(24.))
            .bg(colors.surface)
            .font_family(typography::UI_FONT)
            .text_size(typography::text_sm())
            .text_color(colors.foreground)
            .child(island(cx).p(px(24.)).child(content))
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = args.first().cloned().unwrap_or_else(|| "ui_gallery.png".into());
    let appearance = if args.get(1).map(String::as_str) == Some("light") { Appearance::Light } else { Appearance::Dark };
    let page = args.get(2).cloned().unwrap_or_else(|| "controls".into());

    let text_system = gpui_platform::current_platform(true).text_system();
    let mut cx = HeadlessAppContext::with_platform(text_system, Arc::new(ui::Assets), || gpui_platform::current_headless_renderer());
    cx.update(|cx| -> Result<()> {
        ui::load_fonts(cx)?;
        ui::init(cx);
        theme::init(cx, None, appearance, false);
        Ok(())
    })?;
    let window = cx.open_window(size(px(1340.), px(1060.)), |window, cx| cx.new(|cx| Gallery::new(page.clone(), window, cx)))?;
    cx.update(|cx| {
        window
            .update(cx, |gallery, window, cx| {
                gallery.select_open.update(cx, |select, cx| select.set_open(true, window, cx));
                gallery.menu.update(cx, |menu, cx| menu.highlight(Some(5), true, window, cx));
                if gallery.page == "states" {
                    let focus = gallery.input_focused.focus_handle(cx);
                    window.focus(&focus, cx);
                }
            })
            .ok();
    });
    cx.allow_parking();
    for _ in 0..4 {
        cx.update_window(window.into(), |_, window, _| window.refresh())?;
        cx.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(30));
    }
    let image = cx.capture_screenshot(window.into()).context("capturing the window")?;
    image.save(&out).with_context(|| format!("writing {out}"))?;
    println!("{out} {}x{}", image.width(), image.height());
    Ok(())
}
