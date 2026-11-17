//! Agent notifications through `UNUserNotificationCenter`, carrying the session so clicking the
//! banner opens it (`extra.chatId` in `agent-native-notifications.ts`), and the Dock icon
//! bouncing while an agent waits on the user (`requestUserAttention`).
//!
//! `UNUserNotificationCenter` needs a bundle identifier, so only the app bundle uses it; a bare
//! binary (`target/release/athas`) keeps the `osascript` banner, which opens nothing.

use futures::StreamExt as _;
use gpui::App;

/// Whether banners go through the notification center, so a click can open the session.
pub fn available() -> bool {
    #[cfg(target_os = "macos")]
    return macos::bundled();
    #[cfg(not(target_os = "macos"))]
    false
}

/// Listens for clicks on the banners, also those shown before this launch; each opens its
/// session in front.
pub fn init(cx: &mut App) {
    if !available() {
        return;
    }
    let (sender, mut clicks) = futures::channel::mpsc::unbounded::<String>();
    #[cfg(target_os = "macos")]
    macos::listen(sender);
    #[cfg(not(target_os = "macos"))]
    drop(sender);
    cx.spawn(async move |cx| {
        while let Some(session) = clicks.next().await {
            cx.update(|cx| {
                cx.activate(true);
                workbench_api::request(cx, workbench_api::OpenRequest::Session { id: session });
            });
        }
    })
    .detach();
}

/// Shows a banner for `session`; `false` when the notification center is not available.
pub fn send(title: &str, body: &str, session: &str, sound: bool) -> bool {
    if !available() {
        return false;
    }
    #[cfg(target_os = "macos")]
    macos::send(title, body, session, sound);
    #[cfg(not(target_os = "macos"))]
    let _ = (title, body, session, sound);
    true
}

/// Bounces the Dock icon once (`UserAttentionType.Informational`).
pub fn request_attention() {
    #[cfg(target_os = "macos")]
    macos::request_attention();
}

#[cfg(target_os = "macos")]
mod macos {
    use std::{
        ffi::{CStr, CString, c_char},
        ptr,
        sync::Mutex,
    };

    use block2::{Block, RcBlock};
    use futures::channel::mpsc::UnboundedSender;
    use objc2::{
        ClassType as _, msg_send,
        runtime::{AnyClass, AnyObject, Bool, ClassBuilder, NSObject, Sel},
        sel,
    };

    #[link(name = "UserNotifications", kind = "framework")]
    unsafe extern "C" {}

    /// The key of the session in a banner's `userInfo`.
    const SESSION_KEY: &CStr = c"chatId";
    /// `UNAuthorizationOptionAlert | UNAuthorizationOptionSound`.
    const AUTHORIZATION_OPTIONS: usize = 4 | 2;
    /// `UNNotificationPresentationOptionList | UNNotificationPresentationOptionBanner |
    /// UNNotificationPresentationOptionSound`.
    const PRESENTATION_OPTIONS: usize = 8 | 16 | 2;
    /// `NSInformationalRequest`.
    const INFORMATIONAL_REQUEST: isize = 10;

    static CLICKS: Mutex<Option<UnboundedSender<String>>> = Mutex::new(None);

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

    extern "C" fn did_receive(_: *mut AnyObject, _: Sel, _: *mut AnyObject, response: *mut AnyObject, completion: *mut Block<dyn Fn()>) {
        unsafe {
            let notification: *mut AnyObject = msg_send![response, notification];
            let request: *mut AnyObject = if notification.is_null() { ptr::null_mut() } else { msg_send![notification, request] };
            let content: *mut AnyObject = if request.is_null() { ptr::null_mut() } else { msg_send![request, content] };
            let info: *mut AnyObject = if content.is_null() { ptr::null_mut() } else { msg_send![content, userInfo] };
            let session: *mut AnyObject = if info.is_null() { ptr::null_mut() } else { msg_send![info, objectForKey: ns_string(SESSION_KEY.to_str().unwrap_or_default())] };
            if let Some(session) = rust_string(session)
                && let Some(clicks) = CLICKS.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).as_ref()
            {
                let _ = clicks.unbounded_send(session);
            }
            if let Some(completion) = completion.as_ref() {
                completion.call(());
            }
        }
    }

    extern "C" fn will_present(_: *mut AnyObject, _: Sel, _: *mut AnyObject, _: *mut AnyObject, completion: *mut Block<dyn Fn(usize)>) {
        if let Some(completion) = unsafe { completion.as_ref() } {
            completion.call((PRESENTATION_OPTIONS,));
        }
    }

    /// Makes the notification center's delegate, which hands clicked sessions to `clicks`.
    pub fn listen(clicks: UnboundedSender<String>) {
        *CLICKS.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(clicks);
        let center = center();
        if center.is_null() {
            return;
        }
        let Some(mut builder) = ClassBuilder::new(c"AthasNotificationDelegate", NSObject::class()) else { return };
        unsafe {
            builder.add_method(
                sel!(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:),
                did_receive as extern "C" fn(*mut AnyObject, Sel, *mut AnyObject, *mut AnyObject, *mut Block<dyn Fn()>),
            );
            builder.add_method(
                sel!(userNotificationCenter:willPresentNotification:withCompletionHandler:),
                will_present as extern "C" fn(*mut AnyObject, Sel, *mut AnyObject, *mut AnyObject, *mut Block<dyn Fn(usize)>),
            );
            let delegate_class = builder.register();
            // The center holds its delegate weakly; this one lives as long as the app.
            let delegate: *mut AnyObject = msg_send![delegate_class, new];
            let _: () = msg_send![center, setDelegate: delegate];
        }
    }

    /// Asks for permission (once; later calls answer at once), then adds the banner.
    pub fn send(title: &str, body: &str, session: &str, sound: bool) {
        let center = center();
        if center.is_null() {
            return;
        }
        let (title, body, session) = (title.to_string(), body.to_string(), session.to_string());
        let center_address = center as usize;
        let then = RcBlock::new(move |granted: Bool, _: *mut AnyObject| {
            if granted.as_bool() {
                unsafe { add_request(center_address as *mut AnyObject, &title, &body, &session, sound) };
            }
        });
        unsafe {
            let _: () = msg_send![center, requestAuthorizationWithOptions: AUTHORIZATION_OPTIONS, completionHandler: &*then];
        }
    }

    unsafe fn add_request(center: *mut AnyObject, title: &str, body: &str, session: &str, sound: bool) {
        let (Some(content_class), Some(request_class), Some(dictionary_class)) =
            (class(c"UNMutableNotificationContent"), class(c"UNNotificationRequest"), class(c"NSDictionary"))
        else {
            return;
        };
        unsafe {
            let content: *mut AnyObject = msg_send![content_class, new];
            let _: () = msg_send![content, setTitle: ns_string(title)];
            let _: () = msg_send![content, setBody: ns_string(body)];
            let _: () = msg_send![content, setThreadIdentifier: ns_string("athas-agent")];
            let info: *mut AnyObject = msg_send![dictionary_class, dictionaryWithObject: ns_string(session), forKey: ns_string(SESSION_KEY.to_str().unwrap_or_default())];
            let _: () = msg_send![content, setUserInfo: info];
            if sound && let Some(sound_class) = class(c"UNNotificationSound") {
                let sound: *mut AnyObject = msg_send![sound_class, defaultSound];
                let _: () = msg_send![content, setSound: sound];
            }
            let identifier = format!("athas-agent-{session}-{}", web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map_or(0, |time| time.as_millis()));
            let trigger: *mut AnyObject = ptr::null_mut();
            let request: *mut AnyObject = msg_send![request_class, requestWithIdentifier: ns_string(&identifier), content: content, trigger: trigger];
            let done: *mut Block<dyn Fn(*mut AnyObject)> = ptr::null_mut();
            let _: () = msg_send![center, addNotificationRequest: request, withCompletionHandler: done];
            let _: () = msg_send![content, release];
        }
    }

    pub fn request_attention() {
        let Some(app_class) = class(c"NSApplication") else { return };
        unsafe {
            let app: *mut AnyObject = msg_send![app_class, sharedApplication];
            if !app.is_null() {
                let _: isize = msg_send![app, requestUserAttention: INFORMATIONAL_REQUEST];
            }
        }
    }
}
