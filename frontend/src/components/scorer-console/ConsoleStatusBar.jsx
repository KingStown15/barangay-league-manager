import { getConsoleConnectionStatus, getConsoleMatchStatus } from '../../utils/scorerConsoleState.js';

function StatusItem({ label, value, tone }) {
  return (
    <div className={`console-status-item ${tone || 'neutral'}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function ConsoleStatusBar({ game, connectionState, armed, restoring }) {
  const match = getConsoleMatchStatus(game);
  const server = getConsoleConnectionStatus(connectionState);
  return (
    <section className="console-status-bar" aria-label="Scorer Console status" aria-live="polite">
      <StatusItem label="Match" value={match.label} tone={match.tone} />
      <StatusItem label="Server" value={restoring ? 'RESTORING' : server.label} tone={restoring ? 'warning' : server.tone} />
      <StatusItem label="Controls" value={armed ? 'ACTIVE' : 'DISABLED'} tone={armed ? 'success' : 'danger'} />
      <StatusItem label="Input" value="TOUCH" tone="neutral" />
    </section>
  );
}
