import Link from 'next/link';

export default function TableNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 text-center">
      <p className="text-lg font-bold text-navy">QRコードを確認できませんでした</p>
      <p className="mt-2 max-w-sm text-sm text-gray-500">
        URLが正しくないか、このテーブルのご利用が終了している可能性があります。お手数ですが店員にお声がけください。
      </p>
      <Link href="/" className="mt-6 text-xs text-gray-400 underline">
        トップページへ
      </Link>
    </div>
  );
}
