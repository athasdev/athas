// GPUI loads icon resource 1 from the exe on Windows.
#[cfg(windows)]
fn main() {
    let mut res = winres::WindowsResource::new();
    res.set_icon("../../packaging/icons/icon.ico");
    res.compile().expect("could not embed the Windows app icon");
}

#[cfg(not(windows))]
fn main() {}
