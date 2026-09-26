import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  QrOrderApp,
  type ReservedCourse,
} from "@/components/qr-order/qr-order-app";
import type { QrMenuData } from "@/components/qr-order/types";
import { filterNestedMenu, nestedMenuPages } from "@/lib/menu-book";
import { jstNowHm, loadQrMenuBook } from "@/lib/menu-book-server";
import { dynamicUnitPrice } from "@/lib/dynamic-pricing";
import { isMenuSoldOut } from "@/lib/menu-stock";
import { isPlanTimeOver } from "@/lib/plan-time";
import { resolveQrGroupToken } from "@/lib/table-group-server";

interface PageParams {
  params: Promise<{ storeSlug: string; tableToken: string }>;
}

async function fetchMenu(
  storeSlug: string,
  tableToken: string,
): Promise<QrMenuData | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_qr_menu", {
    p_slug: storeSlug,
    p_token: tableToken,
  });
  return (data as QrMenuData | null) ?? null;
}

export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { storeSlug, tableToken } = await params;
  const menu = await fetchMenu(storeSlug, tableToken);
  return {
    title: menu ? `${menu.store_name}｜${menu.table_name}のご注文` : "ご注文",
    // テーブル固有の非公開URLのため検索エンジンには出さない
    robots: { index: false, follow: false },
  };
}

export default async function QrOrderPage({ params }: PageParams) {
  const { storeSlug, tableToken: openedToken } = await params;
  // テーブルグループ：伝票を持っていない側の卓なら、伝票を持つ卓のトークンで動かす
  // （グループの卓は同じ伝票。飲み放題・時間・注文・履歴がすべて1つにまとまる。2026-09-25 店舗報告）
  const resolved = await resolveQrGroupToken(storeSlug, openedToken);
  const tableToken = resolved.token;
  const supabase = await createClient();
  const [
    { data: menu },
    { data: reservedCourse },
    { book, plan, dynamicRules, stationById, menuStock, planEndsAtMs },
  ] = await Promise.all([
    supabase.rpc("get_qr_menu", { p_slug: storeSlug, p_token: tableToken }),
    supabase.rpc("get_qr_reserved_course", {
      p_slug: storeSlug,
      p_token: tableToken,
    }),
    loadQrMenuBook(storeSlug, tableToken),
  ]);
  if (!menu) notFound();

  const course = (reservedCourse as ReservedCourse | null) ?? null;
  // 卓名はお客様が座っている卓（QR を開いた卓）のまま見せる
  const rawMenu: QrMenuData = {
    ...(menu as QrMenuData),
    table_name: resolved.tableName ?? (menu as QrMenuData).table_name,
  };
  // ダイナミックプライシング：今の時間帯の値段で見せる（注文の値段は create_qr_order が同じ計算で決める）
  // 売り切り（本日の食数）：残り0の商品は QR でも「売り切れ」にする（2026-09-25 店舗要望）
  const now = new Date();
  const needsPrice = dynamicRules.length > 0;
  const needsStock = menuStock.size > 0;
  const qrMenu: QrMenuData =
    needsPrice || needsStock
      ? {
          ...rawMenu,
          categories: rawMenu.categories.map((c) => ({
            ...c,
            items: c.items.map((i) => ({
              ...i,
              // QR の商品はフード・ドリンクだけ（create_qr_order と同じ）
              price: needsPrice
                ? dynamicUnitPrice(
                    dynamicRules,
                    { id: i.id, categoryId: c.id, itemType: "food" },
                    i.price,
                    now,
                  ).price
                : i.price,
              is_sold_out: isMenuSoldOut(!!i.is_sold_out, menuStock.get(i.id)),
            })),
          })),
        }
      : rawMenu;
  // プランの時間切れ：終了予定を過ぎた卓は、QR からプラン・放題の中身を注文できないようにする
  // （2026-09-25 店舗要望。止めるのは QR だけで、レジ・ハンディからは今までどおり足せる）
  const planOver = isPlanTimeOver(planEndsAtMs, now.getTime());

  // メニューブックで絞る：飲み放題・食べ放題・コースが伝票に無い卓には、その中身（F の0円商品など）を出さない。
  // 予約でコースが決まっている卓は、コースが伝票に入る前からプランありとして扱う
  const effectivePlan = planOver
    ? { hasPlan: false, planItemIds: [] }
    : course && !plan.hasPlan
      ? { hasPlan: true, planItemIds: [] }
      : plan;
  const categories = filterNestedMenu(qrMenu.categories, book, {
    channel: "qr",
    plan: effectivePlan,
    nowHm: jstNowHm(),
  });
  // タブはメニューブックのページごと。飲み放題・コースの卓は飲み放題（プランのときだけ）のページを先頭にする
  const pages = nestedMenuPages(
    qrMenu.categories,
    categories,
    book,
    effectivePlan,
    stationById,
  );

  return (
    <QrOrderApp
      storeSlug={storeSlug}
      tableToken={tableToken}
      menu={{ ...qrMenu, categories }}
      pages={pages}
      reservedCourse={course}
      planOver={planOver}
    />
  );
}
