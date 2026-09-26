#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
pub fn disable_macos_autofill_heuristics() {
   use objc::{
      class, msg_send,
      runtime::{NO, Object},
      sel, sel_impl,
   };
   use std::ffi::CString;

   // Disables macOS AutoFill heuristics in the app webview process.
   // This is known to reduce extra AutoFill subprocess activity.
   unsafe {
      let key_cstr = match CString::new("NSAutoFillHeuristicControllerEnabled") {
         Ok(value) => value,
         Err(_) => return,
      };

      let key: *mut Object = msg_send![class!(NSString), stringWithUTF8String: key_cstr.as_ptr()];
      if key.is_null() {
         return;
      }

      let user_defaults: *mut Object = msg_send![class!(NSUserDefaults), standardUserDefaults];
      if user_defaults.is_null() {
         return;
      }

      let existing_value: *mut Object = msg_send![user_defaults, objectForKey: key];
      if existing_value.is_null() {
         let false_value: *mut Object = msg_send![class!(NSNumber), numberWithBool: NO];
         if false_value.is_null() {
            return;
         }

         let _: () = msg_send![user_defaults, setObject: false_value forKey: key];
      }
   }
}

#[cfg(target_os = "macos")]
use crate::app_runtime::{AppHandle, AthasRuntime};
#[cfg(target_os = "macos")]
use objc::{
   class,
   declare::ClassDecl,
   msg_send,
   runtime::{self, Class, Imp, Object},
   sel, sel_impl,
};
#[cfg(target_os = "macos")]
use std::{
   ffi::{CStr, CString},
   mem,
   os::raw::{c_char, c_void},
   path::{Path, PathBuf},
   sync::{
      OnceLock,
      atomic::{AtomicPtr, Ordering},
   },
};
#[cfg(target_os = "macos")]
use tauri::Emitter;

#[cfg(target_os = "macos")]
static DOCK_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

#[cfg(target_os = "macos")]
static ACCESSIBILITY_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

#[cfg(target_os = "macos")]
static SPOTLIGHT_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

#[cfg(target_os = "macos")]
static SERVICES_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

#[cfg(target_os = "macos")]
static QUICK_LOOK_CONTROLLER: AtomicPtr<Object> = AtomicPtr::new(std::ptr::null_mut());

#[cfg(target_os = "macos")]
static QUICK_LOOK_URL: AtomicPtr<Object> = AtomicPtr::new(std::ptr::null_mut());

#[cfg(target_os = "macos")]
#[repr(C)]
struct NSPoint {
   x: f64,
   y: f64,
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct NSSize {
   width: f64,
   height: f64,
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct NSRect {
   origin: NSPoint,
   size: NSSize,
}

#[cfg(target_os = "macos")]
#[link(name = "Quartz", kind = "framework")]
unsafe extern "C" {}

#[cfg(target_os = "macos")]
#[link(name = "CoreSpotlight", kind = "framework")]
unsafe extern "C" {}

#[cfg(target_os = "macos")]
unsafe extern "C" {
   fn class_replaceMethod(
      class: *mut Class,
      selector: runtime::Sel,
      implementation: Imp,
      encoding: *const c_char,
   ) -> Imp;
   fn NSUpdateDynamicServices();
}

#[cfg(target_os = "macos")]
unsafe extern "C" fn dock_menu(
   delegate: *mut Object,
   _selector: runtime::Sel,
   _application: *mut Object,
) -> *mut Object {
   unsafe {
      let menu: *mut Object = msg_send![class!(NSMenu), alloc];
      let menu: *mut Object = msg_send![menu, initWithTitle: ns_string("")];
      let _: () = msg_send![menu, setAutoenablesItems: runtime::NO];

      let item: *mut Object = msg_send![class!(NSMenuItem), alloc];
      let item: *mut Object = msg_send![
         item,
         initWithTitle: ns_string("New Window")
         action: sel!(athasDockNewWindow:)
         keyEquivalent: ns_string("")
      ];
      let _: () = msg_send![item, setTarget: delegate];
      let _: () = msg_send![menu, addItem: item];
      let _: () = msg_send![item, release];

      msg_send![menu, autorelease]
   }
}

#[cfg(target_os = "macos")]
unsafe extern "C" fn dock_new_window(
   _delegate: *mut Object,
   _selector: runtime::Sel,
   _sender: *mut Object,
) {
   let Some(app) = DOCK_APP_HANDLE.get() else {
      return;
   };

   if let Err(error) = crate::commands::ui::window::create_app_window_internal(app, None) {
      log::error!("Failed to create window from macOS Dock menu: {error}");
   }
}

#[cfg(target_os = "macos")]
unsafe extern "C" fn accessibility_options_changed(
   _delegate: *mut Object,
   _selector: runtime::Sel,
   _notification: *mut Object,
) {
   if let Some(app) = ACCESSIBILITY_APP_HANDLE.get() {
      let _ = app.emit("system_accessibility_changed", ());
   }
}

#[cfg(target_os = "macos")]
unsafe extern "C" fn native_choice_sheet_did_end(
   _delegate: *mut Object,
   _selector: runtime::Sel,
   alert: *mut Object,
   response: isize,
   context: *mut c_void,
) {
   if context.is_null() {
      return;
   }

   let choice = match response {
      1000 => "primary",
      1001 => "secondary",
      _ => "cancel",
   };
   let sender =
      unsafe { Box::from_raw(context.cast::<tokio::sync::oneshot::Sender<&'static str>>()) };
   let _ = sender.send(choice);
   if !alert.is_null() {
      unsafe {
         let _: () = msg_send![alert, release];
      }
   }
}

#[cfg(target_os = "macos")]
unsafe extern "C" fn continue_spotlight_activity(
   _delegate: *mut Object,
   _selector: runtime::Sel,
   _application: *mut Object,
   user_activity: *mut Object,
   _restoration_handler: *mut c_void,
) -> runtime::BOOL {
   if user_activity.is_null() {
      return runtime::NO;
   }

   unsafe {
      let user_info: *mut Object = msg_send![user_activity, userInfo];
      let identifier: *mut Object = msg_send![
         user_info,
         objectForKey: ns_string("CSSearchableItemActivityIdentifier")
      ];
      if identifier.is_null() {
         return runtime::NO;
      }

      let bytes: *const c_char = msg_send![identifier, UTF8String];
      if bytes.is_null() {
         return runtime::NO;
      }
      let Ok(path) = CStr::from_ptr(bytes).to_str() else {
         return runtime::NO;
      };
      let Ok(url) = tauri::Url::from_file_path(path) else {
         return runtime::NO;
      };
      let Some(app) = SPOTLIGHT_APP_HANDLE.get() else {
         return runtime::NO;
      };

      crate::app_setup::handle_opened_urls(app, &[url]);
      runtime::YES
   }
}

#[cfg(target_os = "macos")]
unsafe extern "C" fn open_in_athas_service(
   _provider: *mut Object,
   _selector: runtime::Sel,
   pasteboard: *mut Object,
   _user_data: *mut Object,
   _error: *mut *mut Object,
) {
   if pasteboard.is_null() {
      return;
   }

   unsafe {
      let paths: *mut Object =
         msg_send![pasteboard, propertyListForType: ns_string("NSFilenamesPboardType")];
      if paths.is_null() {
         return;
      }

      let count: usize = msg_send![paths, count];
      let mut urls = Vec::with_capacity(count);
      for index in 0..count {
         let path: *mut Object = msg_send![paths, objectAtIndex: index];
         let bytes: *const c_char = msg_send![path, UTF8String];
         if bytes.is_null() {
            continue;
         }
         if let Ok(path) = CStr::from_ptr(bytes).to_str()
            && let Ok(url) = tauri::Url::from_file_path(path)
         {
            urls.push(url);
         }
      }

      if let Some(app) = SERVICES_APP_HANDLE.get()
         && !urls.is_empty()
      {
         crate::app_setup::handle_opened_urls(app, &urls);
      }
   }
}

#[cfg(target_os = "macos")]
unsafe fn ns_string(value: &str) -> *mut Object {
   let value = CString::new(value).expect("macOS text cannot contain null bytes");
   unsafe { msg_send![class!(NSString), stringWithUTF8String: value.as_ptr()] }
}

#[cfg(target_os = "macos")]
unsafe fn add_delegate_method(
   class: *mut Class,
   selector: runtime::Sel,
   implementation: Imp,
   encoding: &'static [u8],
) -> Result<(), String> {
   if unsafe { runtime::class_addMethod(class, selector, implementation, encoding.as_ptr().cast()) }
      == runtime::NO
      && unsafe { runtime::class_getInstanceMethod(class, selector) }.is_null()
   {
      return Err("Objective-C runtime rejected macOS delegate method".to_string());
   }

   Ok(())
}

#[cfg(target_os = "macos")]
pub fn install_dock_menu(app: &tauri::AppHandle<AthasRuntime>) -> Result<(), String> {
   let _ = DOCK_APP_HANDLE.set(app.clone());

   unsafe {
      let application: *mut Object = msg_send![class!(NSApplication), sharedApplication];
      if application.is_null() {
         return Err("NSApplication is unavailable".to_string());
      }

      let delegate: *mut Object = msg_send![application, delegate];
      if delegate.is_null() {
         return Err("NSApplication delegate is unavailable".to_string());
      }

      let delegate_class = runtime::object_getClass(delegate) as *mut Class;
      if delegate_class.is_null() {
         return Err("NSApplication delegate class is unavailable".to_string());
      }

      let _: Imp = class_replaceMethod(
         delegate_class,
         sel!(applicationDockMenu:),
         mem::transmute::<
            unsafe extern "C" fn(*mut Object, runtime::Sel, *mut Object) -> *mut Object,
            Imp,
         >(dock_menu),
         c"@@:@".as_ptr().cast(),
      );
      add_delegate_method(
         delegate_class,
         sel!(athasDockNewWindow:),
         mem::transmute::<unsafe extern "C" fn(*mut Object, runtime::Sel, *mut Object), Imp>(
            dock_new_window,
         ),
         b"v@:@\0",
      )?;

      let menu: *mut Object = msg_send![delegate, applicationDockMenu: application];
      let item_count: usize = msg_send![menu, numberOfItems];
      if item_count == 0 {
         return Err("macOS Dock menu delegate returned no items".to_string());
      }
   }

   Ok(())
}

#[cfg(target_os = "macos")]
pub fn install_accessibility_observer(app: &tauri::AppHandle<AthasRuntime>) -> Result<(), String> {
   let _ = ACCESSIBILITY_APP_HANDLE.set(app.clone());

   unsafe {
      let application: *mut Object = msg_send![class!(NSApplication), sharedApplication];
      let delegate: *mut Object = msg_send![application, delegate];
      if delegate.is_null() {
         return Err("NSApplication delegate is unavailable".to_string());
      }

      let delegate_class = runtime::object_getClass(delegate) as *mut Class;
      if delegate_class.is_null() {
         return Err("NSApplication delegate class is unavailable".to_string());
      }
      add_delegate_method(
         delegate_class,
         sel!(athasAccessibilityDisplayOptionsDidChange:),
         mem::transmute::<unsafe extern "C" fn(*mut Object, runtime::Sel, *mut Object), Imp>(
            accessibility_options_changed,
         ),
         b"v@:@\0",
      )?;

      let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
      let notification_center: *mut Object = msg_send![workspace, notificationCenter];
      if notification_center.is_null() {
         return Err("NSWorkspace notification center is unavailable".to_string());
      }

      let _: () = msg_send![
         notification_center,
         addObserver: delegate
         selector: sel!(athasAccessibilityDisplayOptionsDidChange:)
         name: ns_string("NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification")
         object: workspace
      ];
   }

   Ok(())
}

#[cfg(target_os = "macos")]
pub fn install_native_choice_sheet_handler() -> Result<(), String> {
   unsafe {
      let application: *mut Object = msg_send![class!(NSApplication), sharedApplication];
      let delegate: *mut Object = msg_send![application, delegate];
      if delegate.is_null() {
         return Err("NSApplication delegate is unavailable".to_string());
      }

      let delegate_class = runtime::object_getClass(delegate) as *mut Class;
      if delegate_class.is_null() {
         return Err("NSApplication delegate class is unavailable".to_string());
      }

      add_delegate_method(
         delegate_class,
         sel!(athasNativeChoiceSheetDidEnd:returnCode:contextInfo:),
         mem::transmute::<
            unsafe extern "C" fn(*mut Object, runtime::Sel, *mut Object, isize, *mut c_void),
            Imp,
         >(native_choice_sheet_did_end),
         b"v@:@q^v\0",
      )
   }
}

#[cfg(target_os = "macos")]
pub fn install_spotlight_activity_handler(
   app: &tauri::AppHandle<AthasRuntime>,
) -> Result<(), String> {
   let _ = SPOTLIGHT_APP_HANDLE.set(app.clone());

   unsafe {
      let application: *mut Object = msg_send![class!(NSApplication), sharedApplication];
      let delegate: *mut Object = msg_send![application, delegate];
      if delegate.is_null() {
         return Err("NSApplication delegate is unavailable".to_string());
      }

      let delegate_class = runtime::object_getClass(delegate) as *mut Class;
      if delegate_class.is_null() {
         return Err("NSApplication delegate class is unavailable".to_string());
      }

      add_delegate_method(
         delegate_class,
         sel!(application:continueUserActivity:restorationHandler:),
         mem::transmute::<
            unsafe extern "C" fn(
               *mut Object,
               runtime::Sel,
               *mut Object,
               *mut Object,
               *mut c_void,
            ) -> runtime::BOOL,
            Imp,
         >(continue_spotlight_activity),
         b"c@:@@@?\0",
      )
   }
}

#[cfg(target_os = "macos")]
pub fn install_services_provider(app: &tauri::AppHandle<AthasRuntime>) -> Result<(), String> {
   let _ = SERVICES_APP_HANDLE.set(app.clone());

   unsafe {
      let application: *mut Object = msg_send![class!(NSApplication), sharedApplication];
      let delegate: *mut Object = msg_send![application, delegate];
      if delegate.is_null() {
         return Err("NSApplication delegate is unavailable".to_string());
      }

      let delegate_class = runtime::object_getClass(delegate) as *mut Class;
      if delegate_class.is_null() {
         return Err("NSApplication delegate class is unavailable".to_string());
      }
      add_delegate_method(
         delegate_class,
         sel!(openInAthas:userData:error:),
         mem::transmute::<
            unsafe extern "C" fn(
               *mut Object,
               runtime::Sel,
               *mut Object,
               *mut Object,
               *mut *mut Object,
            ),
            Imp,
         >(open_in_athas_service),
         b"v@:@@^@\0",
      )?;

      let _: () = msg_send![application, setServicesProvider: delegate];
      NSUpdateDynamicServices();
   }

   Ok(())
}

#[cfg(target_os = "macos")]
pub fn show_share_picker(ns_view: *mut c_void, path: &Path) -> Result<(), String> {
   if ns_view.is_null() {
      return Err("NSView is unavailable".to_string());
   }
   let path = path
      .to_str()
      .ok_or_else(|| "Share path is not valid UTF-8".to_string())?;

   unsafe {
      let url: *mut Object = msg_send![
         class!(NSURL),
         fileURLWithPath: ns_string(path)
         isDirectory: false
      ];
      let items: *mut Object = msg_send![class!(NSArray), arrayWithObject: url];
      let picker: *mut Object = msg_send![class!(NSSharingServicePicker), alloc];
      let picker: *mut Object = msg_send![picker, initWithItems: items];
      if picker.is_null() {
         return Err("NSSharingServicePicker is unavailable".to_string());
      }

      let view = ns_view.cast::<Object>();
      let bounds: NSRect = msg_send![view, bounds];
      let anchor = NSRect {
         origin: NSPoint {
            x: bounds.size.width - 1.0,
            y: bounds.size.height - 1.0,
         },
         size: NSSize {
            width: 1.0,
            height: 1.0,
         },
      };
      let _: () = msg_send![
         picker,
         showRelativeToRect: anchor
         ofView: view
         preferredEdge: 3usize
      ];
      let _: *mut Object = msg_send![picker, autorelease];
   }

   Ok(())
}

#[cfg(target_os = "macos")]
pub fn show_native_choice_sheet(
   ns_window: *mut c_void,
   message: &str,
   informative_text: &str,
   primary_label: &str,
   secondary_label: &str,
   cancel_label: &str,
   sender: tokio::sync::oneshot::Sender<&'static str>,
) -> Result<(), String> {
   if ns_window.is_null() {
      return Err("NSWindow is unavailable".to_string());
   }

   unsafe {
      let application: *mut Object = msg_send![class!(NSApplication), sharedApplication];
      let delegate: *mut Object = msg_send![application, delegate];
      if delegate.is_null() {
         return Err("NSApplication delegate is unavailable".to_string());
      }

      let alert: *mut Object = msg_send![class!(NSAlert), alloc];
      let alert: *mut Object = msg_send![alert, init];
      if alert.is_null() {
         return Err("Failed to create native alert".to_string());
      }

      let _: () = msg_send![alert, setAlertStyle: 0isize];
      let _: () = msg_send![alert, setMessageText: ns_string(message)];
      let _: () = msg_send![alert, setInformativeText: ns_string(informative_text)];
      let _: *mut Object = msg_send![alert, addButtonWithTitle: ns_string(primary_label)];
      let _: *mut Object = msg_send![alert, addButtonWithTitle: ns_string(secondary_label)];
      let _: *mut Object = msg_send![alert, addButtonWithTitle: ns_string(cancel_label)];

      let context = Box::into_raw(Box::new(sender)).cast::<c_void>();
      let _: () = msg_send![
         alert,
         beginSheetModalForWindow: ns_window.cast::<Object>()
         modalDelegate: delegate
         didEndSelector: sel!(athasNativeChoiceSheetDidEnd:returnCode:contextInfo:)
         contextInfo: context
      ];
   }

   Ok(())
}

#[cfg(target_os = "macos")]
pub fn accessibility_preferences() -> Result<(bool, bool, bool, bool), String> {
   unsafe {
      let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
      if workspace.is_null() {
         return Err("NSWorkspace is unavailable".to_string());
      }

      let reduce_transparency: runtime::BOOL =
         msg_send![workspace, accessibilityDisplayShouldReduceTransparency];
      let increase_contrast: runtime::BOOL =
         msg_send![workspace, accessibilityDisplayShouldIncreaseContrast];
      let differentiate_without_color: runtime::BOOL = msg_send![
         workspace,
         accessibilityDisplayShouldDifferentiateWithoutColor
      ];
      let reduce_motion: runtime::BOOL =
         msg_send![workspace, accessibilityDisplayShouldReduceMotion];

      Ok((
         reduce_transparency == runtime::YES,
         increase_contrast == runtime::YES,
         differentiate_without_color == runtime::YES,
         reduce_motion == runtime::YES,
      ))
   }
}

#[cfg(target_os = "macos")]
pub fn note_recent_document(path: &Path) -> Result<(), String> {
   let is_directory = path.is_dir();
   let path = path
      .to_str()
      .ok_or_else(|| "Recent document path is not valid UTF-8".to_string())?;

   unsafe {
      let document_controller: *mut Object =
         msg_send![class!(NSDocumentController), sharedDocumentController];
      if document_controller.is_null() {
         return Err("NSDocumentController is unavailable".to_string());
      }

      let url: *mut Object = msg_send![
         class!(NSURL),
         fileURLWithPath: ns_string(path)
         isDirectory: is_directory
      ];
      if url.is_null() {
         return Err("Failed to create recent document URL".to_string());
      }

      let _: () = msg_send![document_controller, noteNewRecentDocumentURL: url];
   }

   if let Err(error) = index_spotlight_item(Path::new(path)) {
      log::warn!("Failed to index recent item in Spotlight: {error}");
   }

   Ok(())
}

#[cfg(target_os = "macos")]
fn index_spotlight_item(path: &Path) -> Result<(), String> {
   let path_text = path
      .to_str()
      .ok_or_else(|| "Spotlight path is not valid UTF-8".to_string())?;
   let display_name = path
      .file_name()
      .and_then(|name| name.to_str())
      .filter(|name| !name.is_empty())
      .unwrap_or(path_text);
   let content_type = if path.is_dir() {
      "public.folder"
   } else {
      "public.data"
   };
   let description = if path.is_dir() {
      "Recent Athas project"
   } else {
      "Recent Athas document"
   };

   unsafe {
      let attribute_set: *mut Object = msg_send![class!(CSSearchableItemAttributeSet), alloc];
      let attribute_set: *mut Object =
         msg_send![attribute_set, initWithItemContentType: ns_string(content_type)];
      if attribute_set.is_null() {
         return Err("Failed to create Spotlight attribute set".to_string());
      }

      let url: *mut Object = msg_send![
         class!(NSURL),
         fileURLWithPath: ns_string(path_text)
         isDirectory: path.is_dir()
      ];
      let _: () = msg_send![attribute_set, setTitle: ns_string(display_name)];
      let _: () = msg_send![attribute_set, setDisplayName: ns_string(display_name)];
      let _: () = msg_send![attribute_set, setContentDescription: ns_string(description)];
      let _: () = msg_send![attribute_set, setContentURL: url];

      let item: *mut Object = msg_send![class!(CSSearchableItem), alloc];
      let item: *mut Object = msg_send![
         item,
         initWithUniqueIdentifier: ns_string(path_text)
         domainIdentifier: ns_string("com.athas.recent-items")
         attributeSet: attribute_set
      ];
      let index: *mut Object = msg_send![class!(CSSearchableIndex), alloc];
      let index: *mut Object = msg_send![index, initWithName: ns_string("AthasRecentItems")];
      if item.is_null() || index.is_null() {
         let _: () = msg_send![attribute_set, release];
         return Err("Failed to create Spotlight index item".to_string());
      }

      let items: *mut Object = msg_send![class!(NSArray), arrayWithObject: item];
      let _: () = msg_send![
         index,
         indexSearchableItems: items
         completionHandler: std::ptr::null_mut::<c_void>()
      ];
      let _: () = msg_send![index, release];
      let _: () = msg_send![item, release];
      let _: () = msg_send![attribute_set, release];
   }

   Ok(())
}

#[cfg(target_os = "macos")]
pub fn recent_documents() -> Result<Vec<PathBuf>, String> {
   unsafe {
      let document_controller: *mut Object =
         msg_send![class!(NSDocumentController), sharedDocumentController];
      if document_controller.is_null() {
         return Err("NSDocumentController is unavailable".to_string());
      }

      let urls: *mut Object = msg_send![document_controller, recentDocumentURLs];
      if urls.is_null() {
         return Ok(Vec::new());
      }

      let count: usize = msg_send![urls, count];
      let mut paths = Vec::with_capacity(count);
      for index in 0..count {
         let url: *mut Object = msg_send![urls, objectAtIndex: index];
         let path: *mut Object = msg_send![url, path];
         if path.is_null() {
            continue;
         }

         let bytes: *const c_char = msg_send![path, UTF8String];
         if bytes.is_null() {
            continue;
         }

         if let Ok(path) = CStr::from_ptr(bytes).to_str() {
            paths.push(PathBuf::from(path));
         }
      }

      Ok(paths)
   }
}

#[cfg(target_os = "macos")]
pub fn clear_recent_documents() -> Result<(), String> {
   unsafe {
      let document_controller: *mut Object =
         msg_send![class!(NSDocumentController), sharedDocumentController];
      if document_controller.is_null() {
         return Err("NSDocumentController is unavailable".to_string());
      }

      let _: () =
         msg_send![document_controller, clearRecentDocuments: std::ptr::null_mut::<Object>()];
   }

   Ok(())
}

#[cfg(target_os = "macos")]
pub fn set_window_document_state(
   ns_window: *mut std::ffi::c_void,
   represented_path: Option<&Path>,
   is_edited: bool,
) -> Result<(), String> {
   if ns_window.is_null() {
      return Err("NSWindow is unavailable".to_string());
   }

   unsafe {
      let ns_window = ns_window.cast::<Object>();
      let _: () = msg_send![ns_window, setDocumentEdited: is_edited];

      let represented_url = if let Some(path) = represented_path {
         let path = path
            .to_str()
            .ok_or_else(|| "Represented document path is not valid UTF-8".to_string())?;
         let url: *mut Object = msg_send![
            class!(NSURL),
            fileURLWithPath: ns_string(path)
            isDirectory: false
         ];
         url
      } else {
         std::ptr::null_mut()
      };

      let _: () = msg_send![ns_window, setRepresentedURL: represented_url];
   }

   Ok(())
}

#[cfg(target_os = "macos")]
pub fn configure_window_tabbing(ns_window: *mut c_void) -> Result<(), String> {
   if ns_window.is_null() {
      return Err("NSWindow is unavailable".to_string());
   }

   unsafe {
      let _: () = msg_send![class!(NSWindow), setAllowsAutomaticWindowTabbing: runtime::YES];
      let ns_window = ns_window.cast::<Object>();
      let _: () = msg_send![ns_window, setTabbingMode: 1usize];
      let _: () = msg_send![ns_window, setTabbingIdentifier: ns_string("com.athas.workspace")];
   }

   Ok(())
}

#[cfg(target_os = "macos")]
pub fn perform_window_tab_action(ns_window: *mut c_void, action: &str) -> Result<(), String> {
   if ns_window.is_null() {
      return Err("NSWindow is unavailable".to_string());
   }

   unsafe {
      let ns_window = ns_window.cast::<Object>();
      match action {
         "next" => {
            let _: () = msg_send![ns_window, selectNextTab: std::ptr::null_mut::<Object>()];
         }
         "previous" => {
            let _: () = msg_send![ns_window, selectPreviousTab: std::ptr::null_mut::<Object>()];
         }
         "move" => {
            let _: () = msg_send![ns_window, moveTabToNewWindow: std::ptr::null_mut::<Object>()];
         }
         "merge" => {
            let _: () = msg_send![ns_window, mergeAllWindows: std::ptr::null_mut::<Object>()];
         }
         _ => return Err(format!("Unsupported macOS window tab action: {action}")),
      }
   }

   Ok(())
}

#[cfg(target_os = "macos")]
extern "C" fn quick_look_item_count(
   _controller: &Object,
   _selector: runtime::Sel,
   _panel: *mut Object,
) -> usize {
   usize::from(!QUICK_LOOK_URL.load(Ordering::Acquire).is_null())
}

#[cfg(target_os = "macos")]
extern "C" fn quick_look_item(
   _controller: &Object,
   _selector: runtime::Sel,
   _panel: *mut Object,
   _index: usize,
) -> *mut Object {
   QUICK_LOOK_URL.load(Ordering::Acquire)
}

#[cfg(target_os = "macos")]
fn quick_look_controller_class() -> &'static Class {
   if let Some(class) = Class::get("AthasQuickLookController") {
      return class;
   }

   let mut declaration = ClassDecl::new("AthasQuickLookController", class!(NSObject))
      .expect("failed to declare Quick Look data source");
   unsafe {
      declaration.add_method(
         sel!(numberOfPreviewItemsInPreviewPanel:),
         quick_look_item_count as extern "C" fn(&Object, runtime::Sel, *mut Object) -> usize,
      );
      declaration.add_method(
         sel!(previewPanel:previewItemAtIndex:),
         quick_look_item as extern "C" fn(&Object, runtime::Sel, *mut Object, usize) -> *mut Object,
      );
   }
   declaration.register()
}

#[cfg(target_os = "macos")]
pub fn toggle_quick_look(path: &Path) -> Result<(), String> {
   let path = path
      .to_str()
      .ok_or_else(|| "Quick Look path is not valid UTF-8".to_string())?;

   unsafe {
      let preview_panel_class =
         Class::get("QLPreviewPanel").ok_or_else(|| "QLPreviewPanel is unavailable".to_string())?;
      let panel: *mut Object = msg_send![preview_panel_class, sharedPreviewPanel];
      if panel.is_null() {
         return Err("Quick Look preview panel is unavailable".to_string());
      }

      let url: *mut Object = msg_send![
         class!(NSURL),
         fileURLWithPath: ns_string(path)
         isDirectory: false
      ];
      if url.is_null() {
         return Err("Failed to create Quick Look document URL".to_string());
      }

      let current_url = QUICK_LOOK_URL.load(Ordering::Acquire);
      let is_same_item = !current_url.is_null() && {
         let is_equal: runtime::BOOL = msg_send![current_url, isEqual: url];
         is_equal == runtime::YES
      };
      let is_visible: runtime::BOOL = msg_send![panel, isVisible];
      if is_same_item && is_visible == runtime::YES {
         let _: () = msg_send![panel, orderOut: std::ptr::null_mut::<Object>()];
         return Ok(());
      }

      let _: *mut Object = msg_send![url, retain];
      let previous_url = QUICK_LOOK_URL.swap(url, Ordering::AcqRel);
      if !previous_url.is_null() {
         let _: () = msg_send![previous_url, release];
      }

      let mut controller = QUICK_LOOK_CONTROLLER.load(Ordering::Acquire);
      if controller.is_null() {
         let controller_class = quick_look_controller_class();
         controller = msg_send![controller_class, new];
         if controller.is_null() {
            return Err("Failed to create Quick Look data source".to_string());
         }
         QUICK_LOOK_CONTROLLER.store(controller, Ordering::Release);
      }

      let _: () = msg_send![panel, setDataSource: controller];
      let _: () = msg_send![panel, reloadData];
      let _: () = msg_send![panel, setCurrentPreviewItemIndex: 0usize];
      let _: () = msg_send![panel, makeKeyAndOrderFront: std::ptr::null_mut::<Object>()];
   }

   Ok(())
}
