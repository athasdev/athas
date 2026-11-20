//! Text plans an agent writes in Plan mode (`plan-parser.ts`): `[PLAN_BLOCK]` with `[STEP]`
//! title lines and their descriptions, shown as a plan card with Execute Plan.

pub const PLAN_START: &str = "[PLAN_BLOCK]";
pub const PLAN_END: &str = "[/PLAN_BLOCK]";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlanStep {
    pub index: usize,
    pub title: String,
    pub description: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedPlan {
    pub before_plan: String,
    pub steps: Vec<PlanStep>,
    pub after_plan: String,
}

/// Whether `content` holds a complete plan block (`hasPlanBlock`).
pub fn has_plan_block(content: &str) -> bool {
    content.contains(PLAN_START) && content.contains(PLAN_END)
}

/// The first plan block in `content` with the text around it, or `None` without one that has
/// steps (`parsePlan`).
pub fn parse_plan(content: &str) -> Option<ParsedPlan> {
    let start = content.find(PLAN_START)?;
    let body_start = start + PLAN_START.len();
    let body_end = body_start + content[body_start..].find(PLAN_END)?;
    let before_plan = content[..start].trim().to_string();
    let after_plan = content[body_end + PLAN_END.len()..].trim().to_string();
    let steps: Vec<PlanStep> = parse_steps(&content[body_start..body_end])
        .into_iter()
        .enumerate()
        .map(|(index, (title, description))| PlanStep { index, title, description })
        .collect();
    (!steps.is_empty()).then_some(ParsedPlan { before_plan, steps, after_plan })
}

/// `/\[STEP\]\s*(.*?)(?:\n([\s\S]*?))?\[\/STEP\]/g`: the title runs to the end of its line, the
/// description from the next line to `[/STEP]`.
fn parse_steps(body: &str) -> Vec<(String, String)> {
    const OPEN: &str = "[STEP]";
    const CLOSE: &str = "[/STEP]";
    let mut steps = Vec::new();
    let mut rest = body;
    while let Some(open) = rest.find(OPEN) {
        let after = rest[open + OPEN.len()..].trim_start();
        let Some(close) = after.find(CLOSE) else { break };
        let inner = &after[..close];
        let (title, description) = match inner.find('\n') {
            Some(newline) => (&inner[..newline], &inner[newline + 1..]),
            None => (inner, ""),
        };
        steps.push((title.trim().to_string(), description.trim().to_string()));
        rest = &after[close + CLOSE.len()..];
    }
    steps
}

/// The follow-up Execute Plan sends for a step (`handleExecuteStep`).
pub fn execute_step_prompt(step: &PlanStep) -> String {
    format!("Execute step {} of the plan: {}\n\n{}", step.index + 1, step.title, step.description)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_steps_and_the_text_around_the_plan() {
        let content = "Here is the plan.\n[PLAN_BLOCK]\n[STEP] Add the parser\nWrite `plan.rs`.\nWith tests.\n[/STEP]\n[STEP] Wire it up[/STEP]\n[/PLAN_BLOCK]\nThen ship.";
        assert!(has_plan_block(content));
        let plan = parse_plan(content).unwrap();
        assert_eq!(plan.before_plan, "Here is the plan.");
        assert_eq!(plan.after_plan, "Then ship.");
        assert_eq!(plan.steps.len(), 2);
        assert_eq!(plan.steps[0], PlanStep { index: 0, title: "Add the parser".into(), description: "Write `plan.rs`.\nWith tests.".into() });
        assert_eq!(plan.steps[1], PlanStep { index: 1, title: "Wire it up".into(), description: String::new() });
        assert_eq!(execute_step_prompt(&plan.steps[0]), "Execute step 1 of the plan: Add the parser\n\nWrite `plan.rs`.\nWith tests.");
    }

    #[test]
    fn needs_a_closed_block_with_steps() {
        assert!(!has_plan_block("[PLAN_BLOCK] [STEP] a"));
        assert_eq!(parse_plan("[PLAN_BLOCK]\n[STEP] a\n[/PLAN_BLOCK]"), None);
        assert_eq!(parse_plan("[PLAN_BLOCK]no steps[/PLAN_BLOCK]"), None);
    }
}
