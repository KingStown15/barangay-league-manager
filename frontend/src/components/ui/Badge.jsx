const VARIANT_MAP = {
  active: 'badge-active',
  success: 'badge-active',
  completed: 'badge-completed',
  ongoing: 'badge-ongoing',
  live: 'badge-live',
  scheduled: 'badge-scheduled',
  postponed: 'badge-postponed',
  forfeited: 'badge-forfeited',
  withdrawn: 'badge-withdrawn',
  cancelled: 'badge-cancelled',
  draft: 'badge-draft',
  'needs-approval': 'badge-needs-approval',
  inactive: 'badge-inactive',
  admin: 'badge-admin',
  super_admin: 'badge-admin',
  scorer: 'badge-scorer',
};

export default function Badge({ variant = 'active', dot = false, children, ...props }) {
  return (
    <span className={`status-pill ${VARIANT_MAP[variant] || VARIANT_MAP.active}`} {...props}>
      {dot && <span className="live-dot" />}
      {children}
    </span>
  );
}
