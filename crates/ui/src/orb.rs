//! The `thinking-orbs` artwork (`thinking-orb.tsx`): dotted spheres drawn as the library paints
//! its canvas. Working is the "orbits" mode (particles on tilted orbits), idle the "ring" mode
//! (a ring slowly morphing), each with the library's 64 and 20 pixel presets.

use std::f32::consts::PI;

/// One painted dot, in the orb's own pixels. `ink` is the dot's grey, 1 brightest; the
/// primary-colour filter turns it into opacity.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Dot {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub radius: f32,
    pub ink: f32,
    pub alpha: f32,
}

/// What the orb is doing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OrbMode {
    Orbits,
    Ring,
}

/// A preset of the library: the painter's options after its count and size scaling.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OrbPreset {
    pub mode: OrbMode,
    /// The design size: 64 or 20.
    pub size: f32,
    /// Time runs this many times faster than seconds.
    pub speed: f32,
    count: f32,
    scale: f32,
    band: f32,
    wobble: f32,
}

/// `resolvePreset`: the 64 pixel design from 42 pixels up, else the 20 pixel one.
pub fn preset(mode: OrbMode, size: f32) -> OrbPreset {
    let large = size >= 42.;
    let (speed, count, scale, band, wobble) = match (mode, large) {
        (OrbMode::Orbits, true) => (1.885, 1., 1., 1., 1.),
        (OrbMode::Orbits, false) => (3.9, 0.238, 2.4, 1., 1.),
        (OrbMode::Ring, true) => (3.24, 0.25, 0.956, 3.627, 0.368),
        (OrbMode::Ring, false) => (3.78, 0.028, 1.622, 3.968, 0.565),
    };
    OrbPreset { mode, size: if large { 64. } else { 20. }, speed, count, scale, band, wobble }
}

/// JavaScript's `Math.round`: halves go up.
fn round(value: f32) -> f32 {
    (value + 0.5).floor()
}

/// The library's hash of two numbers into 0..1.
fn hash(a: f32, b: f32) -> f32 {
    let value = ((a * 12.9898 + b * 78.233) as f64).sin() * 43_758.545_3;
    (value - value.floor()) as f32
}

/// The orbit camera: yaw then pitch, around `(cx, cy)`, scaled by `scale`; y points up.
fn camera(yaw: f32, pitch: f32, cx: f32, cy: f32, scale: f32) -> impl Fn(f32, f32, f32) -> (f32, f32, f32) {
    let (sp, cp, sy, cy_) = (pitch.sin(), pitch.cos(), yaw.sin(), yaw.cos());
    move |x, y, z| {
        let x1 = x * cy_ + z * sy;
        let z1 = -x * sy + z * cy_;
        let y2 = y * cp - z1 * sp;
        let z2 = y * sp + z1 * cp;
        (cx + x1 * scale, cy - y2 * scale, z2)
    }
}

/// The dots of the orb at time `t` (seconds times the preset's speed), sorted back to front.
pub fn dots(preset: &OrbPreset, t: f32) -> Vec<Dot> {
    let mut dots = match preset.mode {
        OrbMode::Orbits => orbits(preset, t),
        OrbMode::Ring => ring(preset, t),
    };
    dots.sort_by(|a, b| a.z.total_cmp(&b.z));
    dots
}

/// Particles circling on tilted orbits over faint orbit trails (`orbits`).
fn orbits(preset: &OrbPreset, t: f32) -> Vec<Dot> {
    let n = preset.size;
    let radius = n / 2. * 0.82;
    let project = camera(t * 0.12, 0.3, n / 2., n / 2., 1.);
    let size_scale = (n / 300.).powf(0.6);
    let orbit_count = round(12. * preset.count).max(1.) as usize;
    let ghost_count = round(40. * preset.count).max(1.) as usize;
    let (ghost_radius, particle_radius, particle_depth) = (0.9 * preset.scale, 1.2 * preset.scale, 1.6 * preset.scale);
    let mut out = Vec::new();
    for orbit in 0..orbit_count {
        let index = orbit as f32;
        let (a, b, c) = (hash(index, 1.7), hash(index, 5.2), hash(index, 8.9));
        let r = radius * (0.45 + 0.52 * a);
        let theta = a * 2. * PI;
        let phi = (2. * b - 1.).acos();
        let (nx, ny, nz) = (phi.sin() * theta.cos(), phi.cos(), phi.sin() * theta.sin());
        let (mut ux, mut uy) = (-ny, nx);
        let uz = 0.;
        let length = (ux * ux + uy * uy).sqrt().max(1e-6);
        ux /= length;
        uy /= length;
        let (vx, vy, vz) = (ny * uz - nz * uy, nz * ux - nx * uz, nx * uy - ny * ux);
        let direction = (0.25 + 0.55 * c) * if c > 0.5 { 1. } else { -1. };
        let point = |angle: f32| {
            let (s, co) = (angle.sin(), angle.cos());
            project((ux * co + vx * s) * r, (uy * co + vy * s) * r, (uz * co + vz * s) * r)
        };
        for ghost in 0..ghost_count {
            let (x, y, z) = point(ghost as f32 / ghost_count as f32 * 2. * PI);
            let depth = (z / r + 1.) / 2.;
            out.push(Dot { x, y, z, radius: ghost_radius * size_scale, ink: 0.72, alpha: 0.5 * (0.4 + 0.6 * depth) });
        }
        for particle in 0..3 {
            let (x, y, z) = point(t * direction + particle as f32 / 3. * 2. * PI + b * 6.);
            let depth = (z / r + 1.) / 2.;
            out.push(Dot { x, y, z, radius: (particle_radius + particle_depth * depth) * size_scale, ink: 0.3 - 0.22 * depth, alpha: 1. });
        }
    }
    out
}

/// Bands of dots on a ring seen face on, their radius undulating (`ribbon` with `faceOn`).
fn ring(preset: &OrbPreset, t: f32) -> Vec<Dot> {
    let n = preset.size;
    let radius = n / 2. * 0.78;
    let pitch = 0.3;
    let project = camera(0., pitch, n / 2., n / 2., 1.);
    let size_scale = (n / 300.).powf(0.6);
    let spin_angle = 0.;
    let tilt = -pitch;
    let (k, d0, i) = (f32::cos(spin_angle), 0., f32::sin(spin_angle));
    let (d, y, p) = (-i * tilt.sin(), tilt.cos(), k * tilt.sin());
    let (f, pp, m) = (d0 * p - i * y, i * d - k * p, k * y - d0 * d);
    let wobble = 0.23 * preset.wobble;
    let ring_radius = radius / (1. + 0.85 * wobble);
    let lanes = round(5. * preset.count.sqrt()).max(2.);
    let segments = round(88. * preset.count.sqrt()).max(2.) as usize;
    let bands = round(lanes * preset.band).max(1.) as usize;
    let half = (bands as f32 - 1.) / 2.;
    let (base, depth_radius) = (1.1 * preset.scale, 1.7 * preset.scale);
    let mut out = Vec::with_capacity(bands * segments);
    for band in 0..bands {
        let offset = (band as f32 - half) * 0.075;
        let edge = (band as f32 - half).abs() / half.max(1.);
        for segment in 0..segments {
            let angle = segment as f32 / segments as f32 * 2. * PI;
            let undulation = (0.16 * (angle * 3. - t * 1.7 + band as f32 * 0.22).sin() + 0.07 * (angle * 5. + t * 1.1).sin()) * preset.wobble;
            let scale = 1. + undulation;
            let wx = k * angle.cos() + d * angle.sin() + f * offset;
            let wy = d0 * angle.cos() + y * angle.sin() + pp * offset;
            let wz = i * angle.cos() + p * angle.sin() + m * offset;
            let length = (wx * wx + wy * wy + wz * wz).sqrt();
            let r = ring_radius * scale;
            let (x, py, z) = project(wx / length * r, wy / length * r, wz / length * r);
            let depth = (z / radius + 1.) / 2.;
            out.push(Dot {
                x,
                y: py,
                z,
                radius: (base + depth_radius * depth) * (1. - 0.25 * edge) * size_scale,
                ink: 0.52 - 0.44 * depth + 0.18 * edge,
                alpha: 0.4 + 0.6 * depth,
            });
        }
    }
    out
}

/// How opaque a dot paints once the colour filter has turned its grey into coverage: the grey
/// is `1 - ink` on the dark theme the wrapper pins, and its luminance becomes the alpha.
pub fn coverage(dot: &Dot) -> f32 {
    let grey = (1. - dot.ink.clamp(0., 1.)).clamp(0., 1.);
    (grey * dot.alpha).clamp(0., 1.)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_scale_counts_and_sizes() {
        let working = preset(OrbMode::Orbits, 64.);
        assert_eq!(dots(&working, 0.).len(), 12 * (40 + 3));
        let small = preset(OrbMode::Orbits, 20.);
        assert_eq!(dots(&small, 0.).len(), 3 * (10 + 3));
        let idle = preset(OrbMode::Ring, 64.);
        assert_eq!(dots(&idle, 0.).len(), 11 * 44);
        let small_idle = preset(OrbMode::Ring, 20.);
        assert_eq!(dots(&small_idle, 1.).len(), 8 * 15);
    }

    #[test]
    fn dots_stay_inside_the_orb_and_move() {
        for mode in [OrbMode::Orbits, OrbMode::Ring] {
            let preset = preset(mode, 64.);
            let before = dots(&preset, 0.);
            let after = dots(&preset, 1.);
            assert!(before.iter().all(|dot| dot.x > 0. && dot.x < 64. && dot.y > 0. && dot.y < 64. && dot.radius > 0.));
            assert!(before.windows(2).all(|pair| pair[0].z <= pair[1].z));
            assert_ne!(before, after);
            assert!(before.iter().all(|dot| (0. ..=1.).contains(&coverage(dot))));
        }
    }
}
