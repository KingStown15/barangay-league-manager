import { ExternalLink, Lock, MoreHorizontal, Power, ShieldCheck } from 'lucide-react';
import ConsoleActionFeedback from './ConsoleActionFeedback';
import ConsoleHeader from './ConsoleHeader';
import ConsoleStatusBar from './ConsoleStatusBar';
import RotateDeviceNotice from './RotateDeviceNotice';

export default function ScorerConsoleShell({
  game,
  tournament,
  user,
  connectionState,
  restoring,
  armed,
  resumeRequired,
  pending,
  feedback,
  canEnable,
  onArm,
  onDisarm,
  onMore,
  onOpenFullScorer,
  onExit,
  children,
}) {
  return (
    <div className="scorer-console-root">
      <RotateDeviceNotice game={game} onOpenFullScorer={onOpenFullScorer} onExit={onExit} />
      <div className="scorer-console-landscape">
        <ConsoleHeader game={game} tournament={tournament} user={user} onExit={onExit} onMore={onMore} />
        <ConsoleStatusBar game={game} connectionState={connectionState} armed={armed} restoring={restoring} />
        <main className="console-stage">
          {children}
        </main>
        <ConsoleActionFeedback feedback={feedback} />
        <footer className="console-footer">
          {armed ? (
            <button type="button" className="console-footer-button disarm" onClick={() => onDisarm('Scorer controls disabled by operator.')} disabled={pending}>
              <Lock size={19} /> Disable Controls
            </button>
          ) : (
            <button type="button" className="console-footer-button arm" onClick={onArm} disabled={!canEnable || pending}>
              <Power size={19} /> {resumeRequired ? 'Resume Scorer Controls' : 'Enable Scorer Controls'}
            </button>
          )}
          <button type="button" className="console-footer-button" onClick={onOpenFullScorer}>
            <ExternalLink size={19} /> Full Scorer
          </button>
          <button type="button" className="console-footer-button" onClick={onMore}>
            <MoreHorizontal size={20} /> More Controls
          </button>
          <span className="console-footer-safety"><ShieldCheck size={16} /> Backend authoritative</span>
        </footer>
      </div>
    </div>
  );
}
