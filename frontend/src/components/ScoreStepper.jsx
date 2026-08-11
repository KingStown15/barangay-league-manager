import { Minus, RotateCcw } from 'lucide-react';

export default function ScoreStepper({ label, value, onChange, onUndo, previousValue, sport, disabled = false }) {
  const isBasketball = sport === 'basketball';

  function add(points) {
    onChange(Math.min(999, value + points));
  }

  function subtract() {
    onChange(Math.max(0, value - 1));
  }

  function undo() {
    if (previousValue !== undefined && previousValue !== null) {
      onUndo?.();
    }
  }

  return (
    <div className="scorer-team-card" style={{ padding: isBasketball ? '14px 12px' : '16px' }}>
      <div className="team-name" style={{ marginBottom: isBasketball ? '10px' : '12px' }}>
        {label}
      </div>
      <div className="team-score" style={{ width: isBasketball ? '64px' : '56px', minWidth: isBasketball ? '64px' : '56px', height: isBasketball ? '48px' : '44px', fontSize: isBasketball ? '28px' : '24px', marginBottom: isBasketball ? '12px' : '14px' }}>{value}</div>

      <div className="score-actions" style={{ gap: isBasketball ? '10px' : '8px', maxWidth: isBasketball ? '400px' : '360px' }}>
        {isBasketball ? (
          <>
            <button className="score-btn score-btn-soft" style={{ minHeight: '50px', fontSize: '18px' }} disabled={disabled} onClick={() => add(1)}>+1</button>
            <button className="score-btn score-btn-primary" style={{ minHeight: '50px', fontSize: '18px' }} disabled={disabled} onClick={() => add(2)}>+2</button>
            <button className="score-btn score-btn-soft" style={{ minHeight: '50px', fontSize: '18px' }} disabled={disabled} onClick={() => add(3)}>+3</button>
          </>
        ) : (
          <button className="score-btn score-btn-soft" style={{ gridColumn: '2', minHeight: '48px', fontSize: '17px' }} disabled={disabled} onClick={() => add(1)}>+1</button>
        )}
      </div>

      <div className="score-adjust-actions" style={{ gap: '10px', maxWidth: isBasketball ? '400px' : '360px', marginTop: isBasketball ? '10px' : '8px' }}>
        <button className="score-btn score-btn-danger" style={{ minHeight: '48px', fontSize: '17px' }} disabled={disabled || value <= 0} onClick={subtract}>
          <Minus size={18} strokeWidth={3} /> 1
        </button>
        <button className="score-btn score-btn-secondary" style={{ minHeight: '48px', fontSize: '17px' }} disabled={disabled || previousValue === undefined || previousValue === null} onClick={undo}>
          <RotateCcw size={15} strokeWidth={2.5} /> Undo
        </button>
      </div>
    </div>
  );
}
