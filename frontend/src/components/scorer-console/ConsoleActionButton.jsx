export default function ConsoleActionButton({ children, label, tone = 'neutral', className = '', disabled, onClick }) {
  return (
    <button
      type="button"
      className={`console-action-button ${tone} ${className}`.trim()}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
    >
      {children}
    </button>
  );
}
