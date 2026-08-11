import { ExternalLink, LogOut } from 'lucide-react';
import ModalBase from '../ModalBase';

export default function MoreControlsDrawer({ isOpen, onClose, onOpenFullScorer, onExit, children }) {
  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title="More Controls"
      subtitle="Advanced corrections and final submission remain in Full Scorer."
      size="sm"
      footer={<button type="button" className="btn-secondary" onClick={onClose}>Close</button>}
    >
      <div className="console-more-actions">
        {children}
        <button type="button" onClick={onOpenFullScorer}>
          <ExternalLink size={18} />
          <span><strong>Open Full Scorer</strong><small>Corrections, remarks, and final submission</small></span>
        </button>
        <button type="button" className="danger" onClick={onExit}>
          <LogOut size={18} />
          <span><strong>Exit Console</strong><small>Scorer controls remain disabled after exit</small></span>
        </button>
      </div>
    </ModalBase>
  );
}
