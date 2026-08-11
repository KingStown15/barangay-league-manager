const STYLES = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  accent: 'btn-accent',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
};

const SIZE_STYLES = {
  sm: 'min-h-[34px] px-3 text-xs',
  md: 'min-h-[42px] px-5 text-sm',
  lg: 'min-h-[50px] px-7 text-base',
};

export default function Button({ variant = 'primary', size = 'md', className = '', children, ...props }) {
  return (
    <button
      className={`${STYLES[variant] || STYLES.primary} ${SIZE_STYLES[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
