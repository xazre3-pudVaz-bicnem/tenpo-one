import { nativeBridge } from './native-app';

/**
 * 端末を震わせる。
 * - TENPO ONE の iPhone アプリ：アプリが本当に振動させる（window.TenpoNative。画面が消えているときは通知が震わせる）
 * - Android など navigator.vibrate がある端末：そのまま振動
 * - iPhone（Safari）：Web から振動は使えない。iOS 18 以降は「スイッチ」の触覚フィードバックを使う（画面が点いているときだけ）。
 *   画面が消えている・ポケットの中で震わせるには通知（Push）が要る（lib/push-server.ts・sw.js）
 * どれも失敗しても何もしない。
 */
let switchLabel: HTMLLabelElement | null = null;

function iosSwitch(): HTMLLabelElement | null {
  if (typeof document === 'undefined') return null;
  if (switchLabel && document.body.contains(switchLabel)) return switchLabel;
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  switchLabel = label;
  return label;
}

export function hapticPulse(pattern: number[]): void {
  const native = nativeBridge();
  if (native) {
    native.haptic(pattern);
    return;
  }
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && navigator.vibrate(pattern)) return;
  } catch {
    // 使えない端末
  }
  // iPhone：パターンの「鳴らす」回数だけスイッチを切り替える
  const label = iosSwitch();
  if (!label) return;
  let at = 0;
  pattern.forEach((ms, i) => {
    if (i % 2 === 0) window.setTimeout(() => label.click(), at);
    at += ms;
  });
}
