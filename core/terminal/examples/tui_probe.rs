use std::io::{self, Read, Write};

const ENTER_ALT_SCREEN: &str = "\x1b[?1049h\x1b[2J\x1b[H";
const ENABLE_MODES: &str = "\x1b[?2004h\x1b[?1004h\x1b[?1000h\x1b[?1006h";
const DISABLE_MODES: &str = "\x1b[?1006l\x1b[?1000l\x1b[?1004l\x1b[?2004l\x1b[?1049l";

fn main() -> io::Result<()> {
   let _raw_mode = RawMode::enable()?;
   let mut stdout = io::stdout().lock();
   write!(stdout, "{ENTER_ALT_SCREEN}{ENABLE_MODES}")?;
   draw_probe(&mut stdout)?;

   let mut stdin = io::stdin().lock();
   let mut buffer = [0u8; 256];
   loop {
      let count = stdin.read(&mut buffer)?;
      if count == 0 {
         break;
      }

      let input = &buffer[..count];
      write!(stdout, "\r\ninput: {}", format_bytes(input))?;
      stdout.flush()?;

      if input == b"q" || input == b"\x03" {
         break;
      }
      if input == b"b" {
         for line in 0..20_000 {
            writeln!(stdout, "bulk-output-{line:05} ├─🙂─┤")?;
         }
         stdout.flush()?;
      }
   }

   write!(stdout, "{DISABLE_MODES}")?;
   stdout.flush()
}

fn draw_probe(output: &mut impl Write) -> io::Result<()> {
   let (rows, cols, pixel_width, pixel_height) = terminal_size();
   writeln!(output, "Athas terminal compatibility probe")?;
   writeln!(
      output,
      "grid: {cols}x{rows}, pixels: {pixel_width}x{pixel_height}"
   )?;
   writeln!(output, "┌──────────────┬──────────────┐")?;
   writeln!(output, "│ ASCII 0123   │ Wide 日本🙂  │")?;
   writeln!(output, "├──────────────┼──────────────┤")?;
   writeln!(
      output,
      "│ combining e\u{301}  │ powerline \u{e0b0}\u{e0b2} │"
   )?;
   writeln!(output, "└──────────────┴──────────────┘")?;
   writeln!(
      output,
      "Modes: alt-screen, bracketed paste, focus, SGR mouse"
   )?;
   writeln!(output, "Press b for fast output; q or Ctrl+C to exit.")?;
   output.flush()
}

fn format_bytes(bytes: &[u8]) -> String {
   bytes
      .iter()
      .map(|byte| format!("{byte:02x}"))
      .collect::<Vec<_>>()
      .join(" ")
}

#[cfg(unix)]
fn terminal_size() -> (u16, u16, u16, u16) {
   let mut size = libc::winsize {
      ws_row: 0,
      ws_col: 0,
      ws_xpixel: 0,
      ws_ypixel: 0,
   };
   unsafe {
      libc::ioctl(libc::STDOUT_FILENO, libc::TIOCGWINSZ, &mut size);
   }
   (size.ws_row, size.ws_col, size.ws_xpixel, size.ws_ypixel)
}

#[cfg(not(unix))]
fn terminal_size() -> (u16, u16, u16, u16) {
   (0, 0, 0, 0)
}

#[cfg(unix)]
struct RawMode(libc::termios);

#[cfg(unix)]
impl RawMode {
   fn enable() -> io::Result<Self> {
      let mut original = unsafe { std::mem::zeroed::<libc::termios>() };
      if unsafe { libc::tcgetattr(libc::STDIN_FILENO, &mut original) } != 0 {
         return Err(io::Error::last_os_error());
      }

      let mut raw = original;
      unsafe {
         libc::cfmakeraw(&mut raw);
      }
      if unsafe { libc::tcsetattr(libc::STDIN_FILENO, libc::TCSANOW, &raw) } != 0 {
         return Err(io::Error::last_os_error());
      }

      Ok(Self(original))
   }
}

#[cfg(unix)]
impl Drop for RawMode {
   fn drop(&mut self) {
      unsafe {
         libc::tcsetattr(libc::STDIN_FILENO, libc::TCSANOW, &self.0);
      }
      let _ = io::stdout().write_all(DISABLE_MODES.as_bytes());
   }
}

#[cfg(not(unix))]
struct RawMode;

#[cfg(not(unix))]
impl RawMode {
   fn enable() -> io::Result<Self> {
      Ok(Self)
   }
}
