import { X } from 'lucide-react';

export default function Modal({ isOpen, onClose, title, subtitle, children, footer, maxWidth }) {
  if (!isOpen) return null;

  const panelWidth = maxWidth || (footer || subtitle ? '820px' : '640px');
  const hasComplexLayout = Boolean(footer || subtitle);

  return (
    <div className="animate-overlay-in" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div className="animate-dialog-in" style={{
        background: '#FFFFFF',
        borderRadius: hasComplexLayout ? '20px' : '16px',
        boxShadow: hasComplexLayout ? '0 24px 80px rgba(15, 23, 42, 0.22)' : '0 20px 60px rgba(15, 23, 42, 0.2)',
        width: '100%',
        maxWidth: panelWidth,
        maxHeight: hasComplexLayout ? '88vh' : '90vh',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '16px',
          padding: hasComplexLayout ? '24px 28px 18px' : '20px 24px 0',
          borderBottom: hasComplexLayout ? '1px solid #E2E8F0' : undefined,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: hasComplexLayout ? '24px' : '20px', fontWeight: hasComplexLayout ? 900 : 800, letterSpacing: '-0.02em', color: '#0F172A', margin: 0 }}>{title}</h2>
            {subtitle && <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#64748B' }}>{subtitle}</p>}
          </div>
          <button
            style={{
              width: hasComplexLayout ? '36px' : '32px',
              height: hasComplexLayout ? '36px' : '32px',
              borderRadius: '999px',
              border: hasComplexLayout ? '1px solid #E2E8F0' : 'none',
              background: hasComplexLayout ? '#FFFFFF' : 'transparent',
              color: '#64748B',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              lineHeight: 1,
              padding: 0,
            }}
            onClick={onClose}
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>

        <div style={{ padding: hasComplexLayout ? '22px 28px 24px' : '20px 24px 24px', overflowY: 'auto' }}>
          {children}
        </div>

        {footer && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px',
            padding: '18px 28px 24px',
            borderTop: '1px solid #E2E8F0',
            background: '#FFFFFF',
            borderRadius: '0 0 20px 20px',
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
