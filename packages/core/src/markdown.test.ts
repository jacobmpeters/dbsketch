import { describe, expect, it } from 'vitest';
import { processMarkdown } from './index.js';

const SIMPLE_DBML = 'Table users { id int }';

function inline(dbml: string): string {
  return `<!-- dbsketch\n${dbml}\n-->`;
}

describe('processMarkdown', () => {
  it('inserts a rendered block after an inline dbsketch comment', () => {
    const source = `# Doc\n\n${inline(SIMPLE_DBML)}\n\nTrailing text`;
    const result = processMarkdown(source);
    expect(result).toContain('```dbsketch-rendered\n');
    expect(result).toContain('users');
    expect(result).toContain('Trailing text');
  });

  it('preserves content before and after the comment', () => {
    const source = `Before\n\n${inline(SIMPLE_DBML)}\n\nAfter`;
    const result = processMarkdown(source);
    expect(result.startsWith('Before\n\n')).toBe(true);
    expect(result.endsWith('After')).toBe(true);
  });

  it('updates an existing rendered block in place', () => {
    const source = `${inline(SIMPLE_DBML)}\n\n\`\`\`dbsketch-rendered\nSTALE OUTPUT\n\`\`\``;
    const result = processMarkdown(source);
    expect(result).not.toContain('STALE OUTPUT');
    expect(result).toContain('```dbsketch-rendered\n');
    expect(result).toContain('users');
  });

  it('is idempotent: re-running produces the same output', () => {
    const source = inline(SIMPLE_DBML);
    const first = processMarkdown(source);
    const second = processMarkdown(first);
    expect(second).toBe(first);
  });

  it('handles multiple inline blocks in one document', () => {
    const source = [
      inline('Table a { id int }'),
      '',
      'Middle text',
      '',
      inline('Table b { id int }'),
    ].join('\n');
    const result = processMarkdown(source);
    expect(result.split('```dbsketch-rendered').length - 1).toBe(2);
    expect(result).toContain('Middle text');
    const blocks = result.split('```dbsketch-rendered');
    expect(blocks[1]).toContain('a');
    expect(blocks[2]).toContain('b');
  });

  it('skips a src reference when no resolveFile callback is provided', () => {
    const source = '<!-- dbsketch src="schema.dbml" -->\n';
    const result = processMarkdown(source);
    expect(result).toBe(source);
  });

  it('renders a src reference when resolveFile is provided', () => {
    const source = '<!-- dbsketch src="schema.dbml" -->\n';
    const result = processMarkdown(source, {
      resolveFile: () => SIMPLE_DBML,
    });
    expect(result).toContain('```dbsketch-rendered\n');
    expect(result).toContain('users');
  });

  it('skips a src reference when resolveFile throws', () => {
    const source = '<!-- dbsketch src="missing.dbml" -->\n';
    const result = processMarkdown(source, {
      resolveFile: () => { throw new Error('not found'); },
    });
    expect(result).toBe(source);
  });

  it('skips a block with invalid DBML and leaves existing rendered block untouched', () => {
    const source = `${inline('INVALID DBML ???')}\n\n\`\`\`dbsketch-rendered\nOLD\n\`\`\``;
    const result = processMarkdown(source);
    expect(result).toContain('OLD');
  });

  it('renders a .sql src reference using compileSql', () => {
    const source = '<!-- dbsketch src="schema.sql" -->\n';
    const result = processMarkdown(source, {
      resolveFile: () => 'CREATE TABLE orders (id INT PRIMARY KEY);',
    });
    expect(result).toContain('```dbsketch-rendered\n');
    expect(result).toContain('orders');
  });
});
