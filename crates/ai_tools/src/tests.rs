use std::fs;

use super::*;

#[cfg(unix)]
#[test]
fn creates_files_with_the_usual_mode() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(dir.path().join("plain.txt"), "x").unwrap();
    write_file(root, "created.txt", None, "x").unwrap();
    let mode = |name: &str| {
        fs::metadata(dir.path().join(name))
            .unwrap()
            .permissions()
            .mode()
            & 0o777
    };
    assert_eq!(mode("created.txt"), mode("plain.txt"));
}
#[cfg(unix)]
#[test]
fn follows_symbolic_links_before_judging_command_paths() {
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("private.txt"), "secret").unwrap();
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir(dir.path().join("src")).unwrap();
    fs::write(dir.path().join("src/main.rs"), "fn main() {}").unwrap();
    fs::write(dir.path().join(".env"), "TOKEN=1").unwrap();
    std::os::unix::fs::symlink(outside.path().join("private.txt"), dir.path().join("link"))
        .unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("linked-dir")).unwrap();
    std::os::unix::fs::symlink(dir.path().join(".env"), dir.path().join("config")).unwrap();
    std::os::unix::fs::symlink(dir.path().join("src"), dir.path().join("sources")).unwrap();
    let stays = |path: &str| paths_stay_in_workspace(root, &[path.to_string()]);
    assert!(stays("src/main.rs"));
    assert!(stays("sources/main.rs"));
    assert!(stays("missing/file.txt"));
    assert!(stays("pattern"));
    assert!(!stays("link"));
    assert!(!stays("linked-dir/private.txt"));
    assert!(!stays("linked-dir/not-there"));
    assert!(!stays("config"));
    assert!(!stays(".env"));
    assert!(!paths_stay_in_workspace(
        root,
        &["src/main.rs".into(), "link".into()]
    ));
}
#[test]
fn refuses_traversal_and_secret_files() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(dir.path().join(".env"), "secret").unwrap();
    assert!(read_file(root, "../outside").is_err());
    assert!(read_file(root, ".env").is_err());
    assert!(read_file(root, "/etc/passwd").is_err());
}

#[test]
fn honors_ai_ignore_files_for_discovery_read_write_delete_and_command_paths() {
    for name in AI_IGNORE_FILES {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::write(
            dir.path().join(name),
            "private/\n*.secret\n!public.secret\n",
        )
        .unwrap();
        fs::create_dir(dir.path().join("private")).unwrap();
        for path in [
            "private/a.ts",
            "hidden.secret",
            "public.secret",
            "public.ts",
        ] {
            fs::write(dir.path().join(path), "needle").unwrap();
        }
        let files = list_files(root, &ListOptions::default())
            .unwrap()
            .files;
        assert!(files.contains(&"public.ts".into()));
        assert!(files.contains(&"public.secret".into()));
        assert!(!files.contains(&"private/a.ts".into()));
        assert!(!files.contains(&"hidden.secret".into()));
        let found = search_files(
            root,
            &SearchOptions {
                query: "needle".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(found.matches.len(), 2);
        assert!(read_file(root, "private/a.ts").is_err());
        assert!(write_file(root, "private/new.ts", None, "new").is_err());
        assert!(delete_file(root, "hidden.secret", "needle").is_err());
        assert!(!paths_stay_in_workspace(root, &["hidden.secret".into()]));
        assert!(!paths_stay_in_workspace(root, &["private/new.ts".into()]));
        assert!(read_file(root, "public.secret").is_ok());
        assert!(
            list_files(
                root,
                &ListOptions {
                    path: Some("private".into()),
                    ..Default::default()
                }
            )
            .is_err()
        );
    }
}

#[test]
fn combines_ai_exclusions_without_overriding_credentials_or_other_ignore_files() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(dir.path().join(".athasignore"), "*.ts\n").unwrap();
    fs::write(dir.path().join(".cursorignore"), "!*.ts\n!.env\n").unwrap();
    fs::write(dir.path().join("a.ts"), "private").unwrap();
    fs::write(dir.path().join(".env"), "secret").unwrap();
    assert!(read_file(root, "a.ts").is_err());
    assert!(read_file(root, ".env").is_err());
    fs::write(dir.path().join(".athasignore"), "[z-a]\n").unwrap();
    assert!(read_file(root, "a.ts").is_err());
}

#[cfg(unix)]
#[test]
fn refuses_symlinked_ignore_files_and_symlinked_search_roots() {
    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(outside.path().join("rules"), "*.ts\n").unwrap();
    fs::write(dir.path().join("a.ts"), "text").unwrap();
    std::os::unix::fs::symlink(outside.path().join("rules"), dir.path().join(".aiignore"))
        .unwrap();
    assert!(read_file(root, "a.ts").is_err());
    assert!(list_files(root, &ListOptions::default()).is_err());
    fs::remove_file(dir.path().join(".aiignore")).unwrap();
    fs::create_dir(dir.path().join("src")).unwrap();
    std::os::unix::fs::symlink(dir.path().join("src"), dir.path().join("alias")).unwrap();
    assert!(
        list_files(
            root,
            &ListOptions {
                path: Some("alias".into()),
                ..Default::default()
            }
        )
        .is_err()
    );
}
fn replace(old_text: &str, new_text: &str) -> Replacement {
    Replacement {
        old_text: old_text.into(),
        new_text: new_text.into(),
        replace_all: false,
    }
}
#[test]
fn edits_only_the_read_version_and_preserves_unrelated_content() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(dir.path().join("code.ts"), "before old after").unwrap();
    assert!(edit_file(root, "code.ts", "stale", &[replace("old", "new")]).is_err());
    let write = edit_file(
        root,
        "code.ts",
        "before old after",
        &[replace("old", "new")],
    )
    .unwrap();
    assert_eq!(write.previous_content.as_deref(), Some("before old after"));
    assert_eq!(write.content, "before new after");
    assert_eq!(write.path, dir.path().join("code.ts"));
    assert_eq!(
        read_file(root, "code.ts").unwrap(),
        "before new after"
    );
    let created = write_file(root, "nested/dir/new.ts", None, "created").unwrap();
    assert_eq!(created.previous_content, None);
    assert_eq!(
        read_file(root, "nested/dir/new.ts").unwrap(),
        "created"
    );
    assert!(write_file(root, "nested/dir/new.ts", None, "again").is_err());
    write_file(root, "nested/dir/new.ts", Some("created"), "replaced").unwrap();
    assert_eq!(
        read_file(root, "nested/dir/new.ts").unwrap(),
        "replaced"
    );
}
#[test]
fn applies_multiple_edits_atomically() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let original = "a = 1\nb = 2\nc = 1\n";
    fs::write(dir.path().join("code.py"), original).unwrap();
    let failed = edit_file(
        root,
        "code.py",
        original,
        &[replace("a = 1", "a = 10"), replace("missing", "x")],
    );
    assert!(failed.unwrap_err().starts_with("Edit 2"));
    assert_eq!(read_file(root, "code.py").unwrap(), original);
    assert!(
        edit_file(root, "code.py", original, &[replace("= 1", "= 3")])
            .unwrap_err()
            .contains("2 locations")
    );
    let write = edit_file(
        root,
        "code.py",
        original,
        &[
            replace("b = 2", "b = 20"),
            Replacement {
                old_text: "= 1\n".into(),
                new_text: "= 5\n".into(),
                replace_all: true,
            },
        ],
    )
    .unwrap();
    assert_eq!(write.content, "a = 5\nb = 20\nc = 5\n");
}
#[test]
fn deletes_only_the_read_version() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(dir.path().join("old.ts"), "content").unwrap();
    assert!(delete_file(root, "old.ts", "stale").is_err());
    assert!(dir.path().join("old.ts").exists());
    delete_file(root, "old.ts", "content").unwrap();
    assert!(!dir.path().join("old.ts").exists());
}
#[test]
fn lists_and_searches_respecting_gitignore_with_pages_and_context() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(dir.path().join(".gitignore"), "ignored/\n").unwrap();
    fs::create_dir_all(dir.path().join("ignored")).unwrap();
    fs::create_dir_all(dir.path().join("src/deep")).unwrap();
    fs::write(dir.path().join("ignored/hit.ts"), "needle").unwrap();
    fs::write(dir.path().join(".env"), "needle").unwrap();
    fs::write(dir.path().join("src/a.ts"), "one\nNeedle two\nthree\n").unwrap();
    fs::write(dir.path().join("src/deep/b.rs"), "fn needle_fn() {}\n").unwrap();
    fs::write(dir.path().join("src/bin.dat"), b"needle\0binary").unwrap();

    let all = list_files(root, &ListOptions::default()).unwrap();
    assert_eq!(
        all.files,
        vec![".gitignore", "src/a.ts", "src/bin.dat", "src/deep/b.rs"]
    );
    let page = list_files(
        root,
        &ListOptions {
            limit: Some(2),
            offset: Some(1),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(page.files, vec!["src/a.ts", "src/bin.dat"]);
    assert_eq!(page.next_offset, Some(3));
    assert_eq!(page.total, 4);
    let rust = list_files(
        root,
        &ListOptions {
            glob: Some("*.rs".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(rust.files, vec!["src/deep/b.rs"]);

    let found = search_files(
        root,
        &SearchOptions {
            query: "needle".into(),
            context_lines: Some(1),
            ..Default::default()
        },
    )
    .unwrap();
    let hits = found
        .matches
        .iter()
        .map(|hit| (hit.path.as_str(), hit.line))
        .collect::<Vec<_>>();
    assert_eq!(hits, vec![("src/a.ts", 2), ("src/deep/b.rs", 1)]);
    assert_eq!(found.matches[0].before, vec!["one"]);
    assert_eq!(found.matches[0].after, vec!["three"]);

    let exact = search_files(
        root,
        &SearchOptions {
            query: r"fn \w+\(".into(),
            regex: Some(true),
            path: Some("src".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(exact.matches.len(), 1);
    assert_eq!(exact.matches[0].path, "src/deep/b.rs");
    let capped = search_files(
        root,
        &SearchOptions {
            query: "needle".into(),
            max_results: Some(1),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(capped.matches.len(), 1);
    assert!(capped.truncated);
    assert!(
        search_files(
            root,
            &SearchOptions {
                query: "(".into(),
                regex: Some(true),
                ..Default::default()
            }
        )
        .is_err()
    );
}
#[cfg(unix)]
#[test]
fn refuses_symlink_escape() {
    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("secret"), "private").unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("linked")).unwrap();
    let root = dir.path();
    assert!(read_file(root, "linked/secret").is_err());
    fs::write(dir.path().join(".env"), "secret").unwrap();
    std::os::unix::fs::symlink(dir.path().join(".env"), dir.path().join("alias")).unwrap();
    assert!(read_file(root, "alias").is_err());
    assert!(write_file(root, "linked/new", None, "content").is_err());
}

#[test]
fn concurrent_writes_cannot_both_replace_the_same_expected_content() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    fs::write(dir.path().join("race.ts"), "before").unwrap();
    let start = std::sync::Arc::new(std::sync::Barrier::new(16));
    let threads: Vec<_> = (0..16)
        .map(|index| {
            let root = root.clone();
            let start = start.clone();
            std::thread::spawn(move || {
                start.wait();
                write_file(&root, "race.ts", Some("before"), &format!("winner {index}"))
            })
        })
        .collect();
    let results: Vec<_> = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    let winners: Vec<_> = results
        .iter()
        .filter_map(|result| result.as_ref().ok())
        .collect();
    assert_eq!(winners.len(), 1);
    assert_eq!(
        fs::read_to_string(dir.path().join("race.ts")).unwrap(),
        winners[0].content
    );
    assert!(
        results
            .iter()
            .filter_map(|result| result.as_ref().err())
            .all(|error| error == CHANGED_SINCE_READ)
    );
}
#[test]
fn commands_run_unasked_only_when_safe_or_allowed_and_inside_the_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir(root.join("src")).unwrap();
    assert!(command_auto_approved(root, "ls src", &[]));
    assert!(!command_auto_approved(root, "cargo test", &[]));
    assert!(command_auto_approved(root, "cargo test -p x", &["cargo test".into()]));
    assert!(!command_auto_approved(root, "rm src", &["rm".into()]));
    #[cfg(unix)]
    {
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("escape")).unwrap();
        assert!(!command_auto_approved(root, "ls escape", &[]));
    }
}

#[test]
fn results_serialize_for_the_model_in_camel_case() {
    let list = FileList { files: vec!["a".into()], total: 3, next_offset: Some(1), truncated: false };
    assert_eq!(serde_json::to_value(&list).unwrap(), serde_json::json!({ "files": ["a"], "total": 3, "nextOffset": 1, "truncated": false }));
    let options: SearchOptions = serde_json::from_value(serde_json::json!({ "query": "x", "caseSensitive": true, "contextLines": 2 })).unwrap();
    assert_eq!((options.case_sensitive, options.context_lines), (Some(true), Some(2)));
}

#[test]
fn context_policy_leaves_out_ignored_and_secret_paths() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join(".aiignore"), "private/\n*.log\n").unwrap();
    let policy = context_policy(Some(dir.path())).unwrap();
    assert!(policy.allows(&dir.path().join("src/main.rs"), false));
    assert!(!policy.allows(&dir.path().join("private/notes.md"), false));
    assert!(!policy.allows(&dir.path().join("private"), true));
    assert!(!policy.allows(&dir.path().join("build.log"), false));
    assert!(!policy.allows(&dir.path().join(".env.local"), false));
    assert!(!policy.allows(&dir.path().join("src/../.git/config"), false));
    assert!(policy.allows(Path::new("/elsewhere/build.log"), false));
    assert!(policy.allows(dir.path(), true));
    fs::create_dir(dir.path().join(".cursorignore")).ok();
    fs::remove_file(dir.path().join(".aiignore")).unwrap();
    assert!(context_policy(Some(dir.path())).is_err());
}
