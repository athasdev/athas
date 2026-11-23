//! Dropdown and context menus for the panel and the resource views.

use ui::scale::px;
use gpui::{Anchor, ClickEvent, Context, Pixels, Point, SharedString, Window, point,};
use ui::{MenuEntry, MenuItem, OpenMenu};

pub trait MenuHost: Sized + 'static {
    fn menu_slot(&mut self) -> &mut Option<OpenMenu>;
}

/// Opens `entries`, or closes the menu if the same one is already open.
pub fn show<V: MenuHost>(this: &mut V, key: &str, entries: Vec<MenuEntry>, position: Point<Pixels>, anchor: Anchor, window: &mut Window, cx: &mut Context<V>) {
    if is_open(this.menu_slot(), key) {
        *this.menu_slot() = None;
        cx.notify();
        return;
    }
    let menu = OpenMenu::new(key.to_string(), entries, position, anchor, window, cx, |this: &mut V, _| *this.menu_slot() = None);
    *this.menu_slot() = Some(menu);
    cx.notify();
}

/// Puts a search field over the open menu's rows, as the sidebar's Filter menus have.
pub fn make_searchable<V: MenuHost>(this: &mut V, key: &str, placeholder: impl Into<SharedString>, empty: impl Into<SharedString>, cx: &mut Context<V>) {
    if !is_open(this.menu_slot(), key) {
        return;
    }
    let Some(menu) = this.menu_slot().take() else { return };
    *this.menu_slot() = Some(menu.searchable(placeholder, empty, cx));
}

/// Answers what is typed into the open menu's field with rows of its own, instead of filtering
/// the menu's rows: the filters stay, and a query searches the list behind them.
pub fn set_query_source<V: MenuHost>(
    this: &mut V,
    key: &str,
    source: impl Fn(&str, &mut Window, &mut gpui::App) -> Vec<MenuEntry> + 'static,
    cx: &mut Context<V>,
) {
    if !is_open(this.menu_slot(), key) {
        return;
    }
    let Some(menu) = this.menu_slot().as_ref().map(|menu| menu.menu.clone()) else { return };
    menu.update(cx, |menu, _| menu.set_query_source(std::rc::Rc::new(source)));
}

pub fn is_open(menu: &Option<OpenMenu>, key: &str) -> bool {
    menu.as_ref().is_some_and(|menu| menu.key.as_ref() == key)
}

/// A menu item that calls back into its view.
pub fn item<V: 'static>(label: impl Into<SharedString>, cx: &Context<V>, action: impl Fn(&mut V, &mut Window, &mut Context<V>) + 'static) -> MenuItem {
    let this = cx.entity().downgrade();
    MenuItem::new(label).on_select(move |window, cx| {
        this.update(cx, |this, cx| action(this, window, cx)).ok();
    })
}

/// A menu item that opens a web page.
pub fn link(label: impl Into<SharedString>, url: String) -> MenuItem {
    MenuItem::new(label).external().on_select(move |_, cx| cx.open_url(&url))
}

/// A menu item that copies text, confirmed with a toast named after the label ("Copy branch
/// name" → "Branch name copied"), as the original's copy actions.
pub fn copy(label: impl Into<SharedString>, text: String) -> MenuItem {
    let label = label.into();
    let noun = copied_noun(&label);
    copy_named(label, noun, text)
}

/// [`copy`] with the toast's noun given ("PR link" → "PR link copied", or "PR link is not
/// available." when there is nothing to copy).
pub fn copy_named(label: impl Into<SharedString>, noun: impl Into<String>, text: String) -> MenuItem {
    let noun = noun.into();
    MenuItem::new(label).on_select(move |_, cx| {
        use notifications::{NotificationCategory, NotificationKind};
        if text.trim().is_empty() {
            notifications::notify(cx, NotificationKind::Error, NotificationCategory::GitHub, format!("{noun} is not available."), None, None);
            return;
        }
        cx.write_to_clipboard(gpui::ClipboardItem::new_string(text.clone()));
        notifications::notify(cx, NotificationKind::Success, NotificationCategory::GitHub, format!("{noun} copied"), None, None);
    })
}

/// "Copy Branch Name" → "Branch name"; acronyms (SHA, URL) keep their case.
fn copied_noun(label: &str) -> String {
    let rest = label.strip_prefix("Copy ").unwrap_or(label);
    rest.split(' ')
        .enumerate()
        .map(|(index, word)| {
            if word.len() > 1 && word.chars().all(|character| !character.is_lowercase()) {
                return word.to_string();
            }
            let mut chars = word.chars();
            match chars.next() {
                Some(first) if index == 0 => first.to_uppercase().chain(chars).collect(),
                Some(first) => first.to_lowercase().chain(chars).collect(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    #[test]
    fn names_what_was_copied() {
        assert_eq!(super::copied_noun("Copy Branch Name"), "Branch name");
        assert_eq!(super::copied_noun("Copy commit SHA"), "Commit SHA");
        assert_eq!(super::copied_noun("Copy repository URL"), "Repository URL");
        assert_eq!(super::copied_noun("Copy link"), "Link");
    }
}

/// Where a menu opened from a button hangs: just below and inside the click.
pub fn below(event: &ClickEvent) -> Point<Pixels> {
    let position = event.position();
    point(position.x + px(8.), position.y + px(8.))
}
