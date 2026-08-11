import { ExternalLink, LogOut, RotateCw } from 'lucide-react';

export default function RotateDeviceNotice({ game, onOpenFullScorer, onExit }) {
  return (
    <main className="console-rotate-notice">
      <RotateCw size={48} aria-hidden="true" />
      <h1>Rotate your device</h1>
      <p>Scorer Console is designed for landscape orientation.</p>
      {game && <strong>Game #{game.id} · {game.status}</strong>}
      <div>
        <button type="button" onClick={onOpenFullScorer}><ExternalLink size={18} /> Open Full Scorer</button>
        <button type="button" onClick={onExit}><LogOut size={18} /> Exit Console</button>
      </div>
    </main>
  );
}
