export type VariableType = "global-color-variable" | "global-font-variable";
export type Variable = { label: string; type: VariableType; value: string };

const color = (label: string, value: string): Variable => ({ label, type: "global-color-variable", value });
const font = (label: string, value: string): Variable => ({ label, type: "global-font-variable", value });

export const VARIABLES: Variable[] = [
  color("navy", "#1A3375"),
  color("sky", "#37B5FF"),
  color("sky-hover", "#1FA6F3"),
  color("sky-light", "#8FCDFF"),
  color("teal", "#005782"),
  color("ink", "#001E30"),
  color("muted", "#444650"),
  color("muted-2", "#757681"),
  color("page", "#F7F9FF"),
  color("white", "#FFFFFF"),
  color("line", "#D6E2F2"),
  color("line-2", "#C5C6D2"),
  color("tint", "#E1F0FF"),
  color("tint-2", "#ECF4FF"),
  color("tint-line", "#CBE6FF"),
  color("chip-bg", "#D6EBFF"),
  color("pink", "#FCE3F4"),
  color("pink-line", "#F5C9E4"),
  color("magenta", "#EA42B9"),
  color("magenta-ink", "#A5106F"),
  color("ok", "#0B7A52"),
  color("ok-bg", "#E3F4EC"),
  color("navy-text", "#B9C6E8"),
  color("navy-note", "#8B9BC9"),
  color("orange", "#F26E21"),
  color("orange-bg", "#FDEBE0"),
  color("orange-line", "#F5C9A8"),
  font("font-display", "Hanken Grotesk"),
  font("font-body", "Inter"),
];

const LABELS = new Set(VARIABLES.map((x) => x.label));

export function v(label: string): string {
  if (!LABELS.has(label)) throw new Error(`v(): variable "${label}" is not declared in tokens.ts`);
  return `var(--${label})`;
}
