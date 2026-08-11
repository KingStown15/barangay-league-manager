export default function ScoreChip({ className = '', children, ...props }) {
  return (
    <span className={`score-chip ${className}`} {...props}>
      {children}
    </span>
  );
}
