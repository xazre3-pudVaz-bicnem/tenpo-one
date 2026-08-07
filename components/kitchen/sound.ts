/**
 * WebAudioによる新規注文ビープ通知（外部音源ファイル不要）。
 *
 * ブラウザの自動再生制限により、AudioContextはユーザー操作（クリック等）の後でなければ
 * 実際には音が鳴らない。そのため、KDS画面では「音を有効化」ボタンのクリックを起点に
 * unlockAudio() を呼んでcontextを生成・resumeし、以降はそのcontextを使い回してplayBeep()する。
 */
let sharedContext: AudioContext | null = null;

export function unlockAudio(): AudioContext {
  if (!sharedContext) sharedContext = new AudioContext();
  if (sharedContext.state === 'suspended') void sharedContext.resume();
  return sharedContext;
}

export function playBeep(): void {
  if (!sharedContext) return; // 未unlock（ユーザー操作前）は鳴らさない
  const ctx = sharedContext;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
}
