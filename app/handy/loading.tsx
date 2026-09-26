export default function Loading() {
  return (
    <>
      <header className="min-h-[53px] flex-none border-b border-[#262030] bg-[#15121a]" />
      <main
        className="min-h-0 flex-1 overflow-hidden px-2 pt-8"
        aria-busy="true"
        aria-label="読み込み中"
      >
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <li
              key={i}
              className="aspect-square w-full animate-pulse rounded-[10px] border border-[#e3dbf1] bg-white/70"
            />
          ))}
        </ul>
      </main>
    </>
  );
}
