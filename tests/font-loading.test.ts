import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('font loading', () => {
  it('uses platform font stacks instead of build-time Google font downloads', () => {
    const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
    const regiFont = readFileSync(new URL('../components/dashboard/regi-font.ts', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

    expect(layout).not.toContain('next/font/google');
    expect(regiFont).not.toContain('next/font/google');
    expect(styles).toContain('--font-noto-sans-jp:');
    expect(styles).toContain('--font-manrope:');
  });
});
