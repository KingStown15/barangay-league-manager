import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Users, Edit3, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { useTournamentSelection } from '../utils/useTournamentSelection';
import TournamentPicker from '../components/TournamentPicker';
import Badge from '../components/ui/Badge';
import PageHeader from '../components/ui/PageHeader';
import ModalBase from '../components/ModalBase';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import { SkeletonTable } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { isAdminRole } from '../utils/roles';

const emptyForm = { team_id: '', full_name: '', jersey_number: '', age: '', category: '', eligibility_note: '' };

export default function Players() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams] = useSearchParams();
  const { tournaments, tournamentId, setTournamentId } = useTournamentSelection();
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [teamFilter, setTeamFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const fetchIdRef = useRef(0);

  useEffect(() => {
    const fromUrl = searchParams.get('tournament');
    const teamFromUrl = searchParams.get('team');
    if (fromUrl) setTournamentId(fromUrl);
    if (teamFromUrl) setTeamFilter(teamFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function load() {
    if (!tournamentId) { setLoading(false); return; }
    setLoading(true);
    const id = ++fetchIdRef.current;
    api.get(`/teams?tournament_id=${tournamentId}`).then((d) => { if (fetchIdRef.current === id) setTeams(d.teams); }).catch(() => {});
    api.get(`/players?tournament_id=${tournamentId}`)
      .then((d) => { if (fetchIdRef.current === id) setPlayers(d.players); })
      .catch((err) => { if (fetchIdRef.current === id) toast.error(err.message); })
      .finally(() => { if (fetchIdRef.current === id) setLoading(false); });
  }

  useEffect(load, [tournamentId]);

  function startEdit(player) {
    setEditingId(player.id);
    setForm({
      team_id: player.team_id, full_name: player.full_name, jersey_number: player.jersey_number || '',
      age: player.age || '', category: player.category || '', eligibility_note: player.eligibility_note || '',
    });
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.put(`/players/${editingId}`, form);
        toast.success(`"${form.full_name}" updated.`);
      } else {
        await api.post('/players', { ...form, tournament_id: tournamentId });
        toast.success(`"${form.full_name}" added to the roster.`);
      }
      setForm(emptyForm);
      setEditingId(null);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(player) {
    const ok = await confirm({
      title: 'Remove this player?',
      message: `Remove "${player.full_name}" from the roster.`,
      confirmLabel: 'Remove Player',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/players/${player.id}`);
      toast.success(`"${player.full_name}" removed.`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  const visiblePlayers = teamFilter ? players.filter((p) => String(p.team_id) === String(teamFilter)) : players;

  return (
    <div>
      <PageHeader
        title="Players"
        action={isAdminRole(user.role) && tournamentId && teams.length > 0 && (
          <Button onClick={() => { setShowForm(true); setEditingId(null); setForm({ ...emptyForm, team_id: teamFilter || teams[0].id }); }}>
            <Plus size={18} strokeWidth={2.5} /> Add Player
          </Button>
        )}
      />

      <TournamentPicker tournaments={tournaments} tournamentId={tournamentId} onChange={setTournamentId} />

      {tournamentId && teams.length > 0 && (
        <div className="mb-4">
          <label className="label">Filter by Team</label>
          <select className="input max-w-xs" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
            <option value="">All Teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      <ModalBase isOpen={showForm} onClose={() => { setShowForm(false); setForm(emptyForm); setEditingId(null); setError(''); }} title={editingId ? 'Edit Player' : 'Add Player'} subtitle={editingId ? 'Update player details.' : 'Add a player to the roster.'} size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => { setShowForm(false); setForm(emptyForm); setEditingId(null); setError(''); }}>Cancel</button>
            <button type="submit" form="player-form" className="btn-primary">{editingId ? 'Save Changes' : 'Add Player'}</button>
          </>
        }
      >
        <form id="player-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <div>
              <label className="form-label">Team <span className="required">*</span></label>
              <select className="form-select" required value={form.team_id} onChange={(e) => setForm({ ...form, team_id: e.target.value })}>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Full Name <span className="required">*</span></label>
              <input className="form-input" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Jersey Number</label>
              <input className="form-input" value={form.jersey_number} onChange={(e) => setForm({ ...form, jersey_number: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Age</label>
              <input type="number" className="form-input" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Category</label>
              <input className="form-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Eligibility Note</label>
              <input className="form-input" value={form.eligibility_note} onChange={(e) => setForm({ ...form, eligibility_note: e.target.value })} />
            </div>
          </div>
          {error && <div className="field-error">{error}</div>}
        </form>
      </ModalBase>

      {tournamentId && loading && <SkeletonTable rows={5} cols={5} />}

      {tournamentId && !loading && visiblePlayers.length === 0 && (
        <EmptyState
          icon={Users}
          title={teamFilter ? 'No players on this team yet' : 'No players yet'}
          description="Add a player above once you've created at least one team."
        />
      )}

      {!loading && visiblePlayers.length > 0 && (
        <div className="table-card">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Team</th>
                  <th>Age</th>
                  <th>Status</th>
                  {isAdminRole(user.role) && <th></th>}
                </tr>
              </thead>
              <tbody>
                {visiblePlayers.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono">{p.jersey_number || '-'}</td>
                    <td>{p.full_name}</td>
                    <td style={{ color: 'var(--color-text-muted)' }}>{p.team_name}</td>
                    <td>{p.age || '-'}</td>
                    <td><Badge variant={p.status}>{p.status}</Badge></td>
                    {isAdminRole(user.role) && (
                      <td className="text-right whitespace-nowrap">
                        <button className="btn-ghost text-xs" onClick={() => startEdit(p)}>
                          <Edit3 size={14} strokeWidth={2} /> Edit
                        </button>
                        <button className="btn-ghost text-xs" style={{ color: 'var(--color-danger)' }} onClick={() => handleDelete(p)}>
                          <Trash2 size={14} strokeWidth={2} /> Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
