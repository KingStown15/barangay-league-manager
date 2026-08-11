import { createContext, useCallback, useContext, useState } from 'react';
import { AlertTriangle, Eye, EyeOff } from 'lucide-react';
import ModalBase from './ModalBase';

const ConfirmCtx = createContext();

export function ConfirmProvider({ children }) {
  const [opts, setOpts] = useState(null);

  const confirm = useCallback((o) => {
    return new Promise((resolve) => {
      setOpts({ ...o, resolve });
    });
  }, []);

  function handleConfirm() {
    const value = opts.input ? opts.inputValue : true;
    opts.resolve(value);
    setOpts(null);
  }

  function handleCancel() {
    opts.resolve(false);
    setOpts(null);
  }

  const dialog = opts ? (
    <ModalBase
      isOpen
      onClose={handleCancel}
      title={opts.title || 'Are you sure?'}
      subtitle={opts.message}
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={handleCancel}>Cancel</button>
          <button
            className={opts.danger ? 'btn-danger' : 'btn-primary'}
            disabled={opts.input && (!opts.inputValue || (opts.inputMinLength && opts.inputValue.length < opts.inputMinLength))}
            onClick={handleConfirm}
          >
            {opts.confirmLabel || 'Confirm'}
          </button>
        </>
      }
    >
      {opts.danger && (
        <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AlertTriangle size={20} strokeWidth={2.5} style={{ color: '#DC2626', flexShrink: 0 }} />
          {opts.confirmDetail && (
            <div className="confirm-detail" style={{ flex: 1 }}>{opts.confirmDetail}</div>
          )}
        </div>
      )}
      {opts.input && (
        <div>
          {opts.inputLabel && <label className="form-label">{opts.inputLabel}</label>}
          <div style={{ position: 'relative' }}>
            <input
              type={opts.inputType === 'password' && !opts.showInput ? 'password' : 'text'}
              className="form-input"
              value={opts.inputValue || ''}
              onChange={(e) => setOpts({ ...opts, inputValue: e.target.value })}
              placeholder={opts.inputPlaceholder}
              minLength={opts.inputMinLength}
              autoFocus
            />
            {opts.inputType === 'password' && (
              <button
                type="button"
                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748B', lineHeight: 1, padding: 0 }}
                onClick={() => setOpts({ ...opts, showInput: !opts.showInput })}
              >
                {opts.showInput ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}
              </button>
            )}
          </div>
        </div>
      )}
      {!opts.danger && !opts.input && opts.confirmDetail && (
        <div className="confirm-detail">{opts.confirmDetail}</div>
      )}
    </ModalBase>
  ) : null;

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {dialog}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmCtx);
}
