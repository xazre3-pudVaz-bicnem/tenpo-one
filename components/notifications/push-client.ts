'use client';

/**
 * ブラウザ側の Web Push まわり（購読・対応判定）。
 * iPad / iPhone（Safari）は「ホーム画面に追加」したアプリからでないと購読できない（iOS 16.4+）。
 */

export type PushSupport =
  | { kind: 'ok' }
  | { kind: 'unsupported' } // この端末・ブラウザでは使えない
  | { kind: 'needs-install' } // iPhone/iPad は ホーム画面に追加 が必要
  | { kind: 'no-key' }; // サーバーに VAPID 公開鍵が無い

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ は Macintosh を名乗る（タッチ点数で見分ける）
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function pushSupport(publicKey: string | undefined): PushSupport {
  if (typeof window === 'undefined') return { kind: 'unsupported' };
  if (!publicKey) return { kind: 'no-key' };
  const hasApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!hasApi) return isIosDevice() && !isStandaloneApp() ? { kind: 'needs-install' } : { kind: 'unsupported' };
  if (isIosDevice() && !isStandaloneApp()) return { kind: 'needs-install' };
  return { kind: 'ok' };
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  // 本番以外は SW を登録していないので、ここで登録しておく（開発中に試せるように）
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

export interface BrowserPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function toRecord(sub: PushSubscription): BrowserPushSubscription | null {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

/** 今この端末が購読済みなら返す（購読していなければ null） */
export async function currentPushSubscription(): Promise<BrowserPushSubscription | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  const sub = await reg.pushManager.getSubscription();
  return sub ? toRecord(sub) : null;
}

/** 通知の許可を取り、購読する。拒否されたら 'denied' */
export async function subscribeToPush(publicKey: string): Promise<BrowserPushSubscription | 'denied' | null> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await readyRegistration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  return toRecord(sub);
}

/** この端末の購読をやめる。返り値は解除した endpoint */
export async function unsubscribeFromPush(): Promise<string | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}

/** 画面内で鳴らすチャイム（Web Audio で作る。音声ファイル不要） */
export class Chime {
  private ctx: AudioContext | null = null;
  private unlocked = false;

  /** iOS は「触った後」でないと音が出ない。最初のタップで AudioContext を用意しておく */
  attachUnlock() {
    if (typeof window === 'undefined') return () => {};
    const unlock = () => {
      try {
        const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        this.ctx = this.ctx ?? new Ctx();
        void this.ctx.resume().then(() => {
          this.unlocked = this.ctx?.state === 'running';
        });
      } catch {
        /* 音が出ないだけ */
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }

  get ready(): boolean {
    return this.unlocked && this.ctx?.state === 'running';
  }

  /** ピンポーン ×2 */
  play(): boolean {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return false;
    const tone = (freq: number, at: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.6, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + dur + 0.05);
    };
    const t = ctx.currentTime + 0.02;
    for (let i = 0; i < 2; i++) {
      tone(880, t + i * 0.9, 0.35); // ピン
      tone(659, t + i * 0.9 + 0.32, 0.5); // ポーン
    }
    return true;
  }
}
