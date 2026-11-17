//! Renders the Source Control panel to a PNG without a window, against a throwaway repository
//! with a linked worktree, a remote and tags.
//!
//! `cargo run -p git_panel --example git_panel_snapshot -- out.png [dark|light] [changes|scrolled|branches|worktrees|remotes|tags]`

use std::{path::Path, process::Command, sync::Arc, time::Duration};

use anyhow::{Context as _, Result, bail};
use git_panel::GitPanel;
use gpui::{AppContext as _, HeadlessAppContext, px, size};
use theme::Appearance;

fn git(dir: &Path, args: &[&str]) -> Result<()> {
    let status = Command::new("git").args(args).current_dir(dir).status()?;
    if !status.success() {
        bail!("git {args:?} failed");
    }
    Ok(())
}

fn scratch_repo(base: &Path) -> Result<std::path::PathBuf> {
    if base.exists() {
        std::fs::remove_dir_all(base)?;
    }
    let root = base.join("words");
    std::fs::create_dir_all(&root)?;
    git(&root, &["init", "-q", "-b", "main"])?;
    git(&root, &["config", "user.name", "Ada"])?;
    git(&root, &["config", "user.email", "ada@example.com"])?;
    git(&root, &["config", "commit.gpgsign", "false"])?;
    git(&root, &["config", "tag.gpgsign", "false"])?;
    std::fs::write(root.join("README.md"), "# Words\n")?;
    git(&root, &["add", "."])?;
    git(&root, &["commit", "-q", "-m", "First commit"])?;
    git(&root, &["tag", "-a", "v0.1.0", "-m", "First release"])?;
    std::fs::write(root.join("README.md"), "# Words\n\nCounts words.\n")?;
    git(&root, &["commit", "-q", "-am", "Describe the project"])?;
    git(&root, &["tag", "v0.2.0"])?;
    git(&root, &["remote", "add", "origin", "git@github.com:athasdev/words.git"])?;
    git(&root, &["remote", "add", "upstream", "https://github.com/someone/words.git"])?;
    git(&root, &["worktree", "add", "-q", "-b", "feature/split", &base.join("words-split").to_string_lossy()])?;
    std::fs::write(root.join("README.md"), "# Words\n\nCounts words in text.\n")?;
    Ok(root)
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = args.first().cloned().unwrap_or_else(|| "git-panel.png".into());
    let appearance = if args.get(1).map(String::as_str) == Some("light") { Appearance::Light } else { Appearance::Dark };
    let tab = args.get(2).cloned().unwrap_or_else(|| "changes".into());

    let root = scratch_repo(&std::env::temp_dir().join("athas-git-panel-snapshot"))?;
    // `scrolled`: enough changes to scroll, then the list scrolled so a header sticks.
    let scrolled = tab == "scrolled";
    if scrolled {
        for index in 0..24 {
            std::fs::write(root.join(format!("note-{index:02}.txt")), "draft\n")?;
        }
    }
    let tab = if scrolled { "changes".to_string() } else { tab };
    let text_system = gpui_platform::current_platform(true).text_system();
    let mut cx = HeadlessAppContext::with_platform(text_system, Arc::new(ui::Assets), || gpui_platform::current_headless_renderer());
    cx.update(|cx| -> Result<()> {
        ui::load_fonts(cx)?;
        ui::init(cx);
        theme::init(cx, None, appearance, false);
        Ok(())
    })?;
    let window = cx.open_window(size(px(320.), px(560.)), |window, cx| cx.new(|cx| GitPanel::new(root.clone(), window, cx)))?;
    cx.allow_parking();
    let settle = |cx: &mut HeadlessAppContext| -> Result<()> {
        for _ in 0..30 {
            cx.run_until_parked();
            std::thread::sleep(Duration::from_millis(30));
            cx.update_window(window.into(), |_, window, _| window.refresh())?;
        }
        Ok(())
    };
    settle(&mut cx)?;
    cx.update(|cx| window.update(cx, |panel, _, cx| panel.open_tab(&tab, cx)).ok());
    settle(&mut cx)?;
    if scrolled {
        cx.update(|cx| window.update(cx, |panel, _, cx| panel.scroll_changes_by(px(300.), cx)).ok());
        settle(&mut cx)?;
    }
    let image = cx.capture_screenshot(window.into()).context("capturing the window")?;
    image.save(&out).with_context(|| format!("writing {out}"))?;
    println!("{out} {}x{}", image.width(), image.height());
    Ok(())
}
