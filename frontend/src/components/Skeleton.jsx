export function SkeletonLine({ className = '', dark }) {
  return <div className={`${dark ? 'skeleton-dark' : 'skeleton'} h-4 ${className}`} />;
}

export function SkeletonCard({ dark, lines = 3 }) {
  const widths = ['w-1/3', 'w-2/3', 'w-1/2'];
  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine key={i} dark={dark} className={`${widths[i % widths.length]} ${i === 1 ? 'h-5' : 'h-3'}`} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonList({ count = 3, dark }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} dark={dark} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="card" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} style={{ display: 'flex', gap: '16px' }}>
            {Array.from({ length: cols }).map((__, c) => (
              <SkeletonLine key={c} className={`flex-1 ${c === 0 ? 'flex-none w-10' : ''}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
