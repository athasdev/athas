//! Recent projects and files in Spotlight (`index_spotlight_item` and
//! `continue_spotlight_activity` in Athas's `bootstrap/macos.rs`): each recent item is indexed
//! under Athas, and choosing one in Spotlight opens it here.

use std::{
    ffi::{CStr, CString, c_char, c_void},
    path::Path,
    sync::OnceLock,
};

use futures::channel::mpsc::UnboundedSender;
use objc2::{
    ffi, msg_send,
    runtime::{AnyClass, AnyObject, Bool, Imp, Sel},
    sel,
};

use crate::OpenEvent;

#[link(name = "CoreSpotlight", kind = "framework")]
unsafe extern "C" {}

static SENDER: OnceLock<UnboundedSender<OpenEvent>> = OnceLock::new();

/// What Spotlight shows for a recent item: its name and description, and its content type.
pub(crate) fn item_details(path: &Path, is_dir: bool) -> (String, &'static str, &'static str) {
    let path_text = path.to_string_lossy();
    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).filter(|name| !name.is_empty()).unwrap_or_else(|| path_text.into_owned());
    if is_dir { (name, "Recent Athas project", "public.folder") } else { (name, "Recent Athas document", "public.data") }
}

unsafe fn ns_string(value: &str) -> *mut AnyObject {
    let Ok(value) = CString::new(value) else { return std::ptr::null_mut() };
    let class = AnyClass::get(c"NSString").expect("NSString");
    unsafe { msg_send![class, stringWithUTF8String: value.as_ptr()] }
}

/// Adds `path` to Spotlight as a recent Athas item.
pub(crate) fn index(path: &Path) {
    let Some(path_text) = path.to_str() else { return };
    let is_dir = path.is_dir();
    let (name, description, content_type) = item_details(path, is_dir);
    unsafe {
        let (Some(attributes_class), Some(item_class), Some(index_class), Some(url_class)) = (
            AnyClass::get(c"CSSearchableItemAttributeSet"),
            AnyClass::get(c"CSSearchableItem"),
            AnyClass::get(c"CSSearchableIndex"),
            AnyClass::get(c"NSURL"),
        ) else {
            return;
        };
        let attributes: *mut AnyObject = msg_send![attributes_class, alloc];
        let attributes: *mut AnyObject = msg_send![attributes, initWithItemContentType: ns_string(content_type)];
        if attributes.is_null() {
            return;
        }
        let url: *mut AnyObject = msg_send![url_class, fileURLWithPath: ns_string(path_text), isDirectory: Bool::new(is_dir)];
        let _: () = msg_send![attributes, setTitle: ns_string(&name)];
        let _: () = msg_send![attributes, setDisplayName: ns_string(&name)];
        let _: () = msg_send![attributes, setContentDescription: ns_string(description)];
        let _: () = msg_send![attributes, setContentURL: url];
        let item: *mut AnyObject = msg_send![item_class, alloc];
        let item: *mut AnyObject = msg_send![
            item,
            initWithUniqueIdentifier: ns_string(path_text),
            domainIdentifier: ns_string("com.athas.recent-items"),
            attributeSet: attributes
        ];
        let index: *mut AnyObject = msg_send![index_class, alloc];
        let index: *mut AnyObject = msg_send![index, initWithName: ns_string("AthasRecentItems")];
        if !item.is_null() && !index.is_null() {
            let array_class = AnyClass::get(c"NSArray").expect("NSArray");
            let items: *mut AnyObject = msg_send![array_class, arrayWithObject: item];
            let _: () = msg_send![index, indexSearchableItems: items, completionHandler: std::ptr::null_mut::<c_void>()];
        }
        if !index.is_null() {
            let _: () = msg_send![index, release];
        }
        if !item.is_null() {
            let _: () = msg_send![item, release];
        }
        let _: () = msg_send![attributes, release];
    }
}

unsafe extern "C" fn continue_activity(_: *mut AnyObject, _: Sel, _: *mut AnyObject, activity: *mut AnyObject, _: *mut c_void) -> Bool {
    if activity.is_null() {
        return Bool::NO;
    }
    let path = unsafe {
        let info: *mut AnyObject = msg_send![activity, userInfo];
        if info.is_null() {
            return Bool::NO;
        }
        let identifier: *mut AnyObject = msg_send![info, objectForKey: ns_string("kCSSearchableItemActivityIdentifier")];
        let identifier = if identifier.is_null() { msg_send![info, objectForKey: ns_string("CSSearchableItemActivityIdentifier")] } else { identifier };
        if identifier.is_null() {
            return Bool::NO;
        }
        let bytes: *const c_char = msg_send![identifier, UTF8String];
        if bytes.is_null() {
            return Bool::NO;
        }
        let Ok(path) = CStr::from_ptr(bytes).to_str() else { return Bool::NO };
        path.to_string()
    };
    let urls = crate::services::file_urls([path]);
    match SENDER.get() {
        Some(sender) if !urls.is_empty() => {
            sender.unbounded_send(OpenEvent::Urls(urls)).ok();
            Bool::YES
        }
        _ => Bool::NO,
    }
}

/// Lets the app delegate open Spotlight results. Call once the application runs.
pub(crate) fn install(sender: UnboundedSender<OpenEvent>) {
    if SENDER.set(sender).is_err() {
        return;
    }
    unsafe {
        let Some(app_class) = AnyClass::get(c"NSApplication") else { return };
        let application: *mut AnyObject = msg_send![app_class, sharedApplication];
        let delegate: *mut AnyObject = msg_send![application, delegate];
        if delegate.is_null() {
            return;
        }
        let class = ffi::object_getClass(delegate) as *mut AnyClass;
        let imp: Imp = std::mem::transmute::<unsafe extern "C" fn(*mut AnyObject, Sel, *mut AnyObject, *mut AnyObject, *mut c_void) -> Bool, Imp>(continue_activity);
        ffi::class_addMethod(class, sel!(application:continueUserActivity:restorationHandler:), imp, c"c@:@@@".as_ptr());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn details() {
        assert_eq!(item_details(Path::new("/work/athas"), true), ("athas".to_string(), "Recent Athas project", "public.folder"));
        assert_eq!(item_details(Path::new("/work/a.rs"), false), ("a.rs".to_string(), "Recent Athas document", "public.data"));
    }
}
