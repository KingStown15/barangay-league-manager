import { AlertTriangle } from 'lucide-react';

export default function EmptyState({ icon, title, description, action, variant = 'default' }) {
  const IconComponent = icon || AlertTriangle;

  return (
    <div className={`empty-state ${variant === 'compact' ? 'min-h-[120px] py-6' : ''}`}>
      {IconComponent && (
        <div className="empty-state-icon">
          <IconComponent size={variant === 'compact' ? 24 : 36} strokeWidth={1.8} />
        </div>
      )}
      {title && <h3 className="empty-state-title">{title}</h3>}
      {description && <p className="empty-state-description">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
