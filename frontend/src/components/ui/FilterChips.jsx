export default function FilterChips({ options, value, onChange }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((opt) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            className={`text-xs px-3 py-1.5 rounded-md uppercase tracking-wide transition-colors ${
              isActive
                ? 'bg-primary text-white'
                : 'bg-black/5 text-muted hover:bg-black/10'
            }`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
