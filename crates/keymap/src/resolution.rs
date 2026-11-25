//! What the bindings in effect actually resolve to, surface by surface. GPUI picks the binding
//! whose key context matches deepest in the focused element's chain, so a binding can be bound
//! and still never run: in a window whose root it does not name, or under another binding on the
//! same key. These tests pin down where each default binding runs.

use std::rc::Rc;

use gpui::{KeyBinding, KeyBindingContextPredicate, KeyContext, Keymap, Keystroke, OperatingSystem, SharedString, TestAppContext};

use crate::{Keybinding, default_bindings, effective_bindings, to_gpui_keystrokes, when};

/// Stands in for the action a command runs, so a resolved binding names its command.
#[derive(Clone, Debug, PartialEq, gpui::Action)]
#[action(namespace = keymap_test, no_json)]
struct Run {
    command: SharedString,
}

/// The key contexts of a focused element's chain, root first, as the app builds them.
fn stack(levels: &[&str]) -> Vec<KeyContext> {
    levels.iter().map(|level| KeyContext::parse(level).unwrap()).collect()
}

/// The surfaces a key can be pressed in, each with the context chain the app draws there.
fn surfaces() -> Vec<(&'static str, Vec<KeyContext>)> {
    let workbench = when::WORKBENCH_CONTEXT;
    vec![
        ("the workbench itself", stack(&[workbench])),
        ("an editor", stack(&[workbench, "EditorPane", "Editor"])),
        ("an editor holding agent changes", stack(&[workbench, "EditorPane", "Editor agent_hunk"])),
        ("the find field", stack(&[workbench, "EditorPane", "EditorFind", "TextInput"])),
        ("a terminal", stack(&[workbench, "TerminalPanel", "TerminalTabs", "Terminal"])),
        ("the file tree", stack(&[workbench, "FileTree"])),
        ("an agent session", stack(&[workbench, "AgentSession"])),
        ("a browser tab", stack(&[workbench, "Browser"])),
        ("a settings window", stack(&[when::DETACHED_CONTEXT])),
    ]
}

struct Bound {
    keymap: Keymap,
    bindings: Vec<Keybinding>,
}

impl Bound {
    /// The bindings in effect, loaded the way `keymap::bind` loads them.
    fn new(cx: &gpui::App) -> Self {
        let bindings = effective_bindings("none", &[]);
        let mut loaded: Vec<KeyBinding> = bindings
            .iter()
            .filter_map(|binding| {
                let keystrokes = to_gpui_keystrokes(&binding.key)?;
                let predicate = KeyBindingContextPredicate::parse(&when::to_context_predicate(binding.when.as_deref())).ok()?;
                let action = Box::new(Run { command: binding.command.clone().into() });
                KeyBinding::load(&keystrokes, action, Some(Rc::new(predicate)), false, None, cx).ok()
            })
            .collect();
        // `bind` binds in reverse so the earlier binding of a key wins, as the web workbench does.
        loaded.reverse();
        let mut keymap = Keymap::default();
        keymap.add_bindings(loaded);
        Self { keymap, bindings }
    }

    /// The commands `key` runs in `contexts`, the one GPUI would run first.
    fn resolve(&self, key: &str, contexts: &[KeyContext]) -> Vec<String> {
        let Some(keystrokes) = to_gpui_keystrokes(key) else { return Vec::new() };
        let keystrokes: Vec<Keystroke> =
            keystrokes.split_whitespace().filter_map(|chord| Keystroke::parse_with_os(chord, OperatingSystem::Mac).ok()).collect();
        let (matched, _) = self.keymap.bindings_for_input(&keystrokes, contexts);
        matched.iter().filter_map(|binding| binding.action().as_any().downcast_ref::<Run>()).map(|run| run.command.to_string()).collect()
    }

    fn runs_first(&self, key: &str, command: &str, contexts: &[KeyContext]) -> bool {
        self.resolve(key, contexts).first().is_some_and(|first| first == command)
    }
}

#[gpui::test]
fn every_default_binding_runs_in_some_surface(cx: &mut TestAppContext) {
    cx.update(|cx| {
        let bound = Bound::new(cx);
        let surfaces = surfaces();
        let dead: Vec<&str> = bound
            .bindings
            .iter()
            .filter(|binding| !surfaces.iter().any(|(_, contexts)| bound.runs_first(&binding.key, &binding.command, contexts)))
            .map(|binding| binding.command.as_str())
            .collect();
        assert!(dead.is_empty(), "bound but never reached: {dead:?}");
    });
}

#[gpui::test]
fn a_binding_runs_in_the_surface_its_clause_names(cx: &mut TestAppContext) {
    cx.update(|cx| {
        let bound = Bound::new(cx);
        let surface = |name: &str| surfaces().into_iter().find(|(label, _)| *label == name).unwrap().1;
        for (clause, name) in [
            ("editorFocus", "an editor"),
            ("terminalFocus", "a terminal"),
            ("browserFocus", "a browser tab"),
            ("agentSessionFocus", "an agent session"),
        ] {
            let contexts = surface(name);
            for binding in default_bindings().iter().filter(|binding| binding.when.as_deref() == Some(clause)) {
                assert!(
                    bound.resolve(&binding.key, &contexts).contains(&binding.command),
                    "{} ({}) does not run in {name}",
                    binding.command,
                    binding.key
                );
            }
        }
    });
}

#[gpui::test]
fn a_binding_that_holds_anywhere_runs_in_every_window(cx: &mut TestAppContext) {
    cx.update(|cx| {
        let bound = Bound::new(cx);
        // A settings or extensions window is not the workbench; the keys with no clause still
        // have to reach it.
        let detached = stack(&[when::DETACHED_CONTEXT]);
        for binding in default_bindings().iter().filter(|binding| binding.when.is_none()) {
            assert!(bound.runs_first(&binding.key, &binding.command, &detached), "{} ({}) does not run in a detached window", binding.command, binding.key);
        }
    });
}

#[gpui::test]
fn no_surface_shadows_a_command_out_of_every_surface(cx: &mut TestAppContext) {
    cx.update(|cx| {
        let bound = Bound::new(cx);
        // A command with one binding has to win it somewhere a person is likely to be. The agent
        // launcher once shared Cmd+Shift+Space with the editor's parameter hints, so it could not
        // be reached from the one place it is wanted most.
        for (key, command, name) in [("cmd+alt+n", "workbench.agentLauncher", "an editor"), ("cmd+shift+space", "editor.triggerParameterHints", "an editor")] {
            let contexts = surfaces().into_iter().find(|(label, _)| *label == name).unwrap().1;
            assert!(bound.runs_first(key, command, &contexts), "{command} ({key}) does not run in {name}");
        }
    });
}

#[gpui::test]
fn question_mark_help_stays_out_of_text_fields(cx: &mut TestAppContext) {
    cx.update(|cx| {
        let bound = Bound::new(cx);
        let surface = |name: &str| surfaces().into_iter().find(|(label, _)| *label == name).unwrap().1;
        assert!(bound.runs_first("shift+?", "help.shortcuts", &surface("the workbench itself")));
        for name in ["an editor", "a terminal", "an agent session", "the find field"] {
            let commands = bound.resolve("shift+?", &surface(name));
            assert!(!commands.iter().any(|command| command == "help.shortcuts"), "help.shortcuts fired in {name}");
        }
    });
}

#[gpui::test]
fn a_detached_window_closes_with_the_key_that_closes_a_tab(cx: &mut TestAppContext) {
    cx.update(|cx| {
        let bound = Bound::new(cx);
        let key = if cfg!(target_os = "macos") { "cmd+w" } else { "ctrl+w" };
        assert!(bound.runs_first(key, "workbench.closeWindow", &stack(&[when::DETACHED_CONTEXT])));
        // The workbench still closes a tab with it.
        assert!(bound.runs_first(key, "file.close", &stack(&[when::WORKBENCH_CONTEXT, "EditorPane", "Editor"])));
    });
}

#[gpui::test]
fn the_find_keys_run_while_the_find_field_has_the_keyboard(cx: &mut TestAppContext) {
    cx.update(|cx| {
        let bound = Bound::new(cx);
        let find_field = surfaces().into_iter().find(|(name, _)| *name == "the find field").unwrap().1;
        for (key, command) in
            [("cmd+g", "editor.findNext"), ("cmd+shift+g", "editor.findPrevious"), ("cmd+s", "file.save"), ("cmd+f", "workbench.showFind")]
        {
            assert!(bound.runs_first(key, command, &find_field), "{command} ({key}) does not run from the find field");
        }
    });
}
