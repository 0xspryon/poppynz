# Worker brief template (one page per worker)

You are building the "<Page title>" page (key `<key>`) of poppynz.com as an Elementor V4 page in EN and FR.
Read in order: .claude/skills/elementor-v4-port/SKILL.md, references/poppynz.md, references/pitfalls.md,
references/css-cheatsheet.md, apps/landing-page/builder/src/{classes.ts,dsl.ts,recipes/home.ts}.

Task
- Design source: apps/landing-page/design/<file>.html. Render it with dump_design.sh and Read the slices.
- Write content/<key>.ts (en + fr, same keys) and recipes/<key>.ts; register in cli.ts RECIPES.
- Reuse existing classes; add a class in classes.ts only when two or more elements share it, and name it after site.css.
- Run bun test, bun run build; pack, push, unpack, import (staging server), verify; render and compare; editor check.
- Earlier pages' JSON in json-artefacts/current must stay byte-identical unless you changed a shared class; explain any diff.
- Commit builder + artefact together.

Report: page URLs (en, fr) and post ids · import report summary (created/updated/unchanged) · render comparison findings
and remaining deviations · classes added · anything unfinished, stated plainly.
