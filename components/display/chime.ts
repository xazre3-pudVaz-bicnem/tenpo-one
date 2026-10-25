/**
 * 呼び出しモニターのチャイム（ピンポーン）。外部の音のファイルは使わず WebAudio で鳴らす。
 * ブラウザの決まりで、一度画面をタップ（unlockAudio）したあとでないと音は出ない。
 */
import { unlockAudio } from '@/components/kitchen/sound';

export function playChime(): void {
  let ctx: AudioContext;
  try {
    ctx = unlockAudio();
  } catch {
    return;
  }
  const t0 = ctx.currentTime + 0.02;
  // ミ → ド（2音）
  const notes: [number, number][] = [
    [659.25, 0],
    [523.25, 0.42],
  ];
  for (const [freq, offset] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + offset);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.9);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0 + offset);
    osc.stop(t0 + offset + 0.95);
  }
}
