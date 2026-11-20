//! Numbers in the user's locale, as the webview's `Intl.NumberFormat` writes them. macOS asks
//! Foundation's `NSNumberFormatter` with the current locale; elsewhere callers fall back to en-US.

/// `amount` as a currency in the current locale with two to `max_digits` fraction digits, or
/// `None` where the platform cannot format it (callers then use the en-US form). A code that is
/// not three letters is not a currency to `Intl` either, so it is left to the caller.
pub fn currency(amount: f64, code: &str, max_digits: usize) -> Option<String> {
    if code.len() != 3 || !code.chars().all(|ch| ch.is_ascii_alphabetic()) {
        return decimal(amount, max_digits).map(|number| if code.is_empty() { number } else { format!("{number} {code}") });
    }
    imp::format(amount, Some(&code.to_ascii_uppercase()), max_digits)
}

/// `amount` as a plain number in the current locale with two to `max_digits` fraction digits.
pub fn decimal(amount: f64, max_digits: usize) -> Option<String> {
    imp::format(amount, None, max_digits)
}

/// `value` in the current locale's short compact notation (`Intl.NumberFormat` with
/// `notation: "compact"`): 12K, 1,2 k, 1,2 Mio., 1.2万. `fraction_digits` is the most fraction
/// digits kept; rounding is half away from zero as in `Intl`. macOS asks ICU (`libicucore`)
/// with the system locale; `None` elsewhere.
pub fn compact(value: f64, fraction_digits: usize) -> Option<String> {
    imp::compact(value, fraction_digits, None)
}

#[cfg(all(test, target_os = "macos"))]
pub(crate) fn compact_in(value: f64, fraction_digits: usize, locale: &str) -> Option<String> {
    imp::compact(value, fraction_digits, Some(locale))
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::{CStr, CString, c_char};

    use objc2::{
        msg_send,
        rc::{Retained, autoreleasepool},
        runtime::{AnyClass, AnyObject},
    };

    /// `NSNumberFormatterDecimalStyle` and `NSNumberFormatterCurrencyStyle`.
    const DECIMAL_STYLE: usize = 1;
    const CURRENCY_STYLE: usize = 2;

    pub fn format(amount: f64, code: Option<&str>, max_digits: usize) -> Option<String> {
        if !amount.is_finite() {
            return None;
        }
        let formatter_class = AnyClass::get(c"NSNumberFormatter")?;
        let number_class = AnyClass::get(c"NSNumber")?;
        let string_class = AnyClass::get(c"NSString")?;
        autoreleasepool(|_| unsafe {
            let formatter: Option<Retained<AnyObject>> = msg_send![formatter_class, new];
            let formatter = formatter?;
            let style = if code.is_some() { CURRENCY_STYLE } else { DECIMAL_STYLE };
            let _: () = msg_send![&*formatter, setNumberStyle: style];
            if let Some(code) = code {
                let code = CString::new(code).ok()?;
                let code: *mut AnyObject = msg_send![string_class, stringWithUTF8String: code.as_ptr()];
                if code.is_null() {
                    return None;
                }
                let _: () = msg_send![&*formatter, setCurrencyCode: code];
            }
            let _: () = msg_send![&*formatter, setMinimumFractionDigits: 2usize];
            let _: () = msg_send![&*formatter, setMaximumFractionDigits: max_digits.max(2)];
            let number: *mut AnyObject = msg_send![number_class, numberWithDouble: amount];
            if number.is_null() {
                return None;
            }
            let text: *mut AnyObject = msg_send![&*formatter, stringFromNumber: number];
            if text.is_null() {
                return None;
            }
            let bytes: *const c_char = msg_send![text, UTF8String];
            (!bytes.is_null()).then(|| CStr::from_ptr(bytes).to_string_lossy().into_owned()).filter(|text| !text.is_empty())
        })
    }

    /// The current locale's identifier (`en_US`, `de_DE@rg=chzzzz`), as ICU takes it.
    fn current_locale() -> Option<String> {
        let locale_class = AnyClass::get(c"NSLocale")?;
        autoreleasepool(|_| unsafe {
            let locale: *mut AnyObject = msg_send![locale_class, currentLocale];
            if locale.is_null() {
                return None;
            }
            let identifier: *mut AnyObject = msg_send![locale, localeIdentifier];
            if identifier.is_null() {
                return None;
            }
            let bytes: *const c_char = msg_send![identifier, UTF8String];
            (!bytes.is_null()).then(|| CStr::from_ptr(bytes).to_string_lossy().into_owned()).filter(|text| !text.is_empty())
        })
    }

    #[link(name = "icucore")]
    unsafe extern "C" {
        fn unumf_openForSkeletonAndLocale(skeleton: *const u16, length: i32, locale: *const c_char, status: *mut i32) -> *mut std::ffi::c_void;
        fn unumf_openResult(status: *mut i32) -> *mut std::ffi::c_void;
        fn unumf_formatDouble(formatter: *const std::ffi::c_void, value: f64, result: *mut std::ffi::c_void, status: *mut i32);
        fn unumf_resultToString(result: *const std::ffi::c_void, buffer: *mut u16, capacity: i32, status: *mut i32) -> i32;
        fn unumf_close(formatter: *mut std::ffi::c_void);
        fn unumf_closeResult(result: *mut std::ffi::c_void);
    }

    pub fn compact(value: f64, fraction_digits: usize, locale: Option<&str>) -> Option<String> {
        if !value.is_finite() {
            return None;
        }
        let locale = match locale {
            Some(locale) => locale.to_string(),
            None => current_locale()?,
        };
        let locale = CString::new(locale).ok()?;
        let precision = if fraction_digits == 0 { "precision-integer".to_string() } else { format!(".{}", "#".repeat(fraction_digits)) };
        let skeleton: Vec<u16> = format!("compact-short {precision} rounding-mode-half-up").encode_utf16().collect();
        unsafe {
            let mut status = 0i32;
            let formatter = unumf_openForSkeletonAndLocale(skeleton.as_ptr(), skeleton.len() as i32, locale.as_ptr(), &mut status);
            if formatter.is_null() || status > 0 {
                if !formatter.is_null() {
                    unumf_close(formatter);
                }
                return None;
            }
            let result = unumf_openResult(&mut status);
            if result.is_null() || status > 0 {
                unumf_close(formatter);
                return None;
            }
            unumf_formatDouble(formatter, value, result, &mut status);
            let mut buffer = [0u16; 64];
            let length = if status > 0 { 0 } else { unumf_resultToString(result, buffer.as_mut_ptr(), buffer.len() as i32, &mut status) };
            unumf_closeResult(result);
            unumf_close(formatter);
            if status > 0 || length <= 0 || length as usize > buffer.len() {
                return None;
            }
            Some(String::from_utf16_lossy(&buffer[..length as usize])).filter(|text| !text.is_empty())
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn format(_amount: f64, _code: Option<&str>, _max_digits: usize) -> Option<String> {
        None
    }

    pub fn compact(_value: f64, _fraction_digits: usize, _locale: Option<&str>) -> Option<String> {
        None
    }
}
