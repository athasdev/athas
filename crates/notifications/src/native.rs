//! Banners through `UNUserNotificationCenter`. It needs a bundle identifier, so only the app
//! bundle uses it; clicking such a banner activates Athas, as the original's do.

use std::{
    ffi::{CStr, CString, c_char},
    ptr,
};

use block2::{Block, RcBlock};
use objc2::{
    msg_send,
    runtime::{AnyClass, AnyObject, Bool},
};

#[link(name = "UserNotifications", kind = "framework")]
unsafe extern "C" {}

/// `UNAuthorizationOptionAlert | UNAuthorizationOptionSound`.
const AUTHORIZATION_OPTIONS: usize = 4 | 2;

fn class(name: &CStr) -> Option<&'static AnyClass> {
    AnyClass::get(name)
}

unsafe fn ns_string(value: &str) -> *mut AnyObject {
    let Some(class) = class(c"NSString") else { return ptr::null_mut() };
    let Ok(value) = CString::new(value) else { return ptr::null_mut() };
    unsafe { msg_send![class, stringWithUTF8String: value.as_ptr()] }
}

unsafe fn rust_string(value: *mut AnyObject) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let bytes: *const c_char = unsafe { msg_send![value, UTF8String] };
    (!bytes.is_null()).then(|| unsafe { CStr::from_ptr(bytes) }.to_string_lossy().into_owned())
}

/// Running from an `.app` bundle with an identifier.
pub fn bundled() -> bool {
    let Some(bundle_class) = class(c"NSBundle") else { return false };
    unsafe {
        let bundle: *mut AnyObject = msg_send![bundle_class, mainBundle];
        if bundle.is_null() {
            return false;
        }
        let identifier: *mut AnyObject = msg_send![bundle, bundleIdentifier];
        let path: *mut AnyObject = msg_send![bundle, bundlePath];
        !identifier.is_null() && rust_string(path).is_some_and(|path| path.ends_with(".app"))
    }
}

fn center() -> *mut AnyObject {
    let Some(center_class) = class(c"UNUserNotificationCenter") else { return ptr::null_mut() };
    unsafe { msg_send![center_class, currentNotificationCenter] }
}

/// Asks for permission (once; later calls answer at once), then adds the banner.
pub fn send(title: &str, body: &str, sound: bool) {
    let center = center();
    if center.is_null() {
        return;
    }
    let (title, body) = (title.to_string(), body.to_string());
    let center_address = center as usize;
    let then = RcBlock::new(move |granted: Bool, _: *mut AnyObject| {
        if granted.as_bool() {
            unsafe { add_request(center_address as *mut AnyObject, &title, &body, sound) };
        }
    });
    unsafe {
        let _: () = msg_send![center, requestAuthorizationWithOptions: AUTHORIZATION_OPTIONS, completionHandler: &*then];
    }
}

unsafe fn add_request(center: *mut AnyObject, title: &str, body: &str, sound: bool) {
    let (Some(content_class), Some(request_class)) = (class(c"UNMutableNotificationContent"), class(c"UNNotificationRequest")) else {
        return;
    };
    unsafe {
        let content: *mut AnyObject = msg_send![content_class, new];
        let _: () = msg_send![content, setTitle: ns_string(title)];
        let _: () = msg_send![content, setBody: ns_string(body)];
        if sound && let Some(sound_class) = class(c"UNNotificationSound") {
            let sound: *mut AnyObject = msg_send![sound_class, defaultSound];
            let _: () = msg_send![content, setSound: sound];
        }
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |time| time.as_nanos());
        let identifier = format!("athas-notification-{stamp}");
        let trigger: *mut AnyObject = ptr::null_mut();
        let request: *mut AnyObject = msg_send![request_class, requestWithIdentifier: ns_string(&identifier), content: content, trigger: trigger];
        let done: *mut Block<dyn Fn(*mut AnyObject)> = ptr::null_mut();
        let _: () = msg_send![center, addNotificationRequest: request, withCompletionHandler: done];
        let _: () = msg_send![content, release];
    }
}
