import { describe, expect, it } from 'bun:test';
import {
  agreementTemplateSchema,
  escapeMarkdownInline,
  parseTemplate,
  renderTemplate,
  sampleAgreementValues,
  validateTemplate,
  type TemplateSchema
} from './agreement-template';

const schema: TemplateSchema = {
  'family.name': 'text',
  'contract.hasEndDate': 'flag',
  'contract.endsOn': 'text',
  services: {
    list: {
      name: 'text',
      rate: 'text',
      sessions: { list: { day: 'text', start: 'text' } }
    }
  }
};

const values = {
  'family.name': 'Priya Tester',
  'contract.hasEndDate': false,
  'contract.endsOn': '',
  services: [
    {
      name: 'Childcare',
      rate: '$26.00',
      sessions: [
        { day: 'Tuesday', start: '3:30 p.m.' },
        { day: 'Thursday', start: '3:30 p.m.' }
      ]
    }
  ]
};

const render = (template: string) => {
  const issues = validateTemplate(template, schema);
  expect(issues).toEqual([]);
  return renderTemplate(template, schema, values);
};

describe('agreement template placeholders', () => {
  it('fills a value placeholder, tolerating spaces inside the braces', () => {
    expect(render('Between {{family.name}} and {{ family.name }}.')).toBe(
      'Between Priya Tester and Priya Tester.'
    );
  });

  it('repeats a list section per item, resolving names inside it first', () => {
    expect(render('{{#services}}{{name}} at {{rate}}; {{/services}}')).toBe(
      'Childcare at $26.00; '
    );
  });

  it('nests list sections and still reads outer names', () => {
    expect(
      render(
        '{{#services}}{{#sessions}}{{day}} {{start}} ({{name}}, {{family.name}})|{{/sessions}}{{/services}}'
      )
    ).toBe(
      'Tuesday 3:30 p.m. (Childcare, Priya Tester)|Thursday 3:30 p.m. (Childcare, Priya Tester)|'
    );
  });

  it('drops lines that hold only a section tag, so markdown lists stay tight', () => {
    const template = ['Services:', '{{#services}}', '- {{name}}', '{{/services}}', 'End.'].join(
      '\n'
    );
    expect(render(template)).toBe(['Services:', '- Childcare', 'End.'].join('\n'));
  });

  it('renders a flag section only when the flag is set, and an inverted one otherwise', () => {
    expect(
      render('{{#contract.hasEndDate}}Ends {{contract.endsOn}}.{{/contract.hasEndDate}}')
    ).toBe('');
    expect(render('{{^contract.hasEndDate}}No end date.{{/contract.hasEndDate}}')).toBe(
      'No end date.'
    );
  });

  it('treats an empty list as false in an inverted section', () => {
    const issues = validateTemplate('{{^services}}none{{/services}}', schema);
    expect(issues).toEqual([]);
    expect(
      renderTemplate('{{^services}}none{{/services}}', schema, { ...values, services: [] })
    ).toBe('none');
  });

  it('escapes markdown in filled values so a name cannot inject links or headings', () => {
    const output = renderTemplate('{{family.name}}', schema, {
      ...values,
      'family.name': '[click](https://evil.example) # *bold*\nnext'
    });
    expect(output).toBe('\\[click\\](https://evil.example) \\# \\*bold\\* next');
    expect(escapeMarkdownInline('a_b|c`d<e>')).toBe('a\\_b\\|c\\`d\\<e\\>');
  });
});

describe('agreement template validation', () => {
  it('reports an unknown placeholder with its line', () => {
    expect(validateTemplate('Hello\n{{family.nmae}}', schema)).toEqual([
      { code: 'unknown_placeholder', name: 'family.nmae', line: 2 }
    ]);
  });

  it('does not see list item names outside their section', () => {
    expect(validateTemplate('{{name}}', schema)).toEqual([
      { code: 'unknown_placeholder', name: 'name', line: 1 }
    ]);
  });

  it('refuses a list used as a value', () => {
    expect(validateTemplate('{{services}}', schema)).toEqual([
      { code: 'list_as_value', name: 'services', line: 1 }
    ]);
  });

  it('reports unclosed and mismatched sections', () => {
    expect(validateTemplate('{{#services}}x', schema)).toEqual([
      { code: 'unclosed_section', name: 'services', line: 1 }
    ]);
    expect(validateTemplate('{{#services}}x{{/contract.hasEndDate}}', schema)).toEqual([
      { code: 'mismatched_section', name: 'contract.hasEndDate', line: 1 }
    ]);
    expect(validateTemplate('x{{/services}}', schema)).toEqual([
      { code: 'unexpected_close', name: 'services', line: 1 }
    ]);
  });

  it('reports a malformed tag', () => {
    expect(validateTemplate('{{ family name }}', schema)).toEqual([
      { code: 'malformed_tag', name: 'family name', line: 1 }
    ]);
    expect(validateTemplate('{{family.name', schema)).toEqual([
      { code: 'malformed_tag', name: 'family.name', line: 1 }
    ]);
  });

  it('parses text without placeholders untouched', () => {
    expect(parseTemplate('plain {text} only').issues).toEqual([]);
    expect(renderTemplate('plain {text} only', schema, values)).toBe('plain {text} only');
  });
});

describe('the service agreement placeholder set', () => {
  it('ships sample values for every placeholder, so the admin preview renders anything valid', () => {
    const sample = sampleAgreementValues('en');
    const check = (fields: TemplateSchema, scope: Record<string, unknown>) => {
      for (const [name, field] of Object.entries(fields)) {
        expect(Object.hasOwn(scope, name)).toBe(true);
        if (typeof field === 'object') {
          const items = scope[name] as Array<Record<string, unknown>>;
          // An empty sample list (no tax on care) has no item to check.
          if (items.length > 0) check(field.list, items[0]!);
        }
      }
    };
    check(agreementTemplateSchema, sample);
  });

  it('has French sample values too', () => {
    expect(sampleAgreementValues('fr')['contract.startsOn']).not.toBe(
      sampleAgreementValues('en')['contract.startsOn']
    );
  });
});

describe('agreement value formatting', () => {
  it('formats money, dates, times, weekdays, hours and percentages per language', async () => {
    const {
      formatAgreementDate,
      formatAgreementHours,
      formatAgreementMoney,
      formatAgreementPercent,
      formatAgreementTime,
      formatAgreementWeekday
    } = await import('./agreement-template');
    expect(formatAgreementMoney(2600, 'en')).toBe('$26.00');
    expect(formatAgreementMoney(2600, 'fr').replace(/\s/g, ' ')).toBe('26,00 $');
    expect(formatAgreementDate('2099-01-05', 'en')).toBe('Monday, January 5, 2099');
    expect(formatAgreementDate('2099-01-05', 'fr')).toBe('lundi 5 janvier 2099');
    expect(formatAgreementTime(930, 'en')).toBe('3:30 p.m.');
    expect(formatAgreementTime(0, 'en')).toBe('12:00 a.m.');
    expect(formatAgreementTime(720, 'en')).toBe('12:00 p.m.');
    expect(formatAgreementTime(930, 'fr')).toBe('15 h 30');
    expect(formatAgreementTime(1080, 'fr')).toBe('18 h');
    expect(formatAgreementTime(1440, 'fr')).toBe('minuit');
    expect(formatAgreementWeekday(0, 'en')).toBe('Monday');
    expect(formatAgreementWeekday(6, 'fr')).toBe('dimanche');
    expect(formatAgreementHours(150, 'en')).toBe('2.5');
    expect(formatAgreementHours(150, 'fr')).toBe('2,5');
    expect(formatAgreementPercent(500, 'en')).toBe('5%');
    expect(formatAgreementPercent(1500, 'fr').replace(/\s/g, ' ')).toBe('15 %');
  });
});
