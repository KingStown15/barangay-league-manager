import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Plus, Shield, Users, Edit3, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '../api/client';
import { useTournamentSelection } from '../utils/useTournamentSelection';
import TournamentPicker from '../components/TournamentPicker';
import Badge from '../components/ui/Badge';
import PageHeader from '../components/ui/PageHeader';
import ModalBase from '../components/ModalBase';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import { SkeletonList } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { isAdminRole } from '../utils/roles';

const emptyForm = { name: '', purok: '', coach_name: '', contact_number: '', uniform_color: '', notes: '' };

export default function Teams() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams] = useSearchParams();
  const { tournaments, tournamentId, setTournamentId } = useTournamentSelection();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  useEffect(() => {
    const fromUrl = searchParams.get('tournament');
    if (fromUrl) setTournamentId(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function load() {
    if (!tournamentId) { setLoading(false); return; }
    setLoading(true);
    api.get(`/teams?tournament_id=${tournamentId}`)
      .then((d) => setTeams(d.teams))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [tournamentId]);

  function startEdit(team) {
    setEditingId(team.id);
    setForm({
      name: team.name, purok: team.purok || '', coach_name: team.coach_name || '',
      contact_number: team.contact_number || '', uniform_color: team.uniform_color || '', notes: team.notes || '',
    });
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.put(`/teams/${editingId}`, form);
        toast.success(`"${form.name}" updated.`);
      } else {
        await api.post('/teams', { ...form, tournament_id: tournamentId });
        toast.success(`"${form.name}" added.`);
      }
      setForm(emptyForm);
      setEditingId(null);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(team) {
    const ok = await confirm({
      title: 'Remove this team?',
      message: `This also removes all of "${team.name}"'s players and can't be undone.`,
      confirmLabel: 'Remove Team',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/teams/${team.id}`);
      toast.success(`"${team.name}" removed.`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleStatusChange(team, status) {
    try {
      await api.put(`/teams/${team.id}`, { status });
      toast.success(status === 'withdrawn' ? `"${team.name}" marked withdrawn.` : `"${team.name}" reactivated.`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Teams"
        action={isAdminRole(user.role) && tournamentId && (
          <Button onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm); }}>
            <Plus size={18} strokeWidth={2.5} /> Add Team
          </Button>
        )}
      />

      <TournamentPicker tournaments={tournaments} tournamentId={tournamentId} onChange={setTournamentId} />

      <ModalBase isOpen={showForm} onClose={() => { setShowForm(false); setForm(emptyForm); setEditingId(null); setError(''); }} title={editingId ? 'Edit Team' : 'Add Team'} subtitle={editingId ? 'Update team details.' : 'Register a new team.'} size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => { setShowForm(false); setForm(emptyForm); setEditingId(null); setError(''); }}>Cancel</button>
            <button type="submit" form="team-form" className="btn-primary">{editingId ? 'Save Changes' : 'Add Team'}</button>
          </>
        }
      >
        <form id="team-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <div>
              <label className="form-label">Team Name <span className="required">*</span></label>
              <input className="form-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Purok / Organization</label>
              <input className="form-input" value={form.purok} onChange={(e) => setForm({ ...form, purok: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Coach / Contact Person</label>
              <input className="form-input" value={form.coach_name} onChange={(e) => setForm({ ...form, coach_name: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Contact Number</label>
              <input className="form-input" value={form.contact_number} onChange={(e) => setForm({ ...form, contact_number: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Uniform Color</label>
              <input className="form-input" value={form.uniform_color} onChange={(e) => setForm({ ...form, uniform_color: e.target.value })} />
            </div>
          </div>
          <div className="form-section" style={{ marginBottom: 0 }}>
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {error && <div className="field-error">{error}</div>}
        </form>
      </ModalBase>

      {tournamentId && loading && <SkeletonList count={4} />}

      {tournamentId && !loading && teams.length === 0 && (
        <EmptyState icon={Shield} title="No teams yet" description="Add your first team above to get the tournament rolling." />
      )}

      <div className="grid md:grid-cols-2 gap-3">
        {!loading && teams.map((team) => (
          <div key={team.id} className="card card-padding">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold text-lg" style={{ color: 'var(--color-text)' }}>{team.name}</div>
                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  {team.purok && `Purok ${team.purok} · `}{team.coach_name || 'No coach listed'}
                  {team.group_name && ` · ${team.group_name}`}
                </div>
              </div>
              <Badge variant={team.status}>{team.status}</Badge>
            </div>
            <div className="flex gap-2 mt-3 flex-wrap">
              <Link to={`/players?tournament=${tournamentId}&team=${team.id}`} className="btn-ghost text-xs">
                <Users size={14} strokeWidth={2} /> Players
              </Link>
              {isAdminRole(user.role) && (
                <>
                  <button className="btn-ghost text-xs" onClick={() => startEdit(team)}>
                    <Edit3 size={14} strokeWidth={2} /> Edit
                  </button>
                  {team.status === 'active' ? (
                    <button className="btn-ghost text-xs" style={{ color: 'var(--color-warning)' }} onClick={() => handleStatusChange(team, 'withdrawn')}>
                      <AlertTriangle size={14} strokeWidth={2} /> Withdraw
                    </button>
                  ) : (
                    <button className="btn-ghost text-xs" style={{ color: 'var(--color-success)' }} onClick={() => handleStatusChange(team, 'active')}>
                      Reactivate
                    </button>
                  )}
                  <button className="btn-ghost text-xs" style={{ color: 'var(--color-danger)' }} onClick={() => handleDelete(team)}>
                    <Trash2 size={14} strokeWidth={2} /> Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
