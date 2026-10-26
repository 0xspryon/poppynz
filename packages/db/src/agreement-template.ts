/**
 * Service agreement templates (UAT round 2, item 4), free of I/O.
 *
 * The written agreement both parties sign is a T&C document of kind
 * `service_agreement`: admin-authored markdown with placeholders that are
 * filled from the contract terms at signing. The syntax is a small, strict
 * subset of Mustache:
 *
 *   {{family.name}}               a value (markdown-escaped when filled)
 *   {{#services}} … {{/services}} a list section, repeated per item; inside
 *                                 it the item's own names (e.g. {{name}})
 *                                 resolve first, then the outer ones
 *   {{#contract.hasEndDate}} … {{/contract.hasEndDate}}
 *                                 a flag (or a non-empty value) section,
 *                                 rendered once when set
 *   {{^services}} … {{/services}} an inverted section: rendered only when
 *                                 the flag is unset / the list or value empty
 *
 * A line holding nothing but a section tag disappears from the output, so a
 * markdown list written one item per line stays a tight list. Every name a
 * template uses must be in `agreementTemplateSchema`; admins can't save a
 * template that names anything else (validateTemplate), so a typo can never
 * reach a signed agreement as a silent blank.
 */
import type { TcLocale } from './tc-locale';

export type TemplateField = 'text' | 'flag' | { list: TemplateSchema };
export type TemplateSchema = { readonly [name: string]: TemplateField };
export type TemplateValue = string | boolean | ReadonlyArray<TemplateValues>;
export type TemplateValues = { readonly [name: string]: TemplateValue };

export type TemplateIssue = {
  code:
    | 'unknown_placeholder'
    | 'list_as_value'
    | 'unclosed_section'
    | 'mismatched_section'
    | 'unexpected_close'
    | 'malformed_tag';
  name: string;
  line: number;
};

type Node =
  | { kind: 'text'; text: string }
  | { kind: 'value'; name: string; line: number }
  | { kind: 'section'; name: string; inverted: boolean; line: number; children: Array<Node> };

const NAME = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/;

type Token =
  | { kind: 'text'; text: string }
  | {
      kind: 'tag';
      sigil: '' | '#' | '^' | '/';
      name: string;
      line: number;
      start: number;
      end: number;
    };

const lineAt = (source: string, offset: number) => source.slice(0, offset).split('\n').length;

const tokenize = (source: string, issues: Array<TemplateIssue>): Array<Token> => {
  const tokens: Array<Token> = [];
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf('{{', cursor);
    if (open === -1) {
      tokens.push({ kind: 'text', text: source.slice(cursor) });
      break;
    }
    if (open > cursor) tokens.push({ kind: 'text', text: source.slice(cursor, open) });
    const close = source.indexOf('}}', open + 2);
    const nextOpen = source.indexOf('{{', open + 2);
    if (close === -1 || (nextOpen !== -1 && nextOpen < close)) {
      const end = nextOpen === -1 ? source.length : nextOpen;
      const raw = source
        .slice(open + 2, end)
        .split('\n')[0]!
        .trim();
      issues.push({ code: 'malformed_tag', name: raw, line: lineAt(source, open) });
      tokens.push({ kind: 'text', text: source.slice(open, end) });
      cursor = end;
      continue;
    }
    const inner = source.slice(open + 2, close).trim();
    const sigil = (['#', '^', '/'] as const).find((candidate) => inner.startsWith(candidate)) ?? '';
    const name = inner.slice(sigil.length).trim();
    const line = lineAt(source, open);
    if (!NAME.test(name)) {
      issues.push({ code: 'malformed_tag', name: inner, line });
      tokens.push({ kind: 'text', text: source.slice(open, close + 2) });
    } else {
      tokens.push({ kind: 'tag', sigil, name, line, start: open, end: close + 2 });
    }
    cursor = close + 2;
  }
  return tokens;
};

/** Removes the line of a section tag that stands alone on its line: the
 * whitespace before it (back to the newline) and after it (through the
 * newline) go, so the tag leaves no blank line behind. */
const stripStandaloneLines = (tokens: Array<Token>) => {
  tokens.forEach((token, index) => {
    if (token.kind !== 'tag' || token.sigil === '') return;
    const before = tokens[index - 1];
    const after = tokens[index + 1];
    const beforeText = before?.kind === 'text' ? before.text : index === 0 ? '' : null;
    const afterText = after?.kind === 'text' ? after.text : index === tokens.length - 1 ? '' : null;
    if (beforeText === null || afterText === null) return;
    const lastNewline = beforeText.lastIndexOf('\n');
    const leading = beforeText.slice(lastNewline + 1);
    // The line must start at a newline (or the document start).
    if (lastNewline === -1 && index !== 0 && before !== tokens[0]) return;
    if (leading.trim() !== '') return;
    const newline = afterText.indexOf('\n');
    const trailing = newline === -1 ? afterText : afterText.slice(0, newline);
    if (trailing.trim() !== '') return;
    if (newline === -1 && index !== tokens.length - 2 && after !== tokens[tokens.length - 1])
      return;
    if (before?.kind === 'text') before.text = beforeText.slice(0, lastNewline + 1);
    if (after?.kind === 'text') after.text = newline === -1 ? '' : afterText.slice(newline + 1);
  });
};

export const parseTemplate = (
  source: string
): { nodes: Array<Node>; issues: Array<TemplateIssue> } => {
  const issues: Array<TemplateIssue> = [];
  const tokens = tokenize(source, issues);
  stripStandaloneLines(tokens);
  const root: Array<Node> = [];
  const stack: Array<{ name: string; line: number; children: Array<Node> }> = [];
  const target = () => stack[stack.length - 1]?.children ?? root;
  for (const token of tokens) {
    if (token.kind === 'text') {
      if (token.text) target().push({ kind: 'text', text: token.text });
      continue;
    }
    if (token.sigil === '') {
      target().push({ kind: 'value', name: token.name, line: token.line });
    } else if (token.sigil === '/') {
      const open = stack[stack.length - 1];
      if (!open) {
        issues.push({ code: 'unexpected_close', name: token.name, line: token.line });
      } else if (open.name !== token.name) {
        issues.push({ code: 'mismatched_section', name: token.name, line: token.line });
      } else {
        stack.pop();
      }
    } else {
      const section: Node = {
        kind: 'section',
        name: token.name,
        inverted: token.sigil === '^',
        line: token.line,
        children: []
      };
      target().push(section);
      stack.push({ name: token.name, line: token.line, children: section.children });
    }
  }
  // Only the innermost unclosed section is reported — its parents are
  // unclosed by consequence.
  const unclosed = stack[stack.length - 1];
  if (unclosed && !issues.some((issue) => issue.code === 'mismatched_section')) {
    issues.push({ code: 'unclosed_section', name: unclosed.name, line: unclosed.line });
  }
  return { nodes: root, issues };
};

const resolveField = (scopes: ReadonlyArray<TemplateSchema>, name: string) => {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const field = scopes[index]![name];
    if (field !== undefined) return field;
  }
  return undefined;
};

/** Every problem with `source` against `schema`, in document order. */
export const validateTemplate = (source: string, schema: TemplateSchema): Array<TemplateIssue> => {
  const { nodes, issues } = parseTemplate(source);
  const walk = (children: ReadonlyArray<Node>, scopes: ReadonlyArray<TemplateSchema>) => {
    for (const node of children) {
      if (node.kind === 'text') continue;
      const field = resolveField(scopes, node.name);
      if (field === undefined) {
        issues.push({ code: 'unknown_placeholder', name: node.name, line: node.line });
        if (node.kind === 'section') walk(node.children, scopes);
        continue;
      }
      if (node.kind === 'value') {
        if (typeof field === 'object') {
          issues.push({ code: 'list_as_value', name: node.name, line: node.line });
        }
        continue;
      }
      walk(
        node.children,
        typeof field === 'object' && !node.inverted ? [...scopes, field.list] : scopes
      );
    }
  };
  walk(nodes, [schema]);
  return issues.sort((a, b) => a.line - b.line);
};

/** Backslash-escapes the markdown a filled value could otherwise carry
 * (links, emphasis, headings, tables, html) and folds newlines, so a name or
 * an expectation can't restructure the agreement around it. */
export const escapeMarkdownInline = (value: string) =>
  value.replace(/\r?\n+/g, ' ').replace(/[\\`*_[\]<>#|~]/g, (char) => `\\${char}`);

const resolveValue = (scopes: ReadonlyArray<TemplateValues>, name: string) => {
  for (let index = scopes.length - 1; index >= 0; index--) {
    if (Object.hasOwn(scopes[index]!, name)) return scopes[index]![name];
  }
  return undefined;
};

const isSet = (value: TemplateValue | undefined) =>
  Array.isArray(value)
    ? value.length > 0
    : value === true || (typeof value === 'string' && value !== '');

/**
 * Fills `source` from `values`. Callers validate first (an invalid template
 * never renders in the signing path); an unknown name renders empty here.
 */
export const renderTemplate = (
  source: string,
  _schema: TemplateSchema,
  values: TemplateValues
): string => {
  const { nodes } = parseTemplate(source);
  const walk = (children: ReadonlyArray<Node>, scopes: ReadonlyArray<TemplateValues>): string =>
    children
      .map((node) => {
        if (node.kind === 'text') return node.text;
        const value = resolveValue(scopes, node.name);
        if (node.kind === 'value') {
          return typeof value === 'string' ? escapeMarkdownInline(value) : '';
        }
        if (node.inverted) return isSet(value) ? '' : walk(node.children, scopes);
        if (Array.isArray(value)) {
          return value.map((item) => walk(node.children, [...scopes, item])).join('');
        }
        return isSet(value) ? walk(node.children, scopes) : '';
      })
      .join('');
  return walk(nodes, [values]);
};

// ---------------------------------------------------------------------------
// The service agreement's placeholders

const taxLine = { list: { label: 'text', amount: 'text' } } as const;

/**
 * Every placeholder a service agreement template may use. Values are
 * pre-formatted for the template's language (money, dates, times in the
 * contract's zone). Amounts are for one week of the agreed pattern.
 */
export const agreementTemplateSchema = {
  // The template revision being signed and its language.
  'agreement.version': 'text',
  'agreement.language': 'text',
  // The contract and the version of its terms being signed.
  'contract.reference': 'text',
  'contract.version': 'text',
  'contract.startsOn': 'text',
  'contract.hasEndDate': 'flag',
  'contract.endsOn': 'text',
  'contract.endsAt': 'text',
  'contract.timeZone': 'text',
  'contract.currency': 'text',
  // The parties.
  'family.name': 'text',
  'family.city': 'text',
  'family.province': 'text',
  'family.location': 'text',
  'helper.name': 'text',
  'helper.city': 'text',
  'helper.province': 'text',
  'helper.location': 'text',
  // The services, each with its agreed rate, expectations and sessions.
  services: {
    list: {
      name: 'text',
      rate: 'text',
      hasExpectations: 'flag',
      expectations: 'text',
      weeklyHours: 'text',
      weeklyAmount: 'text',
      sessions: { list: { day: 'text', start: 'text', end: 'text', hours: 'text' } }
    }
  },
  // Every weekly session across services, in weekday then time order.
  schedule: { list: { day: 'text', start: 'text', end: 'text', hours: 'text', service: 'text' } },
  'schedule.weeklyHours': 'text',
  // Money for one week of the pattern.
  'fees.weeklyCare': 'text',
  'fees.careTaxes': taxLine,
  'fees.familyFeePercent': 'text',
  'fees.familyFee': 'text',
  'fees.familyFeeTaxes': taxLine,
  'fees.familyWeeklyTotal': 'text',
  'fees.commissionPercent': 'text',
  'fees.commission': 'text',
  'fees.commissionTaxes': taxLine,
  'fees.helperWeeklyShare': 'text',
  // Billing rules.
  'billing.cycleDays': 'text',
  'billing.holdLeadHours': 'text',
  'billing.retryHours': 'text',
  // Ending the contract.
  'notice.days': 'text',
  // The cancellation policy in force (the Terms of Service revision).
  'cancellation.policyTitle': 'text',
  'cancellation.policyVersion': 'text',
  'cancellation.policyPublishedOn': 'text'
} as const satisfies TemplateSchema;

/** A filled-in example for the admin preview, in the template's language. */
export const sampleAgreementValues = (locale: TcLocale): TemplateValues => {
  const fr = locale === 'fr';
  const money = (cents: number) =>
    new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD' }).format(
      cents / 100
    );
  const tax = (label: string, cents: number) => [{ label, amount: money(cents) }];
  return {
    'agreement.version': '1',
    'agreement.language': fr ? 'Français' : 'English',
    'contract.reference': '0198a3b0-0000-7000-8000-00000000c001',
    'contract.version': '1',
    'contract.startsOn': fr ? 'lundi 5 janvier 2099' : 'Monday, January 5, 2099',
    'contract.hasEndDate': true,
    'contract.endsOn': fr ? 'vendredi 26 juin 2099' : 'Friday, June 26, 2099',
    'contract.endsAt': fr ? '18 h' : '6:00 p.m.',
    'contract.timeZone': fr ? 'heure du Centre (Winnipeg)' : 'Central Time (Winnipeg)',
    'contract.currency': 'CAD',
    'family.name': 'Priya Sample',
    'family.city': 'Winnipeg',
    'family.province': 'MB',
    'family.location': 'Winnipeg, MB',
    'helper.name': 'Maria Sample',
    'helper.city': 'Winnipeg',
    'helper.province': 'MB',
    'helper.location': 'Winnipeg, MB',
    services: [
      {
        name: fr ? 'Garde d’enfants' : 'Childcare',
        rate: money(2600),
        hasExpectations: true,
        expectations: fr
          ? 'Aide aux devoirs et collation après l’école.'
          : 'Homework help and a snack after school.',
        weeklyHours: '4',
        weeklyAmount: money(10400),
        sessions: [
          {
            day: fr ? 'mardi' : 'Tuesday',
            start: fr ? '15 h 30' : '3:30 p.m.',
            end: fr ? '17 h 30' : '5:30 p.m.',
            hours: '2'
          },
          {
            day: fr ? 'jeudi' : 'Thursday',
            start: fr ? '15 h 30' : '3:30 p.m.',
            end: fr ? '17 h 30' : '5:30 p.m.',
            hours: '2'
          }
        ]
      }
    ],
    schedule: [
      {
        day: fr ? 'mardi' : 'Tuesday',
        start: fr ? '15 h 30' : '3:30 p.m.',
        end: fr ? '17 h 30' : '5:30 p.m.',
        hours: '2',
        service: fr ? 'Garde d’enfants' : 'Childcare'
      },
      {
        day: fr ? 'jeudi' : 'Thursday',
        start: fr ? '15 h 30' : '3:30 p.m.',
        end: fr ? '17 h 30' : '5:30 p.m.',
        hours: '2',
        service: fr ? 'Garde d’enfants' : 'Childcare'
      }
    ],
    'schedule.weeklyHours': '4',
    'fees.weeklyCare': money(10400),
    'fees.careTaxes': [],
    'fees.familyFeePercent': fr ? '5 %' : '5%',
    'fees.familyFee': money(520),
    'fees.familyFeeTaxes': tax(fr ? 'TPS' : 'GST', 26),
    'fees.familyWeeklyTotal': money(10946),
    'fees.commissionPercent': fr ? '15 %' : '15%',
    'fees.commission': money(1560),
    'fees.commissionTaxes': tax(fr ? 'TPS' : 'GST', 78),
    'fees.helperWeeklyShare': money(8762),
    'billing.cycleDays': '3',
    'billing.holdLeadHours': '24',
    'billing.retryHours': '12',
    'notice.days': '14',
    'cancellation.policyTitle': fr
      ? 'Conditions d’utilisation et politique de paiement'
      : 'Terms of Service and Payment Policy',
    'cancellation.policyVersion': '1',
    'cancellation.policyPublishedOn': fr ? '1 octobre 2026' : 'October 1, 2026'
  };
};

/** Placeholder names in document order, for the admin reference panel. */
export const agreementPlaceholderNames = (schema: TemplateSchema = agreementTemplateSchema) => {
  const names: Array<{ name: string; kind: 'text' | 'flag' | 'list'; within: string | null }> = [];
  const walk = (fields: TemplateSchema, within: string | null) => {
    for (const [name, field] of Object.entries(fields)) {
      names.push({ name, kind: typeof field === 'object' ? 'list' : field, within });
      if (typeof field === 'object') walk(field.list, name);
    }
  };
  walk(schema, null);
  return names;
};
