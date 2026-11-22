//! Prints where macOS puts the window buttons on a plain window, so the workbench can line its
//! own title row up with every other app instead of a guessed inset.
//!
//! `cargo run -p platform --example traffic_lights`

#[cfg(target_os = "macos")]
fn main() {
    use objc2::MainThreadOnly;
    use objc2::rc::autoreleasepool;
    use objc2_app_kit::{NSApplication, NSBackingStoreType, NSWindow, NSWindowButton, NSWindowStyleMask};
    use objc2_foundation::{MainThreadMarker, NSRect};

    let mtm = MainThreadMarker::new().expect("the main thread");
    let _app = NSApplication::sharedApplication(mtm);
    autoreleasepool(|_| unsafe {
        let frame = NSRect::new(objc2_foundation::NSPoint::new(0., 0.), objc2_foundation::NSSize::new(800., 600.));
        let style = NSWindowStyleMask::Titled | NSWindowStyleMask::Closable | NSWindowStyleMask::Miniaturizable | NSWindowStyleMask::Resizable;
        let window = NSWindow::initWithContentRect_styleMask_backing_defer(
            NSWindow::alloc(mtm),
            frame,
            style,
            NSBackingStoreType::Buffered,
            false,
        );
        let window_height = window.frame().size.height;
        let content_height = window.contentRectForFrameRect(window.frame()).size.height;
        println!("window {:.1} tall, content {:.1} tall -> title bar {:.1}", window_height, content_height, window_height - content_height);
        for (name, which) in
            [("close", NSWindowButton::CloseButton), ("minimize", NSWindowButton::MiniaturizeButton), ("zoom", NSWindowButton::ZoomButton)]
        {
            let Some(button) = window.standardWindowButton(which) else { continue };
            let f = button.frame();
            // The button's frame is in its titlebar container, whose origin is the window's.
            let container = button.superview().map(|view| view.frame());
            println!(
                "{name:<9} origin ({:.1}, {:.1})  size {:.1}x{:.1}  centre x {:.1}{}",
                f.origin.x,
                f.origin.y,
                f.size.width,
                f.size.height,
                f.origin.x + f.size.width / 2.,
                container.map_or(String::new(), |c| format!("  container {:.1}x{:.1} at y {:.1}", c.size.width, c.size.height, c.origin.y))
            );
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("macOS only");
}
