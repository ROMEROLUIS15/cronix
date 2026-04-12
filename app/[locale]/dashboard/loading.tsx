/**
 * Dashboard loading skeleton — shown while RSC resolves initial data.
 * Uses the same layout as AgendaTab to prevent visual jump on hydration.
 */
export default function DashboardLoading() {
  return (
    <div className="flex h-full relative animate-pulse">
      <div className="flex-1 min-w-0 space-y-4 md:space-y-3">
        {/* Header skeleton */}
        <div className="flex items-center justify-between px-4 md:px-6 py-3 bg-[#141418] rounded-xl border border-[#2E2E33]">
          <div className="flex items-center gap-3">
            <div className="h-6 w-32 bg-[#212125] rounded-md" />
            <div className="h-6 w-24 bg-[#212125] rounded-md" />
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-9 bg-[#212125] rounded-lg" />
            <div className="h-9 w-9 bg-[#212125] rounded-lg" />
          </div>
        </div>

        {/* Calendar grid skeleton */}
        <div className="bg-[#141418] rounded-xl border border-[#2E2E33] p-4 md:p-6">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-px mb-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-6 bg-[#212125] rounded" />
            ))}
          </div>
          {/* Day cells */}
          <div className="grid grid-cols-7 gap-px">
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} className="h-16 md:h-24 bg-[#212125] rounded" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
