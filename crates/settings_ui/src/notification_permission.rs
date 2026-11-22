//! Asking the OS to show Athas's banners, as switching Agent Notifications on does
//! (`requestAgentNativeNotificationPermission`). Only the macOS app bundle needs to ask; a bare
//! binary and other systems show notifications without a prompt.

/// What the OS answered. Only macOS ever asks, so the other systems never see a refusal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub enum Permission {
    Granted,
    Denied,
    Unavailable,
}

#[cfg(target_os = "macos")]
pub fn request(answer: impl FnOnce(Permission) + Send + 'static) {
    use std::{cell::RefCell, ffi::CStr, sync::Mutex};

    use block2::RcBlock;
    use objc2::{
        msg_send,
        runtime::{AnyClass, AnyObject, Bool},
    };

    #[link(name = "UserNotifications", kind = "framework")]
    unsafe extern "C" {}

    fn class(name: &CStr) -> Option<&'static AnyClass> {
        AnyClass::get(name)
    }

    let bundled = class(c"NSBundle").is_some_and(|bundle_class| unsafe {
        let bundle: *mut AnyObject = msg_send![bundle_class, mainBundle];
        if bundle.is_null() {
            return false;
        }
        let identifier: *mut AnyObject = msg_send![bundle, bundleIdentifier];
        let path: *mut AnyObject = msg_send![bundle, bundlePath];
        if identifier.is_null() || path.is_null() {
            return false;
        }
        let bytes: *const std::ffi::c_char = msg_send![path, UTF8String];
        !bytes.is_null() && CStr::from_ptr(bytes).to_string_lossy().ends_with(".app")
    });
    if !bundled {
        answer(Permission::Granted);
        return;
    }
    let Some(center_class) = class(c"UNUserNotificationCenter") else {
        answer(Permission::Unavailable);
        return;
    };
    let center: *mut AnyObject = unsafe { msg_send![center_class, currentNotificationCenter] };
    if center.is_null() {
        answer(Permission::Unavailable);
        return;
    }
    let answer: Mutex<RefCell<Option<Box<dyn FnOnce(Permission) + Send>>>> = Mutex::new(RefCell::new(Some(Box::new(answer))));
    let then = RcBlock::new(move |granted: Bool, _: *mut AnyObject| {
        let callback = answer.lock().ok().and_then(|cell| cell.borrow_mut().take());
        if let Some(callback) = callback {
            callback(if granted.as_bool() { Permission::Granted } else { Permission::Denied });
        }
    });
    // `UNAuthorizationOptionAlert | UNAuthorizationOptionSound`.
    let options: usize = 4 | 2;
    unsafe {
        let _: () = msg_send![center, requestAuthorizationWithOptions: options, completionHandler: &*then];
    }
}

#[cfg(not(target_os = "macos"))]
pub fn request(answer: impl FnOnce(Permission) + Send + 'static) {
    answer(if cfg!(target_family = "wasm") { Permission::Unavailable } else { Permission::Granted });
}
