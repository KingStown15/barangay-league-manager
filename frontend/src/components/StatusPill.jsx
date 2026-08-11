const STYLES = {
  scheduled: { background: '#EFF6FF', color: '#2563EB' },
  ongoing: { background: '#FEF3C7', color: '#B45309' },
  completed: { background: '#DCFCE7', color: '#16A34A' },
  forfeited: { background: '#FEE2E2', color: '#DC2626' },
  postponed: { background: '#F1F5F9', color: '#64748B' },
  cancelled: { background: '#F1F5F9', color: '#64748B' },
  draft: { background: '#F1F5F9', color: '#64748B' },
  active: { background: '#DCFCE7', color: '#16A34A' },
  archived: { background: '#F1F5F9', color: '#64748B' },
  active_team: { background: '#DCFCE7', color: '#16A34A' },
  withdrawn: { background: '#F1F5F9', color: '#64748B' },
  disqualified: { background: '#FEE2E2', color: '#DC2626' },
};

export default function StatusPill({ status, needsApproval }) {
  if (needsApproval) {
    return (
      <span className="status-pill" style={{ background: '#FFF7ED', color: '#EA580C', boxShadow: 'inset 0 0 0 1px rgba(234, 88, 12, 0.3)' }}>
        <span className="live-dot" style={{ background: '#EA580C' }} /> Needs Approval
      </span>
    );
  }
  const style = STYLES[status] || { background: '#F1F5F9', color: '#64748B' };
  const isLive = status === 'ongoing';
  return (
    <span className="status-pill" style={{ background: style.background, color: style.color }}>
      {isLive && <span className="live-dot" style={{ background: '#B45309' }} />}
      {status.replace('_', ' ')}
    </span>
  );
}
