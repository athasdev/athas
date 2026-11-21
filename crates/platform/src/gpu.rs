//! Which GPU Athas draws on, and saying so in the log.
//!
//! GPUI chooses an adapter itself: the display server's own GPU when it can tell which that is,
//! else discrete before integrated. On a machine with more than one GPU the choice can land on
//! one the compositor cannot present from. The window is created and no error is reported —
//! nothing is ever drawn into it, so no window appears (athasdev/athas#795, Hyprland on Wayland).
//!
//! Two things make that case recoverable: `ATHAS_DEVICE_ID` forces the adapter, and the log says
//! which GPU a window ended up on, so the next report does not have to guess at it.

use gpui::Window;

/// Athas's name for the override.
pub const DEVICE_ID_VAR: &str = "ATHAS_DEVICE_ID";
/// What GPUI reads. Athas sets it from its own variable so a user need not know Zed's name for it.
const GPUI_DEVICE_ID_VAR: &str = "ZED_DEVICE_ID";

/// Whether `value` is a PCI device id GPUI will accept: four hexadecimal digits, `0x` optional.
/// Anything else is rejected here rather than deep inside the renderer, where it is only logged.
pub fn is_pci_id(value: &str) -> bool {
    let value = value.trim();
    let digits = value.strip_prefix("0x").or_else(|| value.strip_prefix("0X")).unwrap_or(value);
    digits.len() == 4 && digits.chars().all(|digit| digit.is_ascii_hexdigit())
}

/// What `ZED_DEVICE_ID` should become, given Athas's variable and whatever GPUI's own is already
/// set to. `None` leaves it alone: an id the user set for GPUI directly wins, since they asked
/// for it by name.
fn device_override(athas: Option<&str>, gpui: Option<&str>) -> Option<String> {
    if gpui.is_some_and(|value| !value.trim().is_empty()) {
        return None;
    }
    let athas = athas.map(str::trim).filter(|value| !value.is_empty())?;
    if !is_pci_id(athas) {
        log::warn!("Ignoring {DEVICE_ID_VAR}={athas}: expected a four digit hexadecimal PCI id, such as 0x28e0");
        return None;
    }
    Some(athas.to_string())
}

/// Passes `ATHAS_DEVICE_ID` on to GPUI.
///
/// Call this at the top of `main`, before the application starts: the renderer reads the variable
/// when it makes its first window, and setting one is only sound while the process is still
/// single-threaded.
pub fn apply_device_override() {
    let athas = std::env::var(DEVICE_ID_VAR).ok();
    let gpui = std::env::var(GPUI_DEVICE_ID_VAR).ok();
    let Some(id) = device_override(athas.as_deref(), gpui.as_deref()) else { return };
    // SAFETY: called from the first statements of `main`, before any thread is spawned.
    unsafe { std::env::set_var(GPUI_DEVICE_ID_VAR, &id) };
    log::info!("Drawing on the GPU {DEVICE_ID_VAR}={id} asks for");
}

/// What the log says about the GPU a window draws on.
fn gpu_line(specs: &gpui::GpuSpecs) -> String {
    let mut line = format!("[gpu] device={}", specs.device_name);
    if !specs.driver_name.trim().is_empty() {
        line.push_str(&format!(" driver={}", specs.driver_name));
    }
    if !specs.driver_info.trim().is_empty() {
        line.push_str(&format!(" ({})", specs.driver_info));
    }
    line
}

/// Writes the GPU a window draws on to the log, and warns when that GPU is really the CPU.
///
/// GPUI reports this on Linux only; on macOS and Windows there is nothing to say.
pub fn log_gpu(window: &Window) {
    let Some(specs) = window.gpu_specs() else { return };
    log::info!("{}", gpu_line(&specs));
    if specs.is_software_emulated {
        log::warn!(
            "This GPU renders on the CPU, so Athas will be slow. Set {DEVICE_ID_VAR} to a GPU's four digit \
             hexadecimal PCI id (from `lspci -nn`) to choose another one."
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_pci_ids_gpui_does() {
        for id in ["28e0", "0x28e0", "0X28E0", " 28e0 ", "ffff"] {
            assert!(is_pci_id(id), "{id}");
        }
        for id in ["", "0x", "28e", "28e0f", "0x28g0", "28 e0", "nvidia"] {
            assert!(!is_pci_id(id), "{id}");
        }
    }

    #[test]
    fn athas_sets_gpuis_variable_unless_it_is_already_set() {
        assert_eq!(device_override(Some("0x28e0"), None).as_deref(), Some("0x28e0"));
        assert_eq!(device_override(Some(" 28e0 "), None).as_deref(), Some("28e0"));
        // Someone who set GPUI's own variable asked for that id by name.
        assert_eq!(device_override(Some("0x28e0"), Some("0x1002")), None);
        // An empty or unreadable value is no override at all.
        assert_eq!(device_override(Some("0x28e0"), Some("  ")).as_deref(), Some("0x28e0"));
        assert_eq!(device_override(None, None), None);
        assert_eq!(device_override(Some(""), None), None);
        // A value GPUI would only complain about is refused here instead.
        assert_eq!(device_override(Some("nvidia"), None), None);
    }

    #[test]
    fn the_gpu_line_leaves_out_what_the_driver_did_not_say() {
        let specs = |driver: &str, info: &str| gpui::GpuSpecs {
            is_software_emulated: false,
            device_name: "AMD Radeon 780M".into(),
            driver_name: driver.into(),
            driver_info: info.into(),
        };
        assert_eq!(gpu_line(&specs("radv", "Mesa 25.2.3")), "[gpu] device=AMD Radeon 780M driver=radv (Mesa 25.2.3)");
        assert_eq!(gpu_line(&specs("", "")), "[gpu] device=AMD Radeon 780M");
        assert_eq!(gpu_line(&specs("radv", "")), "[gpu] device=AMD Radeon 780M driver=radv");
    }
}
