export default function EmptyState({ icon = '🗒️', title, description, action, dark, compact }) {
  return (
    <div className={`text-center ${compact ? 'py-6' : 'py-12'} px-4`}>
      <div className={`${compact ? 'text-3xl' : 'text-4xl'} mb-3`} style={{ opacity: 0.5 }} aria-hidden="true">{icon}</div>
      {title && (
        <div style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '4px', color: dark ? 'var(--color-text-muted)' : 'var(--color-text-muted)' }}>
          {title}
        </div>
      )}
      {description && (
        <div style={{ fontSize: '14px', maxWidth: '320px', margin: '0 auto', color: 'var(--color-text-soft)' }}>{description}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
