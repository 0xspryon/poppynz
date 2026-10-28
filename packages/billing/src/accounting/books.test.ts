import { describe, expect, it } from 'bun:test';
import { csv, csvField } from './books';

describe('csvField', () => {
  it('neutralises text a spreadsheet would run as a formula', () => {
    expect(csvField('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvField('+1 555')).toBe("'+1 555");
    expect(csvField('-cmd|calc')).toBe("'-cmd|calc");
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvField('\tTab')).toBe("'\tTab");
  });

  it('leaves numbers (negative amounts included) and ordinary text alone', () => {
    expect(csvField('-12.50')).toBe('-12.50');
    expect(csvField(-3)).toBe('-3');
    expect(csvField('50.41')).toBe('50.41');
    expect(csvField('Fiona Family')).toBe('Fiona Family');
    expect(csvField('a, b')).toBe('"a, b"');
    expect(csvField(null)).toBe('');
  });

  it('applies to every cell of a CSV', () => {
    expect(csv(['name', 'amount'], [['=1+1', '-5.00']])).toBe("name,amount\n'=1+1,-5.00\n");
  });
});
