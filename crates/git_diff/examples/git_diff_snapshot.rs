//! Renders the diff, commit and blame views to a PNG without a window, against a throwaway
//! repository in the temp folder.
//!
//! `cargo run -p git_diff --example git_diff_snapshot -- out.png [dark|light] [scene] [width] [height]`
//! Scenes: `unified` (default), `split`, `staged`, `commit`, `commit-diff`, `image`, `blame`,
//! `all` (every working tree change), `find` (`all` with the search open on "counts"),
//! `scrolled` (`all` scrolled so a file header sticks).

use std::{path::Path, sync::Arc, time::Duration};

use anyhow::{Context as _, Result};
use git2::{IndexAddOption, Repository, Signature, Time};
use git_diff::{BlameView, CommitView, DiffTarget, DiffView, Scope, model::Layout};
use gpui::{AnyView, AppContext as _, HeadlessAppContext, px, size};
use theme::Appearance;

const BEFORE: &str = "use std::collections::HashMap;\n\n/// Counts words.\npub fn count(text: &str) -> HashMap<String, usize> {\n    let mut counts = HashMap::new();\n    for word in text.split_whitespace() {\n        *counts.entry(word.to_string()).or_insert(0) += 1;\n    }\n    counts\n}\n\nfn helper_one() {}\nfn helper_two() {}\nfn helper_three() {}\nfn helper_four() {}\nfn helper_five() {}\nfn helper_six() {}\nfn helper_seven() {}\n\npub fn total(counts: &HashMap<String, usize>) -> usize {\n    counts.values().sum()\n}\n";

const AFTER: &str = "use std::collections::BTreeMap;\n\n/// Counts words, ignoring case.\npub fn count(text: &str) -> BTreeMap<String, usize> {\n    let mut counts = BTreeMap::new();\n    for word in text.split_whitespace() {\n        *counts.entry(word.to_lowercase()).or_insert(0) += 1;\n    }\n    counts\n}\n\nfn helper_one() {}\nfn helper_two() {}\nfn helper_three() {}\nfn helper_four() {}\nfn helper_five() {}\nfn helper_six() {}\nfn helper_seven() {}\n\npub fn total(counts: &BTreeMap<String, usize>) -> usize {\n    counts.values().copied().sum()\n}\n\npub fn is_empty(counts: &BTreeMap<String, usize>) -> bool {\n    counts.is_empty()\n}\n";

fn png(width: u32, height: u32, color: [u8; 4]) -> Vec<u8> {
    let image = image::RgbaImage::from_pixel(width, height, image::Rgba(color));
    let mut bytes = Vec::new();
    image.write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png).expect("png");
    bytes
}

fn commit(repo: &Repository, message: &str, author: &str, days_ago: i64) -> Result<git2::Oid> {
    let mut index = repo.index()?;
    index.add_all(["*"], IndexAddOption::DEFAULT, None)?;
    index.write()?;
    let tree = repo.find_tree(index.write_tree()?)?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs() as i64;
    let signature = Signature::new(author, &format!("{}@example.com", author.to_lowercase()), &Time::new(now - days_ago * 86_400, 60))?;
    let parents: Vec<git2::Commit> = repo.head().ok().and_then(|head| head.peel_to_commit().ok()).into_iter().collect();
    let parents: Vec<&git2::Commit> = parents.iter().collect();
    Ok(repo.commit(Some("HEAD"), &signature, &signature, message, &tree, &parents)?)
}

/// A repository with history, an unstaged change, a staged change and an image.
fn scratch_repo(root: &Path) -> Result<git2::Oid> {
    if root.exists() {
        std::fs::remove_dir_all(root)?;
    }
    std::fs::create_dir_all(root.join("src"))?;
    let repo = Repository::init(root)?;
    std::fs::write(root.join("src/words.rs"), BEFORE)?;
    std::fs::write(root.join("logo.png"), png(64, 48, [80, 120, 220, 255]))?;
    std::fs::write(root.join("README.md"), "# Words\n")?;
    commit(&repo, "Count words", "Ada", 30)?;
    std::fs::write(root.join("logo.png"), png(96, 64, [230, 120, 60, 255]))?;
    std::fs::write(root.join("README.md"), "# Words\n\nCounts words in text.\n")?;
    let second = commit(&repo, "Refresh the logo\n\nThe old one was too small on retina screens,\nso this one is drawn at 1.5x.", "Grace", 2)?;
    std::fs::write(root.join("src/words.rs"), AFTER)?;
    std::fs::write(root.join("NOTES.md"), "notes\n")?;
    let mut index = repo.index()?;
    index.add_path(Path::new("NOTES.md"))?;
    index.write()?;
    Ok(second)
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = args.first().cloned().unwrap_or_else(|| "git-diff.png".into());
    let appearance = if args.get(1).map(String::as_str) == Some("light") { Appearance::Light } else { Appearance::Dark };
    let scene = args.get(2).cloned().unwrap_or_else(|| "unified".into());
    let width: f32 = args.get(3).and_then(|width| width.parse().ok()).unwrap_or(1100.);
    let height: f32 = args.get(4).and_then(|height| height.parse().ok()).unwrap_or(720.);

    let root = std::env::temp_dir().join("athas-git-diff-snapshot");
    let second = scratch_repo(&root)?.to_string();

    let text_system = gpui_platform::current_platform(true).text_system();
    let mut cx = HeadlessAppContext::with_platform(text_system, Arc::new(ui::Assets), || gpui_platform::current_headless_renderer());
    cx.update(|cx| -> Result<()> {
        ui::load_fonts(cx)?;
        ui::init(cx);
        theme::init(cx, None, appearance, false);
        git_diff::init(cx);
        Ok(())
    })?;

    let window = cx.open_window(size(px(width), px(height)), |window, cx| -> gpui::Entity<Host> {
        let view: AnyView = match scene.as_str() {
            "commit" => cx.new(|cx| CommitView::new(root.clone(), second.clone(), window, cx)).into(),
            "blame" => cx.new(|cx| BlameView::new(root.clone(), "src/words.rs".into(), window, cx)).into(),
            other => {
                let target = match other {
                    "staged" => DiffTarget::Staged { path: "NOTES.md".into() },
                    "commit-diff" => DiffTarget::Commit { commit: second.clone() },
                    "image" => DiffTarget::CommitFile { commit: second.clone(), path: "logo.png".into() },
                    "all" | "find" | "scrolled" => DiffTarget::WorkingTree { scope: Scope::All },
                    _ => DiffTarget::Working { path: "src/words.rs".into() },
                };
                let split = other == "split";
                cx.new(|cx| {
                    let mut view = DiffView::new(root.clone(), target, window, cx);
                    if split {
                        view.set_layout(Layout::Split, cx);
                    }
                    view
                })
                .into()
            }
        };
        cx.new(|_| Host(view))
    })?;
    cx.allow_parking();
    for _ in 0..10 {
        cx.run_until_parked();
        std::thread::sleep(Duration::from_millis(30));
        cx.update_window(window.into(), |_, window, _| window.refresh())?;
    }
    if scene == "find" || scene == "scrolled" {
        cx.update(|cx| {
            window
                .update(cx, |host, window, cx| {
                    if let Ok(view) = host.0.clone().downcast::<DiffView>() {
                        view.update(cx, |view, cx| {
                            if scene == "find" {
                                view.search_for("counts", window, cx);
                            } else {
                                view.step_hunk(true, cx);
                                view.step_hunk(true, cx);
                            }
                        });
                    }
                })
                .ok();
        });
        for _ in 0..6 {
            cx.run_until_parked();
            std::thread::sleep(Duration::from_millis(30));
            cx.update_window(window.into(), |_, window, _| window.refresh())?;
        }
    }
    if scene == "unified" {
        // Step to the second hunk, as alt-down does.
        cx.update(|cx| {
            window
                .update(cx, |host, _, cx| {
                    if let Ok(view) = host.0.clone().downcast::<DiffView>() {
                        view.update(cx, |view, cx| {
                            view.step_hunk(true, cx);
                            view.step_hunk(true, cx);
                        });
                    }
                })
                .ok();
        });
        for _ in 0..4 {
            cx.run_until_parked();
            cx.update_window(window.into(), |_, window, _| window.refresh())?;
        }
    }
    let image = cx.capture_screenshot(window.into()).context("capturing the window")?;
    image.save(&out).with_context(|| format!("writing {out}"))?;
    println!("{out} {}x{}", image.width(), image.height());
    Ok(())
}

/// Holds whichever view the scene shows.
struct Host(AnyView);

impl gpui::Render for Host {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl gpui::IntoElement {
        use gpui::{ParentElement, Styled};
        gpui::div().size_full().child(self.0.clone())
    }
}
