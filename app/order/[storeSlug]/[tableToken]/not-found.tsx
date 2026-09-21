import Link from 'next/link';

export default function TableNotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-lilac-soft px-6 text-center">
      <p className="text-lg font-bold text-ink">QRコードを確認できませんでした</p>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-3">
        URLが正しくないか、このテーブルのご利用が終了している可能性があります。お手数ですが店員にお声がけください。
      </p>
      <Link href="/" className="mt-6 text-xs text-ink-3 underline">
        トップページへ
      </Link>
      <p className="mt-10 text-[10px] text-[#9788a6]">
        Powered by{' '}
        <strong className="font-num text-[11px] tracking-wide text-[#59436f]">
          <span className="text-[#9161cb]">TENPO</span> ONE
        </strong>
      </p>
    </div>
  );
}
