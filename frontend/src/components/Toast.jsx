import { createContext, useCallback, useContext, useState } from 'react';
import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react';

const ToastCtx = createContext();

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const BORDER = {
  success: 'var(--color-success)',
  error: 'var(--color-danger)',
  warning: 'var(--color-warning)',
  info: 'var(--color-info)',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const add = useCallback((message, type = 'info', duration = 3500) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
  }, []);

  const toast = {
    success: (msg) => add(msg, 'success'),
    error: (msg) => add(msg, 'error'),
    warning: (msg) => add(msg, 'warning'),
    info: (msg) => add(msg, 'info'),
  };

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div style={{ position: 'fixed', top: '16px', right: '16px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '8px', pointerEvents: 'none' }}>
        {toasts.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div
              key={t.id}
              className="animate-toast-in"
              style={{ pointerEvents: 'auto', background: '#FFFFFF', color: '#0F172A', borderLeft: `4px solid ${BORDER[t.type]}`, borderRadius: '8px', boxShadow: '0 4px 16px rgba(15, 23, 42, 0.12)', padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: '12px', fontSize: '14px', maxWidth: '380px' }}
            >
              <Icon size={18} strokeWidth={2.5} style={{ color: BORDER[t.type], flexShrink: 0, marginTop: '1px' }} />
              <span style={{ flex: 1 }}>{t.message}</span>
              <button
                style={{ flexShrink: 0, color: 'var(--color-text-soft)', lineHeight: 1, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, fontSize: '16px' }}
                onClick={() => setToasts((prev) => prev.filter((toast) => toast.id !== t.id))}
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
