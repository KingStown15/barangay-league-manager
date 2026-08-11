import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const SIZE_MAP = {
  sm: '460px',
  md: '640px',
  lg: '820px',
};

export default function ModalBase({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  closeDisabled = false,
  initialFocusRef,
}) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  const wasOpenRef = useRef(false);
  const previouslyFocusedRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  // Capture the opener during render, before a child with autoFocus can take
  // focus during the commit phase. The effect runs too late for that case.
  if (isOpen && !wasOpenRef.current) {
    previouslyFocusedRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    wasOpenRef.current = true;
  } else if (!isOpen && wasOpenRef.current) {
    wasOpenRef.current = false;
  }

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { closeDisabledRef.current = closeDisabled; }, [closeDisabled]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previouslyFocused = previouslyFocusedRef.current;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const focusTimer = setTimeout(() => {
      const preferred = initialFocusRef?.current;
      const firstFocusable = panelRef.current?.querySelector(focusableSelector);
      (preferred || firstFocusable || panelRef.current)?.focus?.();
    }, 0);

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        if (!closeDisabledRef.current) {
          event.preventDefault();
          onCloseRef.current?.();
        }
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      previouslyFocused?.focus?.();
    };
  }, [isOpen, initialFocusRef]);

  if (!isOpen) return null;

  const maxWidth = SIZE_MAP[size] || SIZE_MAP.md;

  function requestClose() {
    if (!closeDisabled) onClose?.();
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div
        ref={panelRef}
        className="modal-panel"
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descriptionId : undefined}
        aria-busy={closeDisabled || undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId} className="modal-title">{title}</h2>
            {subtitle && <p id={descriptionId} className="modal-description">{subtitle}</p>}
          </div>
          <button className="modal-close" onClick={requestClose} aria-label="Close" disabled={closeDisabled}>
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
