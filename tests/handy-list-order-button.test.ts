import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** 「HANDYで注文」は一覧には出さず、押した詳細の下だけ（2026-10-20 Ronnie「一覧には要らない。押した中に」） */
describe('ハンディ予約一覧の HANDYで注文', () => {
  it('一覧の行には無い・詳細にはある', () => {
    const list = readFileSync(new URL('../components/handy/handy-reservation-list.tsx', import.meta.url), 'utf8');
    const detail = readFileSync(new URL('../components/handy/handy-reservation-detail.tsx', import.meta.url), 'utf8');
    // 行の中のボタン（Link）は無い（コメントで名前は出てくる）
    expect(list).not.toMatch(/href=\{`\/handy\/\$\{r\.tableId\}`\}/);
    expect(list).not.toContain("import Link from 'next/link'");
    expect(detail).toContain('HANDYで注文');
    expect(detail).toContain('href={`/handy/${r.tableId}`}');
  });
});
