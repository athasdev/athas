use std::cell::RefCell;

use wry::{WebView, WebViewExtMacOS};

/// The running macOS major version, `0` when it can't be read.
pub fn major_version() -> u64 {
    let version = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
    version.majorVersion.max(0) as u64
}

/// Rounds the corners of a page so it sits inside the slot's rounded frame.
pub fn round_corners(webview: &WebView, radius: f64) {
    use objc2::{msg_send, runtime::AnyObject};

    let view = webview.webview();
    let view = objc2::rc::Retained::as_ptr(&view) as *mut AnyObject;
    // SAFETY: `view` is the live WKWebView that `webview` owns, and this runs on the main thread.
    unsafe {
        let view = &*view;
        let _: () = msg_send![view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![view, layer];
        let Some(layer) = layer.as_ref() else { return };
        let _: () = msg_send![layer, setCornerRadius: radius];
        let _: () = msg_send![layer, setMasksToBounds: true];
    }
}

/// Lifts WebKit's 60 FPS cap on a page so it follows the display's refresh rate on 120 Hz
/// ProMotion displays, like Safari does: turns off the private
/// `PreferPageRenderingUpdatesNear60FPSEnabled` feature. Does nothing when this WebKit lacks the
/// private API.
///
/// Ported from Athas's `src-tauri/src/refresh_rate.rs`.
pub fn unlock_refresh_rate(webview: &WebView) {
    use std::ffi::{CStr, c_char};

    use objc2::{class, msg_send, runtime::{AnyObject, Bool}, sel};

    const FEATURE: &CStr = c"PreferPageRenderingUpdatesNear60FPSEnabled";

    let view = webview.webview();
    let view = objc2::rc::Retained::as_ptr(&view) as *mut AnyObject;
    // SAFETY: `view` is the live WKWebView that `webview` owns, and this runs on the main thread.
    // Every private selector is checked with `respondsToSelector:` or comes from WebKit's own
    // feature list.
    unsafe {
        let view = &*view;
        let configuration: *mut AnyObject = msg_send![view, configuration];
        let Some(configuration) = configuration.as_ref() else { return };
        let preferences: *mut AnyObject = msg_send![configuration, preferences];
        let Some(preferences) = preferences.as_ref() else { return };
        let supported: Bool = msg_send![preferences, respondsToSelector: sel!(_setEnabled:forFeature:)];
        if !supported.as_bool() {
            return;
        }
        let class = class!(WKPreferences);
        let lists_features: Bool = msg_send![class, respondsToSelector: sel!(_features)];
        if !lists_features.as_bool() {
            return;
        }
        let features: *mut AnyObject = msg_send![class, _features];
        let Some(features) = features.as_ref() else { return };
        let count: usize = msg_send![features, count];
        for index in 0..count {
            let feature: *mut AnyObject = msg_send![features, objectAtIndex: index];
            let Some(feature) = feature.as_ref() else { continue };
            let key: *mut AnyObject = msg_send![feature, key];
            let Some(key) = key.as_ref() else { continue };
            let name: *const c_char = msg_send![key, UTF8String];
            if !name.is_null() && CStr::from_ptr(name) == FEATURE {
                let _: () = msg_send![preferences, _setEnabled: Bool::NO, forFeature: feature];
                return;
            }
        }
    }
}

/// Captures what a page shows right now as a JPEG and hands it to `done`, or `None` when the
/// capture fails.
pub fn capture_snapshot(webview: &WebView, done: impl FnOnce(Option<Vec<u8>>) + 'static) {
    use block2::RcBlock;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSBitmapImageRepPropertyKey, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    use objc2_web_kit::WKSnapshotConfiguration;

    let done = RefCell::new(Some(done));
    let handler = RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
        // SAFETY: WebKit passes a valid image or null.
        let bytes = unsafe { image.as_ref() }.and_then(|image| {
            let tiff = image.TIFFRepresentation()?;
            let bitmap = NSBitmapImageRep::imageRepWithData(&tiff)?;
            let properties = NSDictionary::<NSBitmapImageRepPropertyKey, objc2::runtime::AnyObject>::new();
            // SAFETY: an empty property dictionary is valid for every file type.
            let jpeg = unsafe { bitmap.representationUsingType_properties(NSBitmapImageFileType::JPEG, &properties) }?;
            Some(jpeg.to_vec())
        });
        if let Some(done) = done.borrow_mut().take() {
            done(bytes);
        }
    });

    let Some(main_thread) = objc2::MainThreadMarker::new() else { return };
    let view = webview.webview();
    // SAFETY: this runs on the main thread with the live WKWebView `webview` owns. Capturing the
    // last rendered frame avoids waiting for a new one.
    unsafe {
        let configuration = WKSnapshotConfiguration::new(main_thread);
        configuration.setAfterScreenUpdates(false);
        view.takeSnapshotWithConfiguration_completionHandler(Some(&configuration), &handler);
    }
}

/// Writes `cookies` into the website data store of the browser profile `identifier`, without a
/// page open on it, then reads the store back and calls `done` with how many of them it holds.
pub fn set_cookies(identifier: [u8; 16], cookies: &[crate::profile::import::Cookie], done: impl FnOnce(usize) + 'static) {
    use std::rc::Rc;

    use block2::RcBlock;
    use objc2::{rc::Retained, runtime::AnyObject};
    use objc2_foundation::{
        NSArray, NSDate, NSHTTPCookie, NSHTTPCookieDiscard, NSHTTPCookieDomain, NSHTTPCookieExpires, NSHTTPCookieName, NSHTTPCookiePath,
        NSHTTPCookiePropertyKey, NSHTTPCookieSecure, NSHTTPCookieValue, NSMutableDictionary, NSString, NSUUID, ns_string,
    };
    use objc2_web_kit::WKWebsiteDataStore;

    use crate::profile::import::SameSite;

    let Some(main_thread) = objc2::MainThreadMarker::new() else {
        done(0);
        return;
    };
    // SAFETY: on the main thread, with property dictionaries of NSString and NSDate values as
    // NSHTTPCookie documents them; the completion blocks run on the main thread.
    unsafe {
        let store = if major_version() >= 14 {
            WKWebsiteDataStore::dataStoreForIdentifier(&NSUUID::from_bytes(identifier), main_thread)
        } else {
            WKWebsiteDataStore::defaultDataStore(main_thread)
        };
        let made: Vec<Retained<NSHTTPCookie>> = cookies
            .iter()
            .filter_map(|cookie| {
                let name = NSString::from_str(&cookie.name);
                let value = NSString::from_str(&cookie.value);
                let domain = NSString::from_str(&cookie.domain);
                let path = NSString::from_str(&cookie.path);
                let properties: Retained<NSMutableDictionary<NSHTTPCookiePropertyKey, AnyObject>> = NSMutableDictionary::from_slices(
                    &[NSHTTPCookieName, NSHTTPCookieValue, NSHTTPCookieDomain, NSHTTPCookiePath],
                    &[&*name as &AnyObject, &*value, &*domain, &*path],
                );
                match cookie.expires {
                    Some(expires) => properties.insert(NSHTTPCookieExpires, &*NSDate::dateWithTimeIntervalSince1970(expires as f64)),
                    None => properties.insert(NSHTTPCookieDiscard, ns_string!("TRUE")),
                }
                if cookie.secure {
                    properties.insert(NSHTTPCookieSecure, ns_string!("TRUE"));
                }
                if cookie.http_only {
                    properties.insert(ns_string!("HttpOnly"), ns_string!("TRUE"));
                }
                match cookie.same_site {
                    Some(SameSite::Lax) => properties.insert(ns_string!("SameSite"), ns_string!("lax")),
                    Some(SameSite::Strict) => properties.insert(ns_string!("SameSite"), ns_string!("strict")),
                    _ => {}
                }
                NSHTTPCookie::cookieWithProperties(&properties)
            })
            .collect();
        let total = made.len();
        if total < cookies.len() {
            log::warn!("[browser-import] the system refused {} of {} cookies", cookies.len() - total, cookies.len());
        }
        if total == 0 {
            done(0);
            return;
        }
        let wanted: std::collections::HashSet<(String, String, String)> =
            made.iter().map(|cookie| (cookie.name().to_string(), cookie.domain().to_string(), cookie.path().to_string())).collect();
        let cookie_store = store.httpCookieStore();
        let progress = Rc::new(RefCell::new((0usize, Some(done))));
        for cookie in made {
            let progress = progress.clone();
            let check_store = cookie_store.clone();
            let wanted = wanted.clone();
            let stored = RcBlock::new(move || {
                let finished = {
                    let mut progress = progress.borrow_mut();
                    progress.0 += 1;
                    if progress.0 == total { progress.1.take() } else { None }
                };
                let Some(done) = finished else { return };
                // Count what the store holds now, so the result says what took.
                let done = RefCell::new(Some(done));
                let wanted = wanted.clone();
                let read = RcBlock::new(move |all: std::ptr::NonNull<NSArray<NSHTTPCookie>>| {
                    let held = all
                        .as_ref()
                        .iter()
                        .filter(|cookie| wanted.contains(&(cookie.name().to_string(), cookie.domain().to_string(), cookie.path().to_string())))
                        .count();
                    log::info!("[browser-import] wrote {total} cookies; the store holds {held} of them");
                    if let Some(done) = done.borrow_mut().take() {
                        done(held);
                    }
                });
                check_store.getAllCookies(&read);
            });
            cookie_store.setCookie_completionHandler(&cookie, Some(&stored));
        }
    }
}
