'use client';

import { useEffect, useState } from 'react';
import { nativePos } from '@/lib/native-app';

/**
 * 「ネイティブのレジ画面（試験中）」の ON/OFF（この iPad だけ）。
 * アプリ（TENPO ONE）の中で、対応している版のときだけ出る。ブラウザでは何も出ない（今まで通り）。
 * 2026-10-13 Ronnie「Airレジのように全部ネイティブ。まず 五反田 で試してから全店」
 */
export function NativePosToggle() {
  const [state, setState] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const np = nativePos();
    // アプリの中だけ。読み込みのあとに一度だけ見る（サーバーの描画とずれないように）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (np) setState({ available: true, on: np.enabled });
  }, []);

  if (!state.available) return null;

  const toggle = async () => {
    const np = nativePos();
    if (!np || busy) return;
    setBusy(true);
    try {
      const res = await np.set(!state.on);
      if (res.ok) setState({ available: true, on: res.enabled ?? !state.on });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="register-settings-native-pos" className="mb-6">
      <h2 id="register-settings-native-pos" className="mb-2 text-sm font-bold text-navy">
        アプリの画面（ネイティブ）
        <span className="ml-1.5 text-xs font-normal text-gray-400">Native app screens</span>
      </h2>
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-white px-4 py-3">
        <p className="text-sm text-ink-2">
          ON（既定）：この iPad では ホーム・テーブル一覧・オーダー・会計 がアプリの画面（英語・速い）で開きます。
          OFF にすると今まで通りの画面です。
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={state.on}
          onClick={toggle}
          disabled={busy}
          className={`tap3d relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${state.on ? 'bg-iris' : 'bg-gray-300'}`}
        >
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${state.on ? 'left-7' : 'left-1'}`} />
        </button>
      </div>
    </section>
  );
}
