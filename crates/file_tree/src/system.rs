//! Quick Look and the Share menu for a file (`toggle_quick_look` and `show_share_picker` in
//! Athas's `bootstrap/macos.rs`).

use std::{
    ffi::c_void,
    path::Path,
    sync::atomic::{AtomicPtr, Ordering},
};

use anyhow::{Result, anyhow, bail};
use objc2::{
    ClassType as _, msg_send,
    rc::{Allocated, Retained},
    runtime::{AnyClass, AnyObject, Bool, ClassBuilder, NSObject, Sel},
    sel,
};
use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, NSString, NSURL};

#[link(name = "Quartz", kind = "framework")]
unsafe extern "C" {}

/// The file Quick Look shows, retained while the panel may ask for it.
static QUICK_LOOK_URL: AtomicPtr<AnyObject> = AtomicPtr::new(std::ptr::null_mut());
static QUICK_LOOK_CONTROLLER: AtomicPtr<AnyObject> = AtomicPtr::new(std::ptr::null_mut());

extern "C" fn quick_look_item_count(_: *mut AnyObject, _: Sel, _: *mut AnyObject) -> usize {
    usize::from(!QUICK_LOOK_URL.load(Ordering::Acquire).is_null())
}

extern "C" fn quick_look_item(_: *mut AnyObject, _: Sel, _: *mut AnyObject, _: usize) -> *mut AnyObject {
    QUICK_LOOK_URL.load(Ordering::Acquire)
}

fn quick_look_controller_class() -> &'static AnyClass {
    if let Some(class) = AnyClass::get(c"AthasQuickLookController") {
        return class;
    }
    let mut builder = ClassBuilder::new(c"AthasQuickLookController", NSObject::class()).expect("declaring the Quick Look data source");
    unsafe {
        builder.add_method(
            sel!(numberOfPreviewItemsInPreviewPanel:),
            quick_look_item_count as extern "C" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize,
        );
        builder.add_method(
            sel!(previewPanel:previewItemAtIndex:),
            quick_look_item as extern "C" fn(*mut AnyObject, Sel, *mut AnyObject, usize) -> *mut AnyObject,
        );
    }
    builder.register()
}

fn file_url(path: &Path) -> Result<Retained<NSURL>> {
    let path = path.to_str().ok_or_else(|| anyhow!("The path is not valid UTF-8"))?;
    Ok(NSURL::fileURLWithPath_isDirectory(&NSString::from_str(path), false))
}

/// Opens the Quick Look panel on `path`, or closes it when it already shows that file.
pub fn toggle_quick_look(path: &Path) -> Result<()> {
    if !path.is_file() {
        bail!("Quick Look is only available for local files");
    }
    let url = file_url(path)?;
    unsafe {
        let panel_class = AnyClass::get(c"QLPreviewPanel").ok_or_else(|| anyhow!("QLPreviewPanel is unavailable"))?;
        let panel: *mut AnyObject = msg_send![panel_class, sharedPreviewPanel];
        if panel.is_null() {
            bail!("Quick Look preview panel is unavailable");
        }
        let current = QUICK_LOOK_URL.load(Ordering::Acquire);
        let same_item = !current.is_null() && {
            let equal: Bool = msg_send![current, isEqual: &*url];
            equal.as_bool()
        };
        let visible: Bool = msg_send![panel, isVisible];
        if same_item && visible.as_bool() {
            let _: () = msg_send![panel, orderOut: std::ptr::null_mut::<AnyObject>()];
            return Ok(());
        }

        let previous = QUICK_LOOK_URL.swap(Retained::into_raw(url).cast(), Ordering::AcqRel);
        if !previous.is_null() {
            drop(Retained::from_raw(previous.cast::<NSURL>()));
        }
        let mut controller = QUICK_LOOK_CONTROLLER.load(Ordering::Acquire);
        if controller.is_null() {
            let created: Option<Retained<AnyObject>> = msg_send![quick_look_controller_class(), new];
            controller = created.map(Retained::into_raw).ok_or_else(|| anyhow!("Failed to create the Quick Look data source"))?;
            QUICK_LOOK_CONTROLLER.store(controller, Ordering::Release);
        }
        let _: () = msg_send![panel, setDataSource: controller];
        let _: () = msg_send![panel, reloadData];
        let _: () = msg_send![panel, setCurrentPreviewItemIndex: 0isize];
        let _: () = msg_send![panel, makeKeyAndOrderFront: std::ptr::null_mut::<AnyObject>()];
    }
    Ok(())
}

/// Shows the system Share menu for `path`, anchored at the window's top-right corner as in Athas.
pub fn show_share_picker(ns_view: *mut c_void, path: &Path) -> Result<()> {
    if ns_view.is_null() {
        bail!("The window's view is unavailable");
    }
    if !path.is_file() {
        bail!("Share is only available for local files");
    }
    let url = file_url(path)?;
    unsafe {
        let items = NSArray::from_retained_slice(&[url]);
        let picker_class = AnyClass::get(c"NSSharingServicePicker").ok_or_else(|| anyhow!("NSSharingServicePicker is unavailable"))?;
        let picker: Allocated<AnyObject> = msg_send![picker_class, alloc];
        let picker: Option<Retained<AnyObject>> = msg_send![picker, initWithItems: &*items];
        let picker = picker.ok_or_else(|| anyhow!("NSSharingServicePicker is unavailable"))?;
        let view = ns_view.cast::<AnyObject>();
        let bounds: NSRect = msg_send![view, bounds];
        let anchor = NSRect::new(NSPoint::new(bounds.size.width - 1., bounds.size.height - 1.), NSSize::new(1., 1.));
        let _: () = msg_send![&*picker, showRelativeToRect: anchor, ofView: view, preferredEdge: 3usize];
    }
    Ok(())
}

/// The dragging source of drags out of the tree: other apps may copy what it offers.
static FILE_DRAG_SOURCE: AtomicPtr<AnyObject> = AtomicPtr::new(std::ptr::null_mut());

extern "C" fn file_drag_operations(_: *mut AnyObject, _: Sel, _: *mut AnyObject, _: isize) -> usize {
    // NSDragOperationCopy
    1
}

fn file_drag_source() -> Result<*mut AnyObject> {
    let source = FILE_DRAG_SOURCE.load(Ordering::Acquire);
    if !source.is_null() {
        return Ok(source);
    }
    let class = match AnyClass::get(c"AthasFileDragSource") {
        Some(class) => class,
        None => {
            let mut builder = ClassBuilder::new(c"AthasFileDragSource", NSObject::class()).ok_or_else(|| anyhow!("Could not declare the drag source"))?;
            if let Some(protocol) = objc2::runtime::AnyProtocol::get(c"NSDraggingSource") {
                builder.add_protocol(protocol);
            }
            unsafe {
                builder.add_method(
                    sel!(draggingSession:sourceOperationMaskForDraggingContext:),
                    file_drag_operations as extern "C" fn(*mut AnyObject, Sel, *mut AnyObject, isize) -> usize,
                );
            }
            builder.register()
        }
    };
    let created: Option<Retained<AnyObject>> = unsafe { msg_send![class, new] };
    let source = created.map(Retained::into_raw).ok_or_else(|| anyhow!("Could not create the drag source"))?;
    FILE_DRAG_SOURCE.store(source, Ordering::Release);
    Ok(source)
}

/// Hands `paths` to the system as a file drag from where the pointer is, so Finder, Terminal,
/// Mail or any other app can take them (`startNativeFileDrag`). Runs inside the mouse-dragged
/// event that left the window.
pub fn start_file_drag(ns_view: *mut c_void, paths: &[std::path::PathBuf]) -> Result<()> {
    if ns_view.is_null() {
        bail!("The window's view is unavailable");
    }
    if paths.is_empty() {
        return Ok(());
    }
    let source = file_drag_source()?;
    unsafe {
        let app_class = AnyClass::get(c"NSApplication").ok_or_else(|| anyhow!("NSApplication is unavailable"))?;
        let app: *mut AnyObject = msg_send![app_class, sharedApplication];
        let event: *mut AnyObject = msg_send![app, currentEvent];
        if event.is_null() {
            bail!("No mouse event to start the drag from");
        }
        // NSEventTypeLeftMouseDragged
        let kind: usize = msg_send![event, type];
        if kind != 6 {
            bail!("The drag did not come from the mouse");
        }
        let view = ns_view.cast::<AnyObject>();
        let in_window: NSPoint = msg_send![event, locationInWindow];
        let at: NSPoint = msg_send![view, convertPoint: in_window, fromView: std::ptr::null_mut::<AnyObject>()];
        let workspace_class = AnyClass::get(c"NSWorkspace").ok_or_else(|| anyhow!("NSWorkspace is unavailable"))?;
        let workspace: *mut AnyObject = msg_send![workspace_class, sharedWorkspace];
        let item_class = AnyClass::get(c"NSDraggingItem").ok_or_else(|| anyhow!("NSDraggingItem is unavailable"))?;
        let mut items: Vec<Retained<AnyObject>> = Vec::new();
        for (index, path) in paths.iter().enumerate() {
            let Some(text) = path.to_str() else { continue };
            let url = NSURL::fileURLWithPath_isDirectory(&NSString::from_str(text), path.is_dir());
            let item: Allocated<AnyObject> = msg_send![item_class, alloc];
            let item: Option<Retained<AnyObject>> = msg_send![item, initWithPasteboardWriter: &*url];
            let Some(item) = item else { continue };
            let icon: *mut AnyObject = msg_send![workspace, iconForFile: &*NSString::from_str(text)];
            let offset = index as f64 * 4.;
            let frame = NSRect::new(NSPoint::new(at.x - 16. + offset, at.y - 16. - offset), NSSize::new(32., 32.));
            let _: () = msg_send![&*item, setDraggingFrame: frame, contents: icon];
            items.push(item);
        }
        if items.is_empty() {
            bail!("Nothing to drag");
        }
        let items = NSArray::from_retained_slice(&items);
        let _session: *mut AnyObject = msg_send![view, beginDraggingSessionWithItems: &*items, event: event, source: source];
    }
    Ok(())
}
