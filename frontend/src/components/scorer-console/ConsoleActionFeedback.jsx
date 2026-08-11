export default function ConsoleActionFeedback({ feedback }) {
  const status = feedback?.status || 'idle';
  const message = feedback?.message || 'Review the official state, then enable scorer controls.';
  return (
    <div className={`console-action-feedback ${status}`} role={status === 'rejected' || status === 'stale' ? 'alert' : 'status'} aria-live="polite">
      <span className="console-feedback-dot" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
