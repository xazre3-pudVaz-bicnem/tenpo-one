import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { loadKdsBoard } from '@/lib/kds-server';
import { filterKdsByStations } from '@/lib/display-kds';
import { displayScreenOf, stationsLabel } from '@/lib/display-monitor';
import { loadCallBoard, resolveDisplayRequest } from '@/lib/display-monitor-server';
import { KdsBoard } from '@/components/kitchen/kds-board';
import { CallBoardView } from '@/components/display/call-board';
import { DisplayClock } from '@/components/display/display-clock';
import { DisplayNotice } from '@/components/display/display-notice';
import { DisplayResume } from '@/components/display/display-resume';
import { DisplayShell } from '@/components/display/display-shell';
import { displayAdvanceItem, displayHeartbeat, displayKdsSettingsLocked, displayMarkServed, resumeDisplaySession } from './actions';

export const metadata: Metadata = {
  title: 'ディスプレイ',
  robots: { index: false, follow: false },
  // 「ホーム画面に追加」で全画面のディスプレイとして開けるように
  manifest: '/manifest-display.webmanifest',
  applicationName: 'ディスプレイ',
  appleWebApp: { capable: true, title: 'ディスプレイ', statusBarStyle: 'black' },
};
// 拡大しない・横にずれない（店のモニターに出しっぱなしにするため）
export const viewport = {
  themeColor: '#292725',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

/** 描画の基準時刻（リクエスト時点）。時計・経過時間の初期値 */
function requestTime() {
  return Date.now();
}

/**
 * ディスプレイ端末（QRでつないだ店のモニター）の全画面（2026-10-24 Ronnie）。
 *   kind = kitchen … キッチンディスプレイ（/app/kitchen と同じ KDS。持ち場で絞れる・タップで次の段階へ）
 *   kind = call    … 呼び出しモニター（「調理中」「できあがり」の番号）
 * どの画面を出すかは lib/display-monitor.ts の displayScreenOf（iPad アプリのネイティブのディスプレイと同じ）。
 * ログアウトはしない：回線の外なら「お店の回線につないでください」、機能 OFF なら「この機能は使えません」を出して
 * 読み直し続ける。解除された端末は「この端末は解除されました」。アプリのナビ（/app の枠）は出さない。
 */
export default async function DisplayPage() {
  const state = await resolveDisplayRequest();
  const screen = displayScreenOf(state);

  if (screen.screen === 'resume') return <DisplayResume resumeAction={resumeDisplaySession} />;
  if (screen.screen === 'notice') {
    const notice = <DisplayNotice icon={screen.icon} title={screen.title} body={screen.body ?? undefined} footer={screen.footer ?? undefined} />;
    if (!screen.refreshMs && !screen.heartbeat) return notice;
    return (
      <DisplayShell refreshMs={screen.refreshMs ?? undefined} heartbeatAction={screen.heartbeat ? displayHeartbeat : undefined}>
        {notice}
      </DisplayShell>
    );
  }
  if (state.kind !== 'ready') return null;

  const { device, storeName } = state;
  const supabase = await createClient();
  const now = requestTime();

  if (device.kind === 'call') {
    const board = await loadCallBoard(supabase, device.storeId, device.stations);
    return (
      <DisplayShell heartbeatAction={displayHeartbeat}>
        <CallBoardView storeId={device.storeId} storeName={storeName} deviceName={device.name} board={board} now={now} />
      </DisplayShell>
    );
  }

  const kds = await loadKdsBoard(supabase, { id: device.storeId });
  const view = filterKdsByStations(kds.groups, device.stations, kds.now);
  return (
    <DisplayShell heartbeatAction={displayHeartbeat}>
      <div className="min-h-[100dvh] bg-surface">
        <header className="flex items-center justify-between gap-4 bg-[#292725] px-5 py-3 text-white">
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{storeName}</p>
            <p className="truncate text-xs text-white/55">
              {device.name}・キッチンディスプレイ・持ち場 {stationsLabel(device.stations)}
            </p>
          </div>
          <DisplayClock now={now} className="shrink-0 font-manrope text-3xl font-extrabold tabular-nums" />
        </header>
        <div className="p-4">
          <KdsBoard
            storeId={device.storeId}
            groups={view.groups}
            now={kds.now}
            unservedCount={view.unservedCount}
            avgElapsedMinutes={view.avgElapsedMinutes}
            kdsSettings={kds.kdsSettings}
            canManageSettings={false}
            setItemStatusAction={displayAdvanceItem}
            markOrderServedAction={displayMarkServed}
            updateKdsSettingsAction={displayKdsSettingsLocked}
            stationOptions={view.stationOptions}
          />
        </div>
      </div>
    </DisplayShell>
  );
}
