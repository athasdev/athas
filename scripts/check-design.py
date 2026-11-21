#!/usr/bin/env python3
"""Reports spacing that is off the scale, and hover states that use the wrong colour.

Every gap, padding and margin in the app should be one of the scale's twelve steps. This finds
the ones that are not: a `gap(px(14.))` beside the next panel's `gap(px(12.))` is how two
surfaces that should match stop matching.

Sizes, widths, heights, radii and positions are not spacing and are not checked — they answer to
what they are measuring, not to the scale.

Spacing wider than the scale's last step is not drift either: a page's 72px top inset is a layout
decision, not a gap that slipped. Those are listed apart, as candidates for a name in `metrics`.

    python3 scripts/check-design.py            # report, exit 0
    python3 scripts/check-design.py --strict   # exit 1 when anything is off
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

# Kept in step with `ui::metrics::space::STEPS`; `crates/ui/src/metrics.rs` is the source.
STEPS = {0.0, 1.0, 2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 16.0, 20.0, 24.0, 32.0}

# The methods that place space between or around things.
SPACING = "gap|gap_x|gap_y|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr"
CALL = re.compile(rf"\.({SPACING})\(px\((\d+(?:\.\d*)?)\)\)")

# A hover background is `colors.accent`. `colors.selected` is the selected state, so a row that
# hovers with it looks selected under the pointer — and looks wrong beside a row that does not.
HOVER_BG = re.compile(r"\.hover\((?:move )?\|\w+\| ?\w+\.bg\(((?:colors|theme\.colors)\.\w+)\)")
HOVER_ALLOWED = {"colors.accent", "theme.colors.accent", "colors.segment_track"}

ROOTS = ("crates",)


def nearest(value: float) -> float:
    """The step nearest `value`; ties tighten, as `space::nearest` does."""
    return min(sorted(STEPS), key=lambda step: (abs(step - value), step))


WIDEST = max(STEPS)


def offenders(root: Path) -> tuple[dict[Path, list], dict[Path, list]]:
    """Spacing off the scale, split into drift (within the scale's range) and wide layout."""
    drift: dict[Path, list] = defaultdict(list)
    wide: dict[Path, list] = defaultdict(list)
    for source in root.rglob("*.rs"):
        for number, line in enumerate(source.read_text(errors="ignore").splitlines(), start=1):
            for method, raw in CALL.findall(line):
                value = float(raw)
                if value in STEPS:
                    continue
                (wide if value > WIDEST else drift)[source].append((number, method, value))
    return drift, wide


def hovers(root: Path) -> dict[Path, list[tuple[int, str]]]:
    """Hover backgrounds that are not the hover colour."""
    found: dict[Path, list[tuple[int, str]]] = defaultdict(list)
    for source in root.rglob("*.rs"):
        for number, line in enumerate(source.read_text(errors="ignore").splitlines(), start=1):
            for colour in HOVER_BG.findall(line):
                if colour not in HOVER_ALLOWED:
                    found[source].append((number, colour))
    return found


def main() -> int:
    strict = "--strict" in sys.argv[1:]
    base = Path(__file__).resolve().parents[1]
    drift: dict[Path, list] = {}
    wide: dict[Path, list] = {}
    for root in ROOTS:
        found_drift, found_wide = offenders(base / root)
        drift.update(found_drift)
        wide.update(found_wide)

    for source in sorted(drift):
        print(f"\n{source.relative_to(base)}")
        for number, method, value in drift[source]:
            print(f"  {number:>5}  .{method}(px({value:g}.))  ->  px({nearest(value):g}.)")

    total = sum(len(hits) for hits in drift.values())
    files = len(drift)
    if total:
        print(f"\n{total} off the scale in {files} file{'s' if files != 1 else ''}.")
        print("The scale is `ui::metrics::space`; add a step there only if a whole surface needs it.")
    else:
        print("Every gap, padding and margin is on the scale.")

    count = sum(len(hits) for hits in wide.values())
    if count:
        print(f"\n{count} wider than the scale — layout, not drift. Worth a name in `metrics` where one repeats:")
        for source in sorted(wide):
            values = ", ".join(f"{value:g}" for _, _, value in wide[source])
            print(f"  {source.relative_to(base)}: {values}")

    wrong_hovers: dict[Path, list[tuple[int, str]]] = {}
    for root in ROOTS:
        wrong_hovers.update(hovers(base / root))
    hover_count = sum(len(hits) for hits in wrong_hovers.values())
    if hover_count:
        print(f"\n{hover_count} hover background{'s' if hover_count != 1 else ''} that should be `colors.accent`:")
        for source in sorted(wrong_hovers):
            for number, colour in wrong_hovers[source]:
                print(f"  {source.relative_to(base)}:{number}  {colour}")
    else:
        print("Every hover background is the hover colour.")

    return 1 if ((total or hover_count) and strict) else 0


if __name__ == "__main__":
    raise SystemExit(main())
