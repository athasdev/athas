//! Right-click menus the OS draws (`native-context-menu.ts`). Native menus carry text, enabled and
//! checked state, a shortcut hint and submenus; icons, tones and trailing text have no native
//! form and are left out. Menus opened from the keyboard, searchable menus and windows without an
//! AppKit view (tests, snapshots, Linux, Windows) keep the in-app menu.
//!
//! Only the AppKit side below calls the helpers that read a shortcut hint and tidy the entries;
//! the tests cover them everywhere.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use crate::menu::MenuEntry;

/// A shortcut hint as AppKit takes it: the key equivalent and its modifier mask.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct KeyEquivalent {
    pub key: String,
    pub modifiers: usize,
}

const COMMAND: usize = 1 << 20;
const SHIFT: usize = 1 << 17;
const OPTION: usize = 1 << 19;
const CONTROL: usize = 1 << 18;

/// Reads a hint such as `⌘⇧P`, `⌥↑` or `F2` into a key equivalent; text that names no key
/// (`Installing…`, chords) has none, as `shortcutToAccelerator` leaves those out.
pub(crate) fn key_equivalent(shortcut: &str) -> Option<KeyEquivalent> {
    let mut modifiers = 0;
    let mut rest = shortcut.trim();
    loop {
        let mut chars = rest.chars();
        let flag = match chars.next()? {
            '⌘' => COMMAND,
            '⇧' => SHIFT,
            '⌥' => OPTION,
            '⌃' => CONTROL,
            _ => break,
        };
        modifiers |= flag;
        rest = chars.as_str();
    }
    let key = match rest {
        "↑" => '\u{F700}'.to_string(),
        "↓" => '\u{F701}'.to_string(),
        "←" => '\u{F702}'.to_string(),
        "→" => '\u{F703}'.to_string(),
        "↵" | "⏎" | "Enter" => "\r".to_string(),
        "⌫" => "\u{8}".to_string(),
        "⌦" => "\u{7F}".to_string(),
        "⎋" | "Esc" => "\u{1B}".to_string(),
        "⇥" | "Tab" => "\t".to_string(),
        "Space" | "␣" => " ".to_string(),
        key if key.len() > 1 && key.starts_with('F') && key[1..].parse::<u32>().is_ok_and(|number| (1..=20).contains(&number)) => {
            char::from_u32(0xF704 + key[1..].parse::<u32>().ok()? - 1)?.to_string()
        }
        key if key.chars().count() == 1 && !key.chars().all(char::is_whitespace) => key.to_lowercase(),
        _ => return None,
    };
    // A capital letter alone means Shift in AppKit, so letters are lower case with the mask.
    Some(KeyEquivalent { key, modifiers })
}

/// Drops separators at either end and runs of them, which native menus would draw as is.
pub(crate) fn tidy(entries: &[MenuEntry]) -> Vec<&MenuEntry> {
    let mut tidy: Vec<&MenuEntry> = Vec::new();
    for entry in entries {
        if matches!(entry, MenuEntry::Separator) && tidy.last().is_none_or(|last| matches!(last, MenuEntry::Separator)) {
            continue;
        }
        tidy.push(entry);
    }
    if tidy.last().is_some_and(|last| matches!(last, MenuEntry::Separator)) {
        tidy.pop();
    }
    tidy
}

#[cfg(target_os = "macos")]
pub(crate) use macos::{is_context_click, popup};

#[cfg(not(target_os = "macos"))]
pub(crate) fn is_context_click(_: &gpui::Window) -> bool {
    false
}

#[cfg(target_os = "macos")]
mod macos {
    use std::sync::atomic::{AtomicIsize, Ordering};

    use gpui::{Pixels, Point, Window};
    use objc2::{
        ClassType as _, msg_send,
        rc::{Allocated, Retained},
        runtime::{AnyClass, AnyObject, Bool, ClassBuilder, NSObject, Sel},
        sel,
    };
    use objc2_foundation::{NSPoint, NSRect, NSString};
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    use super::{key_equivalent, tidy};
    use crate::menu::{Handler, MenuEntry};

    /// The tag of the item last chosen, or -1.
    static SELECTED: AtomicIsize = AtomicIsize::new(-1);

    extern "C" fn select(_: *mut AnyObject, _: Sel, sender: *mut AnyObject) {
        let tag: isize = unsafe { msg_send![sender, tag] };
        SELECTED.store(tag, Ordering::Release);
    }

    fn target() -> Option<Retained<AnyObject>> {
        let class = match AnyClass::get(c"AthasNativeMenuTarget") {
            Some(class) => class,
            None => {
                let mut builder = ClassBuilder::new(c"AthasNativeMenuTarget", NSObject::class())?;
                unsafe { builder.add_method(sel!(athasSelect:), select as extern "C" fn(*mut AnyObject, Sel, *mut AnyObject)) };
                builder.register()
            }
        };
        unsafe { msg_send![class, new] }
    }

    fn ns_view(window: &Window) -> Option<*mut AnyObject> {
        match HasWindowHandle::window_handle(window).map(|handle| handle.as_raw()) {
            Ok(RawWindowHandle::AppKit(handle)) => Some(handle.ns_view.as_ptr().cast()),
            _ => None,
        }
    }

    /// Whether the event being handled is a right click (or Control-click) in an AppKit window.
    pub(crate) fn is_context_click(window: &Window) -> bool {
        if ns_view(window).is_none() {
            return false;
        }
        let Some(app_class) = AnyClass::get(c"NSApplication") else { return false };
        unsafe {
            let app: *mut AnyObject = msg_send![app_class, sharedApplication];
            let event: *mut AnyObject = msg_send![app, currentEvent];
            if event.is_null() {
                return false;
            }
            let kind: usize = msg_send![event, type];
            let flags: usize = msg_send![event, modifierFlags];
            // NSEventTypeRightMouseDown / Up, or a left click with Control held.
            matches!(kind, 3 | 4) || (matches!(kind, 1 | 2) && flags & super::CONTROL != 0)
        }
    }

    fn build(entries: &[MenuEntry], target: &AnyObject, handlers: &mut Vec<Handler>) -> Option<Retained<AnyObject>> {
        let menu_class = AnyClass::get(c"NSMenu")?;
        let item_class = AnyClass::get(c"NSMenuItem")?;
        unsafe {
            let menu: Allocated<AnyObject> = msg_send![menu_class, alloc];
            let menu: Retained<AnyObject> = msg_send![menu, initWithTitle: &*NSString::from_str("")];
            let _: () = msg_send![&*menu, setAutoenablesItems: Bool::NO];
            for entry in tidy(entries) {
                let item: Retained<AnyObject> = match entry {
                    MenuEntry::Separator => msg_send![item_class, separatorItem],
                    MenuEntry::Label(label) | MenuEntry::Text(label) => {
                        let item = new_item(item_class, label, "")?;
                        let _: () = msg_send![&*item, setEnabled: Bool::NO];
                        item
                    }
                    MenuEntry::Item(entry) => {
                        let shortcut = entry.shortcut.as_deref().and_then(key_equivalent);
                        let item = new_item(item_class, &entry.label, shortcut.as_ref().map_or("", |shortcut| shortcut.key.as_str()))?;
                        if let Some(shortcut) = &shortcut {
                            let _: () = msg_send![&*item, setKeyEquivalentModifierMask: shortcut.modifiers];
                        }
                        if entry.checked == Some(true) || entry.selected {
                            let _: () = msg_send![&*item, setState: 1isize];
                        }
                        match &entry.submenu {
                            Some(children) => {
                                let submenu = build(children, target, handlers)?;
                                let _: () = msg_send![&*item, setSubmenu: &*submenu];
                                let _: () = msg_send![&*item, setEnabled: Bool::new(!entry.disabled && !children.is_empty())];
                            }
                            None => {
                                let enabled = !entry.disabled && entry.handler.is_some();
                                let _: () = msg_send![&*item, setEnabled: Bool::new(enabled)];
                                if let Some(handler) = entry.handler.clone() {
                                    let _: () = msg_send![&*item, setTag: handlers.len() as isize];
                                    let _: () = msg_send![&*item, setTarget: target];
                                    let _: () = msg_send![&*item, setAction: sel!(athasSelect:)];
                                    handlers.push(handler);
                                }
                            }
                        }
                        item
                    }
                };
                let _: () = msg_send![&*menu, addItem: &*item];
            }
            Some(menu)
        }
    }

    fn new_item(class: &AnyClass, label: &str, key: &str) -> Option<Retained<AnyObject>> {
        unsafe {
            let item: Allocated<AnyObject> = msg_send![class, alloc];
            msg_send![item, initWithTitle: &*NSString::from_str(label), action: None::<Sel>, keyEquivalent: &*NSString::from_str(key)]
        }
    }

    /// The prepared OS menu: shown with [`Popup::show`] outside GPUI's update, since AppKit tracks
    /// it in a nested run loop.
    pub(crate) struct Popup {
        menu: Retained<AnyObject>,
        _target: Retained<AnyObject>,
        view: *mut AnyObject,
        position: Point<Pixels>,
        handlers: Vec<Handler>,
    }

    pub(crate) fn popup(entries: &[MenuEntry], position: Point<Pixels>, window: &Window) -> Option<Popup> {
        let view = ns_view(window)?;
        let target = target()?;
        let mut handlers = Vec::new();
        let menu = build(entries, &target, &mut handlers)?;
        Some(Popup { menu, _target: target, view, position, handlers })
    }

    impl Popup {
        /// Shows the menu where the click was and returns the chosen item's handler.
        pub(crate) fn show(self) -> Option<Handler> {
            SELECTED.store(-1, Ordering::Release);
            unsafe {
                let flipped: Bool = msg_send![self.view, isFlipped];
                let bounds: NSRect = msg_send![self.view, bounds];
                let x = f64::from(f32::from(self.position.x));
                let y = f64::from(f32::from(self.position.y));
                let at = NSPoint::new(x, if flipped.as_bool() { y } else { bounds.size.height - y });
                let _: Bool = msg_send![&*self.menu, popUpMenuPositioningItem: std::ptr::null_mut::<AnyObject>(), atLocation: at, inView: self.view];
            }
            let tag = SELECTED.swap(-1, Ordering::AcqRel);
            usize::try_from(tag).ok().and_then(|tag| self.handlers.get(tag).cloned())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::menu::MenuItem;

    #[test]
    fn reads_shortcut_hints() {
        assert_eq!(key_equivalent("⌘C"), Some(KeyEquivalent { key: "c".into(), modifiers: COMMAND }));
        assert_eq!(key_equivalent("⌘⇧P"), Some(KeyEquivalent { key: "p".into(), modifiers: COMMAND | SHIFT }));
        assert_eq!(key_equivalent("⌥↑"), Some(KeyEquivalent { key: "\u{F700}".into(), modifiers: OPTION }));
        assert_eq!(key_equivalent("F2"), Some(KeyEquivalent { key: "\u{F705}".into(), modifiers: 0 }));
        assert_eq!(key_equivalent("⌘."), Some(KeyEquivalent { key: ".".into(), modifiers: COMMAND }));
        assert_eq!(key_equivalent("⌃⌫"), Some(KeyEquivalent { key: "\u{8}".into(), modifiers: CONTROL }));
        assert_eq!(key_equivalent("Installing…"), None);
        assert_eq!(key_equivalent("⌘K ⌘S"), None);
        assert_eq!(key_equivalent(""), None);
    }

    #[test]
    fn tidies_separators() {
        let entries = vec![
            MenuEntry::Separator,
            MenuItem::new("Copy").into(),
            MenuEntry::Separator,
            MenuEntry::Separator,
            MenuItem::new("Paste").into(),
            MenuEntry::Separator,
        ];
        let tidy = tidy(&entries);
        assert_eq!(tidy.len(), 3);
        assert!(matches!(tidy[1], MenuEntry::Separator));
    }
}
