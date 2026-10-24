import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { todayJst } from '@/lib/format';
import { loadHomeData } from '@/components/dashboard/home-data';
import { menuLayout } from '@/app/app/menu/data';
import { loadSalesDisplayDay } from '@/lib/register-day-server';
import { salesDayView } from '@/lib/register-day';
import { shouldGoToOpenRegister } from '@/lib/register-open-gate';
import { getStoreWeather, placeJaFromAddress, type WeatherIcon } from '@/lib/weather';
import type { SalesMetricsOptions } from '@/lib/metrics';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * iPad アプリのネイティブのホーム（GET /api/app/v1/pos?part=home）。
 * 中身は Web のレジのホーム（app/app/dashboard/page.tsx の RegiHomePage）と同じ組み立て（2026-10-24 Ronnie「全部ネイティブに」）
 */
export interface NativeHomePayload {
  store: { id: string; name: string };
  serverNow: number;
  today: string;
  /** まだ開局していない（「レジの中の現金を数える」開局画面へ） */
  needsOpenRegister: boolean;
  /** 上の大きいボタン（オーダー・会計／店舗台帳） */
  bigTiles: { href: string; label: string; en: string }[];
  /** 左の列（即会計・伝票明細・入出金・仕入・経費・ドロア・レジクローズ・在庫・設定） */
  tools: { href: string; label: string; en: string; icon: string; action: 'drawer' | null; badge: number | null }[];
  sales: {
    actual: number;
    avgSpend: number;
    budget: number | null;
    pct: number | null;
    ringPct: number;
    asOf: string;
    date: string;
    dayLabel: string;
    heading: string | null;
    note: string | null;
    canAnalytics: boolean;
  };
  kpis: {
    groups: number;
    groupsYesterday: number;
    guests: number;
    guestsYesterday: number;
    repeaters: number | null;
    walkIns: number;
  };
  /** 気温・地名・天気のアイコン（sun / partly / cloud / fog / drizzle / rain / snow / thunder）・昼か夜か（晴れの夜は月） */
  weather: { temperature: number | null; place: string | null; icon: WeatherIcon | null; isDay: boolean | null };
  noticeCount: number;
}

const WEATHER_DEADLINE_MS = 2500;

/** 「(YYYY/MM/DD HH:MM時点)」用（Web のホームと同じ） */
function nowStampJst(d: Date = new Date()): string {
  const date = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).replaceAll('-', '/');
  const time = d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
}

async function loadWeatherQuick(address: string | null): Promise<NativeHomePayload['weather']> {
  const place = placeJaFromAddress(address);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), WEATHER_DEADLINE_MS);
  });
  try {
    const w = await Promise.race([getStoreWeather(address), deadline]);
    // 天気のアイコンも返す（2026-10-24 Ronnie「15° と天気のアイコンを出して」）
    return { temperature: w?.temperature ?? null, place, icon: w?.weather?.icon ?? null, isDay: w?.isDay ?? null };
  } catch {
    return { temperature: null, place, icon: null, isDay: null };
  } finally {
    clearTimeout(timer);
  }
}

async function metricsOptions(supabase: Supabase, organizationId: string): Promise<SalesMetricsOptions> {
  const { data: org } = await supabase.from('organizations').select('kpi_settings').eq('id', organizationId).maybeSingle();
  const kpiSettings = (org?.kpi_settings ?? {}) as { includeTakeoutGuests?: boolean };
  return { includeTakeoutGuests: kpiSettings.includeTakeoutGuests ?? true };
}

const REGI_TOOL_ORDER = ['/app/quick-pay', '/app/orders', '/app/cash', '/app/expenses', '#drawer', '/app/cash/close', '/app/inventory', '/app/settings'];
const REGI_BIG = ['/app/floor', '/app/reservations'];

export async function loadNativeHome(ctx: SessionContext, supabase: Supabase, store: { id: string; name: string }): Promise<NativeHomePayload> {
  const today = todayJst();
  const asOf = nowStampJst();
  const [opts, { count: openCount }, { count: registerCount }, d] = await Promise.all([
    metricsOptions(supabase, ctx.organizationId as string),
    supabase.from('register_sessions').select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('status', 'open'),
    supabase.from('registers').select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('status', 'active'),
    loadSalesDisplayDay(supabase, store.id, today),
  ]);
  const day = salesDayView({ date: d.date, today, closed: d.closed });
  const salesAsOf = day.note && d.closedAt ? nowStampJst(new Date(d.closedAt)) : asOf;
  const data = await loadHomeData({
    supabase,
    organizationId: ctx.organizationId as string,
    userId: ctx.userId,
    role: ctx.role,
    accountingEnabled: !ctx.disabledFeatures.has('accounting'),
    stores: [store],
    isAllStores: false,
    today,
    salesDate: day.date,
    metricsOpts: opts,
  });
  const weather = await loadWeatherQuick(data.address);

  const layout = menuLayout(ctx.role, ctx.disabledFeatures, { keepActions: true });
  const bigTiles = REGI_BIG.flatMap((href) => {
    const t = layout.tiles.find((x) => x.href === href);
    return t ? [{ href: t.href, label: t.label, en: t.en }] : [];
  });
  const noticeCount = data.unreadCount + data.alertCount + data.autoNotices.length;
  const tools = [...layout.tiles.filter((t) => !REGI_BIG.includes(t.href)), ...layout.main]
    .map((i) => ({
      href: i.href,
      label: i.label,
      en: i.en,
      icon: i.icon,
      action: 'action' in i && i.action === 'drawer' ? ('drawer' as const) : null,
      badge: i.href === '/app/expenses' ? noticeCount : null,
    }))
    .sort((a, b) => {
      const ia = REGI_TOOL_ORDER.indexOf(a.href);
      const ib = REGI_TOOL_ORDER.indexOf(b.href);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

  return {
    store: { id: store.id, name: store.name },
    serverNow: Date.now(),
    today,
    needsOpenRegister: shouldGoToOpenRegister({
      isRegisterDevice: true,
      hasStore: true,
      hasOpenSession: (openCount ?? 0) > 0,
      hasRegister: (registerCount ?? 0) > 0,
    }),
    bigTiles,
    tools,
    sales: {
      actual: data.actualSales,
      avgSpend: data.avgSpend,
      budget: data.dailyBudget,
      pct: data.achievementPct,
      ringPct: data.ringPct,
      asOf: salesAsOf,
      date: day.date,
      dayLabel: day.dayLabel,
      heading: day.heading,
      note: day.note,
      canAnalytics: can(ctx.role, 'reports.view'),
    },
    kpis: {
      groups: data.groups,
      groupsYesterday: data.groupsYesterday,
      guests: data.guests,
      guestsYesterday: data.guestsYesterday,
      repeaters: data.repeat.ratePct != null ? data.repeat.repeaters : null,
      walkIns: data.walkIns,
    },
    weather,
    noticeCount,
  };
}
