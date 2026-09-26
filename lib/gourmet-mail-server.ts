import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { pushNewReservation } from '@/lib/push-server';
import {
  GOURMET_SITE_BY_KEY,
  gourmetMailSettingsFrom,
  jstToIso,
  parseGourmetMail,
  tokenFromRecipient,
  type GourmetMailSettings,
  type GourmetSiteKey,
  type MailKind,
  type ParsedGourmetMail,
} from '@/lib/gourmet-mail';

/**
 * グルメサイトの予約メールをご予約台帳に入れる（サーバー専用。app/api/inbound/gourmet-mail から呼ぶ）。
 * 2026-09-27 Ronnie「新規もキャンセルも変更も自動で入るように」。
 *
 * - 宛先の rsv-<token>@… で店舗を決める（store_settings.settings.gourmetMail.token）
 * - 新規: 予約を作る（予約経路＝そのサイト、created_via='gourmet_mail'）→ 端末へ通知
 * - 変更: 予約番号（無ければ名前＋日付）で探して日時・人数を直す。見つからなければ新規として入れる
 * - キャンセル: 探して status='cancelled'。見つからなければ「要確認」
 * - 読めなかったもの・判別できなかったものは gourmet_mail_imports に「要確認」で残す（何も捨てない）
 */

export interface InboundMail {
  to: string | string[];
  from: string | null;
  subject: string | null;
  text: string | null;
  html: string | null;
  /** 受信時刻（無ければ now） */
  receivedAt?: string | null;
  /** 受信サービスが付けるメールID（重複取り込みの防止） */
  messageId?: string | null;
}

export type ImportStatus = 'imported' | 'updated' | 'cancelled' | 'verified' | 'needs_review' | 'ignored' | 'duplicate';

export interface IngestResult {
  status: ImportStatus;
  storeId: string | null;
  site: GourmetSiteKey | null;
  kind: MailKind | null;
  reservationId: string | null;
  message: string;
}

type Admin = ReturnType<typeof createAdminClient>;

export async function ingestGourmetMail(mail: InboundMail): Promise<IngestResult> {
  const admin = createAdminClient();
  const receivedAt = mail.receivedAt ?? new Date().toISOString();
  const token = tokenFromRecipient(mail.to);
  if (!token) return { status: 'ignored', storeId: null, site: null, kind: null, reservationId: null, message: '宛先に取り込み用アドレスがありません' };

  // 店舗を探す
  const { data: row } = await admin
    .from('store_settings')
    .select('store_id, organization_id, settings, default_stay_minutes')
    .eq('settings->gourmetMail->>token', token)
    .maybeSingle();
  if (!row) return { status: 'ignored', storeId: null, site: null, kind: null, reservationId: null, message: '取り込み用アドレスに合う店舗がありません' };
  const storeId = row.store_id as string;
  const orgId = row.organization_id as string;
  const settings = ((row.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const gm = gourmetMailSettingsFrom(settings);

  // 同じメールを二度入れない
  if (mail.messageId) {
    const { data: dup } = await admin.from('gourmet_mail_imports').select('id').eq('store_id', storeId).eq('message_id', mail.messageId).maybeSingle();
    if (dup) return { status: 'duplicate', storeId, site: null, kind: null, reservationId: null, message: '受信済みのメールです' };
  }

  const parsed = parseGourmetMail({ from: mail.from, subject: mail.subject, text: mail.text, html: mail.html });
  const site = GOURMET_SITE_BY_KEY[parsed.site];
  const base = {
    organization_id: orgId,
    store_id: storeId,
    site: parsed.site,
    kind: parsed.kind,
    from_address: (mail.from ?? '').slice(0, 300),
    subject: (mail.subject ?? '').slice(0, 500),
    body_text: bodyForRecord(mail),
    message_id: mail.messageId ?? null,
    external_id: parsed.externalId,
    parsed: parsed as unknown as Record<string, unknown>,
    received_at: receivedAt,
  };

  const finish = async (status: ImportStatus, message: string, reservationId: string | null = null, error: string | null = null) => {
    await admin.from('gourmet_mail_imports').insert({ ...base, status, reservation_id: reservationId, error });
    if (status !== 'ignored') await touchSite(admin, storeId, settings, gm, parsed.site, parsed.kind, receivedAt, status);
    return { status, storeId, site: parsed.site, kind: parsed.kind, reservationId, message } satisfies IngestResult;
  };

  if (!gm.enabled) return finish('ignored', 'この店舗はメール取り込みがオフです');

  try {
    if (parsed.kind === 'verify') return finish('verified', `${site.name} のメールアドレス確認を受け取りました`);
    if (parsed.kind === 'unknown' && !parsed.complete) return finish('needs_review', '予約の内容が読み取れませんでした');

    if (parsed.kind === 'cancel') {
      const target = await findReservation(admin, storeId, parsed);
      if (!target) return finish('needs_review', 'キャンセル対象の予約が台帳に見つかりません');
      if (target.status === 'cancelled') return finish('duplicate', 'すでにキャンセル済みです', target.id);
      await admin
        .from('reservations')
        .update({
          status: 'cancelled',
          cancelled_at: receivedAt,
          cancel_reason: `${site.name}からキャンセル（メール取り込み）`,
          memo: appendMemo(target.memo, `${jstStamp(receivedAt)} ${site.name}のメールでキャンセル`),
        })
        .eq('id', target.id);
      return finish('cancelled', `${site.name} のキャンセルを反映しました`, target.id);
    }

    if (parsed.kind === 'change') {
      const target = await findReservation(admin, storeId, parsed);
      if (target) {
        if (!parsed.date || !parsed.time) return finish('needs_review', '変更後の日時が読み取れませんでした', target.id);
        const startAt = jstToIso(parsed.date, parsed.time);
        const stay = await stayMinutes(admin, storeId, row.default_stay_minutes as number | null);
        const endAt = new Date(new Date(startAt).getTime() + stay * 60000).toISOString();
        await admin
          .from('reservations')
          .update({
            reserved_date: parsed.date,
            start_at: startAt,
            end_at: endAt,
            party_size: parsed.partySize ?? target.party_size,
            adults: parsed.partySize ?? target.party_size,
            request_note: parsed.request ?? target.request_note,
            memo: appendMemo(target.memo, `${jstStamp(receivedAt)} ${site.name}のメールで変更（${parsed.date} ${parsed.time} ${parsed.partySize ?? target.party_size}名）`),
          })
          .eq('id', target.id);
        return finish('updated', `${site.name} の変更を反映しました`, target.id);
      }
      // 見つからなければ新規として入れる（変更メールしか届いていないケース）
    }

    // 新規（または変更で見つからなかった）
    if (!parsed.complete || !parsed.date || !parsed.time || parsed.partySize == null || !parsed.guestName) {
      return finish('needs_review', '日時・人数・お名前のどれかが読み取れませんでした');
    }
    // 同じ予約番号がすでに入っていたら二重にしない
    if (parsed.externalId) {
      const existing = await findByExternalId(admin, storeId, parsed.externalId);
      if (existing) return finish('duplicate', 'すでに台帳に入っている予約です', existing.id);
    }
    const reservationId = await createReservation(admin, {
      orgId,
      storeId,
      parsed,
      siteName: site.name,
      sourceCode: site.sourceCode,
      receivedAt,
      defaultStay: row.default_stay_minutes as number | null,
    });
    return finish('imported', `${site.name} の新規予約を台帳に入れました`, reservationId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return finish('needs_review', `取り込みに失敗しました: ${msg}`, null, msg);
  }
}

function bodyForRecord(mail: InboundMail): string {
  const t = (mail.text && mail.text.trim()) || '';
  if (t) return t.slice(0, 20000);
  return (mail.html ?? '').slice(0, 20000);
}

function appendMemo(memo: string | null, line: string): string {
  return memo ? `${memo}\n${line}` : line;
}

function jstStamp(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

async function stayMinutes(admin: Admin, storeId: string, fromRow: number | null): Promise<number> {
  if (fromRow && fromRow > 0) return fromRow;
  const { data } = await admin.from('store_settings').select('default_stay_minutes').eq('store_id', storeId).maybeSingle();
  return (data?.default_stay_minutes as number | null) ?? 120;
}

interface FoundReservation {
  id: string;
  status: string;
  party_size: number;
  memo: string | null;
  request_note: string | null;
}

async function findByExternalId(admin: Admin, storeId: string, externalId: string): Promise<FoundReservation | null> {
  const { data } = await admin
    .from('gourmet_mail_imports')
    .select('reservation_id')
    .eq('store_id', storeId)
    .eq('external_id', externalId)
    .not('reservation_id', 'is', null)
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const id = (data?.reservation_id as string | null) ?? null;
  if (!id) return null;
  const { data: r } = await admin.from('reservations').select('id, status, party_size, memo, request_note').eq('id', id).maybeSingle();
  return (r as FoundReservation | null) ?? null;
}

/** 予約番号 → 名前＋来店日 の順で台帳を探す */
async function findReservation(admin: Admin, storeId: string, parsed: ParsedGourmetMail): Promise<FoundReservation | null> {
  if (parsed.externalId) {
    const byId = await findByExternalId(admin, storeId, parsed.externalId);
    if (byId) return byId;
  }
  if (parsed.guestName && parsed.date) {
    const { data } = await admin
      .from('reservations')
      .select('id, status, party_size, memo, request_note')
      .eq('store_id', storeId)
      .eq('reserved_date', parsed.date)
      .ilike('guest_name', `%${parsed.guestName.replace(/\s+/g, '%')}%`)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as FoundReservation;
  }
  if (parsed.phone && parsed.date) {
    const digits = parsed.phone.replace(/\D/g, '');
    const { data } = await admin
      .from('reservations')
      .select('id, status, party_size, memo, request_note, guest_phone')
      .eq('store_id', storeId)
      .eq('reserved_date', parsed.date)
      .neq('status', 'cancelled')
      .limit(20);
    const hit = (data ?? []).find((r) => String(r.guest_phone ?? '').replace(/\D/g, '') === digits);
    if (hit) return hit as FoundReservation;
  }
  return null;
}

async function createReservation(
  admin: Admin,
  input: { orgId: string; storeId: string; parsed: ParsedGourmetMail; siteName: string; sourceCode: string; receivedAt: string; defaultStay: number | null }
): Promise<string> {
  const { parsed } = input;
  const startAt = jstToIso(parsed.date!, parsed.time!);
  const stay = await stayMinutes(admin, input.storeId, input.defaultStay);
  const endAt = new Date(new Date(startAt).getTime() + stay * 60000).toISOString();
  const phone = parsed.phone ?? '';

  const { data: codeRow } = await admin.rpc('generate_reservation_code');
  const code = (typeof codeRow === 'string' && codeRow) || `GM-${Date.now().toString(36).toUpperCase()}`;

  const { data: source } = await admin
    .from('reservation_sources')
    .select('id')
    .eq('code', input.sourceCode)
    .is('organization_id', null)
    .maybeSingle();

  // お客様（電話番号が読めたときだけ、同じ番号の既存客に結び付ける）
  let customerId: string | null = null;
  if (phone.replace(/\D/g, '').length >= 10) {
    const { data: c } = await admin.from('customers').select('id').eq('organization_id', input.orgId).eq('phone', phone).eq('status', 'active').limit(1).maybeSingle();
    customerId = (c?.id as string | null) ?? null;
    if (!customerId) {
      const { data: created } = await admin
        .from('customers')
        .insert({ organization_id: input.orgId, primary_store_id: input.storeId, name: parsed.guestName!, phone })
        .select('id')
        .single();
      customerId = (created?.id as string | null) ?? null;
    }
  }

  const noteParts = [parsed.course ? `コース: ${parsed.course}` : null, parsed.request].filter(Boolean);
  const memo = `${jstStamp(input.receivedAt)} ${input.siteName}のメールから自動登録${parsed.externalId ? `（予約番号 ${parsed.externalId}）` : ''}`;

  const { data: r, error } = await admin
    .from('reservations')
    .insert({
      organization_id: input.orgId,
      store_id: input.storeId,
      customer_id: customerId,
      code,
      reserved_date: parsed.date,
      start_at: startAt,
      end_at: endAt,
      party_size: parsed.partySize,
      adults: parsed.partySize,
      children: 0,
      guest_name: parsed.guestName,
      guest_phone: phone,
      request_note: noteParts.length ? noteParts.join('\n') : null,
      memo,
      status: 'confirmed',
      source_id: (source?.id as string | null) ?? null,
      created_via: 'gourmet_mail',
      consent_accepted: false,
    })
    .select('id')
    .single();
  if (error || !r) throw new Error(error?.message ?? '予約を作れませんでした');

  // 端末へ通知（失敗しても投げない）
  const { data: store } = await admin.from('stores').select('name').eq('id', input.storeId).maybeSingle();
  void pushNewReservation(input.storeId, {
    storeName: (store?.name as string | undefined) ?? '',
    guestName: parsed.guestName!,
    partySize: parsed.partySize!,
    startAt,
    code,
    createdVia: 'gourmet_mail',
  });
  return r.id as string;
}

/** サイトごとの「最後に届いた」印を store_settings に残す */
async function touchSite(
  admin: Admin,
  storeId: string,
  settings: Record<string, unknown>,
  gm: GourmetMailSettings,
  site: GourmetSiteKey,
  kind: MailKind,
  at: string,
  status: ImportStatus
) {
  const prev = gm.sites[site] ?? {};
  const next: GourmetMailSettings = {
    ...gm,
    sites: {
      ...gm.sites,
      [site]: {
        ...prev,
        verifiedAt: prev.verifiedAt ?? at,
        lastImportAt: status === 'needs_review' || status === 'duplicate' ? (prev.lastImportAt ?? null) : at,
        lastKind: kind,
      },
    },
  };
  await admin
    .from('store_settings')
    .update({ settings: { ...settings, gourmetMail: next } })
    .eq('store_id', storeId);
}
