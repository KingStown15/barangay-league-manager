export default function TournamentPicker({ tournaments, tournamentId, onChange }) {
  if (tournaments.length === 0) {
    return <div className="text-black/50 italic mb-4">No tournaments yet - create one first.</div>;
  }
  return (
    <div className="mb-6">
      <label className="label">Tournament</label>
      <select className="input max-w-md" value={tournamentId} onChange={(e) => onChange(e.target.value)}>
        {tournaments.map((t) => (
          <option key={t.id} value={t.id}>{t.name} ({t.status})</option>
        ))}
      </select>
    </div>
  );
}
