# What the 4.2.4 converter does with CSS

Converted to props: width/height/min/max, padding, margin (shorthand and longhands), border-* (shorthand `border: 1.5px solid #x` ok), border-radius, background-color, background-image/size/position (via `background` shorthand or longhands), color, font-family/size/weight/style, line-height (unitless ok), letter-spacing, text-align, text-transform, text-decoration, display, flex-direction, flex-wrap, gap, justify-*, align-*, order, flex (grow/shrink/basis), grid-template-columns/rows (raw string), grid-column/row, position, inset-block-start/inset-inline-end/inset-block-end/inset-inline-start (also top/right/bottom/left -> converted to logical), z-index, overflow, opacity, object-fit, box-shadow, filter, backdrop-filter, transform, transform-origin, transition (duration kept, easing DROPPED), clamp()/min()/max() as custom sizes, var(--label) -> variable reference.

Dropped (lands in customCss, which Free strips): `font` shorthand, `inset` shorthand, `text-wrap`, `text-underline-offset`, `text-decoration-thickness`, descendant or pseudo-element selectors (impossible by construction).

Rejected: `animation`, `animation-*`. Use an `anim-*` class.

Breakpoints: desktop (base), tablet (<=1024), mobile (<=767). States: hover, focus, active as `desktop:hover`.
