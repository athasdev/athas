use gpui::{Hsla, Rgba};

/// Parses the colour forms theme files use: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)` and
/// `rgba(...)`.
pub fn parse_color(value: &str) -> Option<Rgba> {
    let value = value.trim();
    if let Some(hex) = value.strip_prefix('#') {
        let expand = |s: &str| -> Option<Vec<f32>> {
            let digits: Vec<u8> = match s.len() {
                3 | 4 => s.chars().map(|c| c.to_digit(16).map(|d| (d * 17) as u8)).collect::<Option<_>>()?,
                6 | 8 => (0..s.len())
                    .step_by(2)
                    .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
                    .collect::<Option<_>>()?,
                _ => return None,
            };
            Some(digits.into_iter().map(|d| d as f32 / 255.0).collect())
        };
        let channels = expand(hex)?;
        return Some(Rgba {
            r: channels[0],
            g: channels[1],
            b: channels[2],
            a: channels.get(3).copied().unwrap_or(1.0),
        });
    }
    let inner = value
        .strip_prefix("rgba(")
        .or_else(|| value.strip_prefix("rgb("))?
        .strip_suffix(')')?;
    let parts: Vec<&str> = inner
        .split(|c: char| c == ',' || c == '/' || c.is_whitespace())
        .filter(|part| !part.is_empty())
        .collect();
    if parts.len() < 3 {
        return None;
    }
    let channel = |s: &str| -> Option<f32> {
        match s.strip_suffix('%') {
            Some(percent) => percent.parse::<f32>().ok().map(|p| p / 100.0),
            None => s.parse::<f32>().ok().map(|v| v / 255.0),
        }
    };
    let alpha = match parts.get(3) {
        Some(s) => match s.strip_suffix('%') {
            Some(percent) => percent.parse::<f32>().ok()? / 100.0,
            None => s.parse::<f32>().ok()?,
        },
        None => 1.0,
    };
    Some(Rgba { r: channel(parts[0])?, g: channel(parts[1])?, b: channel(parts[2])?, a: alpha })
}

pub const TRANSPARENT: Rgba = Rgba { r: 0.0, g: 0.0, b: 0.0, a: 0.0 };

/// CSS `color-mix(in srgb, a <amount>, b)`: interpolates premultiplied sRGB, so mixing with
/// `transparent` keeps the colour and scales its alpha.
pub fn mix(a: Rgba, amount: f32, b: Rgba) -> Rgba {
    let p = amount.clamp(0.0, 1.0);
    let q = 1.0 - p;
    let alpha = a.a * p + b.a * q;
    if alpha <= f32::EPSILON {
        return TRANSPARENT;
    }
    let channel = |x: f32, y: f32| (x * a.a * p + y * b.a * q) / alpha;
    Rgba { r: channel(a.r, b.r), g: channel(a.g, b.g), b: channel(a.b, b.b), a: alpha }
}

pub fn with_alpha(color: Rgba, alpha: f32) -> Rgba {
    Rgba { a: color.a * alpha, ..color }
}

pub fn black(alpha: f32) -> Hsla {
    Rgba { r: 0.0, g: 0.0, b: 0.0, a: alpha }.into()
}

pub fn white() -> Rgba {
    Rgba { r: 1.0, g: 1.0, b: 1.0, a: 1.0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hex_and_rgba() {
        let c = parse_color("#18191b").unwrap();
        assert!((c.r - 0x18 as f32 / 255.0).abs() < 1e-6);
        let c = parse_color("rgba(56, 189, 248, 0.32)").unwrap();
        assert!((c.a - 0.32).abs() < 1e-6);
        let c = parse_color("rgb(0 0 0 / 0.16)").unwrap();
        assert!((c.a - 0.16).abs() < 1e-6);
    }

    #[test]
    fn mixing_with_transparent_scales_alpha() {
        let red = parse_color("#ff0000").unwrap();
        let mixed = mix(red, 0.12, TRANSPARENT);
        assert!((mixed.r - 1.0).abs() < 1e-6);
        assert!((mixed.a - 0.12).abs() < 1e-6);
    }
}
