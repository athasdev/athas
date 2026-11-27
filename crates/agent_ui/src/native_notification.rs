//! Agent notifications through `UNUserNotificationCenter`, carrying the session so clicking the
//! banner opens it (`extra.chatId` in `agent-native-notifications.ts`), the follow-up actions of
//! the answer as buttons that send their prompt back to that session, and the Dock icon bouncing
//! while an agent waits on the user (`requestUserAttention`).
//!
//! `UNUserNotificationCenter` needs a bundle identifier, so only the app bundle uses it; a bare
//! binary (`target/release/athas`) keeps the `osascript` banner, which has no buttons and opens
//! nothing.

use futures::StreamExt as _;
use gpui::App;

use crate::attention::Action;

/// What one banner says, and what its buttons do.
pub struct Banner<'a> {
    /// The first line: which session this is about.
    pub title: &'a str,
    /// The second line: what happened, and where.
    pub subtitle: &'a str,
    /// The words of the event itself.
    pub body: &'a str,
    pub session: &'a str,
    pub sound: bool,
    /// Buttons, each sending its prompt to the session.
    pub actions: &'a [Action],
}

/// A click on a banner: the session it was about, and the prompt of the button that was pressed.
struct Click {
    session: String,
    prompt: Option<String>,
}

/// Whether banners go through the notification center, so a click can open the session.
pub fn available() -> bool {
    #[cfg(target_os = "macos")]
    return macos::bundled();
    #[cfg(not(target_os = "macos"))]
    false
}

/// Listens for clicks on the banners, also those shown before this launch; each opens its
/// session in front, and one on a follow-up button sends that prompt once the session is up.
pub fn init(cx: &mut App) {
    if !available() {
        return;
    }
    let (sender, mut clicks) = futures::channel::mpsc::unbounded::<Click>();
    #[cfg(target_os = "macos")]
    macos::listen(sender);
    #[cfg(not(target_os = "macos"))]
    drop(sender);
    cx.spawn(async move |cx| {
        while let Some(click) = clicks.next().await {
            cx.update(|cx| {
                cx.activate(true);
                workbench_api::request(cx, workbench_api::OpenRequest::Session { id: click.session.clone() });
                if let Some(prompt) = click.prompt {
                    crate::session_view::deliver_prompt(click.session, prompt, cx);
                }
            });
        }
    })
    .detach();
}

/// Shows `banner`; `false` when the notification center is not available.
pub fn send(banner: &Banner) -> bool {
    if !available() {
        return false;
    }
    #[cfg(target_os = "macos")]
    macos::send(banner);
    #[cfg(not(target_os = "macos"))]
    let _ = banner;
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
        collections::hash_map::DefaultHasher,
        ffi::{CStr, CString, c_char},
        hash::{Hash as _, Hasher as _},
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

    use super::{Banner, Click};
    use crate::attention::Action;

    #[link(name = "UserNotifications", kind = "framework")]
    unsafe extern "C" {}

    /// The key of the session in a banner's `userInfo`.
    const SESSION_KEY: &str = "chatId";
    /// The prompt of button `n` lives under `prompt-<n>`, so a click carries what to send.
    fn prompt_key(index: usize) -> String {
        format!("prompt-{index}")
    }
    /// `UNAuthorizationOptionAlert | UNAuthorizationOptionSound`.
    const AUTHORIZATION_OPTIONS: usize = 4 | 2;
    /// `UNNotificationPresentationOptionList | UNNotificationPresentationOptionBanner |
    /// UNNotificationPresentationOptionSound`.
    const PRESENTATION_OPTIONS: usize = 8 | 16 | 2;
    /// `UNNotificationActionOptionForeground`: pressing a button brings Athas up.
    const ACTION_FOREGROUND: usize = 1 << 2;
    /// `NSInformationalRequest`.
    const INFORMATIONAL_REQUEST: isize = 10;
    /// A press on the banner itself rather than on one of its buttons.
    const DEFAULT_ACTION: &str = "com.apple.UNNotificationDefaultActionIdentifier";
    /// The banner was swept away; the user asked for nothing.
    const DISMISS_ACTION: &str = "com.apple.UNNotificationDismissActionIdentifier";
    /// How many sets of buttons stay registered, so banners still in the Notification Center keep
    /// theirs: the center knows only the categories handed to it last.
    const KEPT_CATEGORIES: usize = 8;

    static CLICKS: Mutex<Option<UnboundedSender<Click>>> = Mutex::new(None);
    /// The categories registered so far, newest last: an identifier and its button labels.
    static CATEGORIES: Mutex<Vec<(String, Vec<String>)>> = Mutex::new(Vec::new());

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

    /// Reads a string out of a notification's `userInfo`.
    unsafe fn info_string(info: *mut AnyObject, key: &str) -> Option<String> {
        if info.is_null() {
            return None;
        }
        unsafe {
            let value: *mut AnyObject = msg_send![info, objectForKey: ns_string(key)];
            rust_string(value)
        }
    }

    extern "C" fn did_receive(_: *mut AnyObject, _: Sel, _: *mut AnyObject, response: *mut AnyObject, completion: *mut Block<dyn Fn()>) {
        unsafe {
            let notification: *mut AnyObject = msg_send![response, notification];
            let request: *mut AnyObject = if notification.is_null() { ptr::null_mut() } else { msg_send![notification, request] };
            let content: *mut AnyObject = if request.is_null() { ptr::null_mut() } else { msg_send![request, content] };
            let info: *mut AnyObject = if content.is_null() { ptr::null_mut() } else { msg_send![content, userInfo] };
            let pressed: *mut AnyObject = msg_send![response, actionIdentifier];
            let pressed = rust_string(pressed).unwrap_or_else(|| DEFAULT_ACTION.to_string());
            // A button sends its prompt; the banner itself only opens the session.
            let prompt = pressed.strip_prefix("athas-action-").and_then(|index| index.parse::<usize>().ok()).and_then(|index| info_string(info, &prompt_key(index)));
            if pressed != DISMISS_ACTION
                && let Some(session) = info_string(info, SESSION_KEY)
                && let Some(clicks) = CLICKS.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).as_ref()
            {
                let _ = clicks.unbounded_send(Click { session, prompt });
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
    pub fn listen(clicks: UnboundedSender<Click>) {
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
    pub fn send(banner: &Banner) {
        let center = center();
        if center.is_null() {
            return;
        }
        let (title, subtitle, body, session) = (banner.title.to_string(), banner.subtitle.to_string(), banner.body.to_string(), banner.session.to_string());
        let (sound, actions) = (banner.sound, banner.actions.to_vec());
        let center_address = center as usize;
        let then = RcBlock::new(move |granted: Bool, _: *mut AnyObject| {
            if granted.as_bool() {
                unsafe { add_request(center_address as *mut AnyObject, &title, &subtitle, &body, &session, sound, &actions) };
            }
        });
        unsafe {
            let _: () = msg_send![center, requestAuthorizationWithOptions: AUTHORIZATION_OPTIONS, completionHandler: &*then];
        }
    }

    /// Registers a category whose buttons are `labels` and returns its identifier. The center
    /// keeps only the categories it was last given, so the newest few are handed over together.
    unsafe fn register_category(center: *mut AnyObject, labels: &[String]) -> Option<String> {
        let (Some(action_class), Some(category_class), Some(array_class), Some(set_class)) =
            (class(c"UNNotificationAction"), class(c"UNNotificationCategory"), class(c"NSMutableArray"), class(c"NSSet"))
        else {
            return None;
        };
        let mut hasher = DefaultHasher::new();
        labels.hash(&mut hasher);
        let identifier = format!("athas-followups-{:x}", hasher.finish());
        {
            let mut kept = CATEGORIES.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            kept.retain(|(known, _)| *known != identifier);
            kept.push((identifier.clone(), labels.to_vec()));
            let extra = kept.len().saturating_sub(KEPT_CATEGORIES);
            kept.drain(..extra);
        }
        let kept = CATEGORIES.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone();
        unsafe {
            let categories: *mut AnyObject = msg_send![array_class, array];
            for (identifier, labels) in &kept {
                let buttons: *mut AnyObject = msg_send![array_class, array];
                for (index, label) in labels.iter().enumerate() {
                    let action: *mut AnyObject =
                        msg_send![action_class, actionWithIdentifier: ns_string(&format!("athas-action-{index}")), title: ns_string(label), options: ACTION_FOREGROUND];
                    let _: () = msg_send![buttons, addObject: action];
                }
                let empty: *mut AnyObject = msg_send![array_class, array];
                let category: *mut AnyObject =
                    msg_send![category_class, categoryWithIdentifier: ns_string(identifier), actions: buttons, intentIdentifiers: empty, options: 0usize];
                let _: () = msg_send![categories, addObject: category];
            }
            let set: *mut AnyObject = msg_send![set_class, setWithArray: categories];
            let _: () = msg_send![center, setNotificationCategories: set];
        }
        Some(identifier)
    }

    unsafe fn add_request(center: *mut AnyObject, title: &str, subtitle: &str, body: &str, session: &str, sound: bool, actions: &[Action]) {
        let (Some(content_class), Some(request_class), Some(dictionary_class)) =
            (class(c"UNMutableNotificationContent"), class(c"UNNotificationRequest"), class(c"NSMutableDictionary"))
        else {
            return;
        };
        unsafe {
            let content: *mut AnyObject = msg_send![content_class, new];
            let _: () = msg_send![content, setTitle: ns_string(title)];
            if !subtitle.is_empty() {
                let _: () = msg_send![content, setSubtitle: ns_string(subtitle)];
            }
            let _: () = msg_send![content, setBody: ns_string(body)];
            let _: () = msg_send![content, setThreadIdentifier: ns_string("athas-agent")];
            let info: *mut AnyObject = msg_send![dictionary_class, dictionary];
            let _: () = msg_send![info, setObject: ns_string(session), forKey: ns_string(SESSION_KEY)];
            for (index, action) in actions.iter().enumerate() {
                let _: () = msg_send![info, setObject: ns_string(&action.prompt), forKey: ns_string(&prompt_key(index))];
            }
            let _: () = msg_send![content, setUserInfo: info];
            if !actions.is_empty() {
                let labels: Vec<String> = actions.iter().map(|action| action.label.clone()).collect();
                if let Some(category) = register_category(center, &labels) {
                    let _: () = msg_send![content, setCategoryIdentifier: ns_string(&category)];
                }
            }
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
