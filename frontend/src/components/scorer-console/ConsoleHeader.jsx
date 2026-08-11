import { ArrowLeft, Maximize2, Settings } from 'lucide-react';

function sportLabel(sport) {
  return String(sport || 'Scorer').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function ConsoleHeader({ game, tournament, user, onExit, onMore }) {
  return (
    <header className="console-header">
      <button type="button" className="console-icon-button" onClick={onExit} aria-label="Exit Scorer Console">
        <ArrowLeft size={21} />
      </button>
      <div className="console-header-identity">
        <span>{sportLabel(game?.sport)}</span>
        <strong>{tournament?.name || `Game ${game?.id || ''}`}</strong>
      </div>
      <div className="console-header-meta">
        {game?.round_label && <span>{game.round_label}</span>}
        <span>#{game?.id}</span>
        <span>{user?.username}</span>
      </div>
      <button type="button" className="console-icon-button" onClick={onMore} aria-label="Open more controls">
        <Settings size={21} />
      </button>
      <span className="console-landscape-mark" aria-hidden="true"><Maximize2 size={14} /> Landscape</span>
    </header>
  );
}
