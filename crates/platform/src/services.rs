//! The macOS Services menu's "Open in Athas" for files and folders selected in Finder
//! (`install_services_provider` in Athas's `bootstrap/macos.rs`). The bundle's `NSServices` entry
//! names the `openInAthas` message; the app delegate answers it.

use std::{
    ffi::{CStr, c_char},
    sync::OnceLock,
};

use futures::channel::mpsc::UnboundedSender;
use objc2::{
    ffi, msg_send,
    runtime::{AnyClass, AnyObject, Imp, Sel},
    sel,
};

use crate::OpenEvent;

static SENDER: OnceLock<UnboundedSender<OpenEvent>> = OnceLock::new();

#[link(name = "AppKit", kind = "framework")]
unsafe extern "C" {
    fn NSUpdateDynamicServices();
}

/// The paths Finder hands a service, as `file://` URLs.
pub(crate) fn file_urls(paths: impl IntoIterator<Item = String>) -> Vec<String> {
    paths.into_iter().filter_map(|path| url::Url::from_file_path(&path).ok()).map(String::from).collect()
}

unsafe extern "C" fn open_in_athas(_: *mut AnyObject, _: Sel, pasteboard: *mut AnyObject, _: *mut AnyObject, _: *mut *mut AnyObject) {
    if pasteboard.is_null() {
        return;
    }
    let mut paths = Vec::new();
    unsafe {
        let kind = objc2_string(c"NSFilenamesPboardType");
        let list: *mut AnyObject = msg_send![pasteboard, propertyListForType: kind];
        if list.is_null() {
            return;
        }
        let count: usize = msg_send![list, count];
        for index in 0..count {
            let path: *mut AnyObject = msg_send![list, objectAtIndex: index];
            let bytes: *const c_char = msg_send![path, UTF8String];
            if !bytes.is_null()
                && let Ok(path) = CStr::from_ptr(bytes).to_str()
            {
                paths.push(path.to_string());
            }
        }
    }
    let urls = file_urls(paths);
    if let Some(sender) = SENDER.get()
        && !urls.is_empty()
    {
        sender.unbounded_send(OpenEvent::Urls(urls)).ok();
    }
}

unsafe fn objc2_string(value: &CStr) -> *mut AnyObject {
    let class = AnyClass::get(c"NSString").expect("NSString");
    unsafe { msg_send![class, stringWithUTF8String: value.as_ptr()] }
}

/// Makes the app delegate the Services provider. Call once the application runs.
pub(crate) fn install(sender: UnboundedSender<OpenEvent>) {
    if SENDER.set(sender).is_err() {
        return;
    }
    unsafe {
        let Some(app_class) = AnyClass::get(c"NSApplication") else { return };
        let application: *mut AnyObject = msg_send![app_class, sharedApplication];
        let delegate: *mut AnyObject = msg_send![application, delegate];
        if delegate.is_null() {
            eprintln!("athas: no app delegate for the Services menu");
            return;
        }
        let class = ffi::object_getClass(delegate) as *mut AnyClass;
        let imp: Imp = std::mem::transmute::<unsafe extern "C" fn(*mut AnyObject, Sel, *mut AnyObject, *mut AnyObject, *mut *mut AnyObject), Imp>(open_in_athas);
        ffi::class_addMethod(class, sel!(openInAthas:userData:error:), imp, c"v@:@@^@".as_ptr());
        let _: () = msg_send![application, setServicesProvider: delegate];
        NSUpdateDynamicServices();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finder_paths_become_file_urls() {
        assert_eq!(
            file_urls(["/Users/me/My Project".to_string(), "relative".to_string()]),
            ["file:///Users/me/My%20Project"]
        );
    }
}
