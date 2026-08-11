import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function ParticipantSelector({ label, value, onChange, excludeId }) {
  const [query, setQuery] = useState('');
  const [participants, setParticipants] = useState([]);
  const [affiliation, setAffiliation] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  function load(search = query) {
    api.get(`/participants?status=active&search=${encodeURIComponent(search.trim())}`)
      .then((data) => setParticipants(data.participants || []))
      .catch((err) => setError(err.message));
  }

  useEffect(() => { load(''); }, []);

  async function createParticipant() {
    if (!query.trim()) return;
    setCreating(true);
    setError('');
    try {
      const data = await api.post('/participants', { display_name: query.trim(), affiliation: affiliation.trim() || null });
      setParticipants((current) => [...current, data.participant].sort((a, b) => a.display_name.localeCompare(b.display_name)));
      onChange(data.participant);
      setAffiliation('');
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  const visible = participants.filter((participant) => participant.id !== excludeId);
  return (
    <div className="participant-selector">
      <label className="form-label">{label} <span className="required">*</span></label>
      <div className="flex gap-2">
        <input
          className="form-input"
          value={query}
          onChange={(event) => { setQuery(event.target.value); load(event.target.value); }}
          placeholder="Search participant name"
          aria-label={`Search ${label}`}
        />
      </div>
      <select
        className="form-select mt-2"
        required
        value={value?.id || ''}
        onChange={(event) => onChange(visible.find((participant) => String(participant.id) === event.target.value) || null)}
        aria-label={label}
      >
        <option value="">Select participant</option>
        {visible.map((participant) => (
          <option key={participant.id} value={participant.id}>
            {participant.display_name}{participant.affiliation ? ` · ${participant.affiliation}` : ''}
          </option>
        ))}
      </select>
      {query.trim() && !visible.some((participant) => participant.display_name.toLowerCase() === query.trim().toLowerCase()) && (
        <div className="participant-create-box">
          <div className="text-sm font-semibold">Not found? Create “{query.trim()}”</div>
          <div className="flex gap-2 mt-2 flex-wrap">
            <input className="form-input" style={{ flex: '1 1 180px' }} value={affiliation} onChange={(event) => setAffiliation(event.target.value)} placeholder="Purok / affiliation (optional)" />
            <button type="button" className="btn-secondary" disabled={creating} onClick={createParticipant}>
              {creating ? 'Creating…' : 'Create Participant'}
            </button>
          </div>
        </div>
      )}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
