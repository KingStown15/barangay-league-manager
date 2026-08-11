import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, UserRound, UsersRound } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTournamentSelection } from '../utils/useTournamentSelection';
import TournamentPicker from '../components/TournamentPicker';
import ParticipantSelector from '../components/ParticipantSelector';
import ModalBase from '../components/ModalBase';
import PageHeader from '../components/ui/PageHeader';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { isAdminRole } from '../utils/roles';

const emptyForm = { member1: null, member2: null, display_name: '', seed_number: '' };

function divisionLabel(tournament) {
  if (tournament?.division === 'custom') return tournament?.sport_config?.custom_division || tournament.category || 'Custom';
  return tournament?.category || tournament?.division || 'Open';
}

export default function Entries() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams] = useSearchParams();
  const { tournaments, tournamentId, setTournamentId } = useTournamentSelection();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const tournament = tournaments.find((item) => String(item.id) === String(tournamentId));
  const pickleballTournaments = tournaments.filter((item) => item.sport === 'pickleball');

  useEffect(() => {
    const fromUrl = searchParams.get('tournament');
    if (fromUrl) setTournamentId(fromUrl);
  }, []);

  useEffect(() => {
    if (pickleballTournaments.length > 0 && !pickleballTournaments.some((item) => String(item.id) === String(tournamentId))) {
      setTournamentId(String(pickleballTournaments[0].id));
    }
  }, [pickleballTournaments.length, tournamentId]);

  function load() {
    if (!tournamentId || tournament?.sport !== 'pickleball') { setEntries([]); setLoading(false); return; }
    setLoading(true);
    api.get(`/tournaments/${tournamentId}/entries`)
      .then((data) => setEntries(data.entries || []))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [tournamentId, tournament?.sport]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setShowForm(true);
  }

  function openEdit(entry) {
    setEditing(entry);
    setForm({ member1: null, member2: null, display_name: entry.display_name_override || '', seed_number: entry.seed_number || '' });
    setError('');
    setShowForm(true);
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await api.put(`/tournaments/${tournamentId}/entries/${editing.id}`, {
          display_name: form.display_name,
          seed_number: form.seed_number === '' ? null : Number(form.seed_number),
        });
        toast.success('Entry updated.');
      } else {
        const doubles = tournament.competition_format === 'doubles';
        await api.post(`/tournaments/${tournamentId}/entries`, {
          entry_type: doubles ? 'pair' : 'individual',
          participant_ids: doubles ? [form.member1?.id, form.member2?.id] : [form.member1?.id],
          division: tournament.division,
          display_name: form.display_name.trim() || null,
          seed_number: form.seed_number === '' ? null : Number(form.seed_number),
        });
        toast.success(`${doubles ? 'Pair' : 'Singles entry'} registered.`);
      }
      setShowForm(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function withdraw(entry) {
    const reason = await confirm({
      title: 'Withdraw this entry?',
      message: entry.display_name,
      confirmDetail: 'Withdrawn entries are excluded from newly generated schedules.',
      input: true,
      inputLabel: 'Reason (required)',
      inputPlaceholder: 'e.g. Unavailable',
      inputMinLength: 3,
      confirmLabel: 'Withdraw Entry',
      danger: true,
    });
    if (reason === false) return;
    try {
      await api.post(`/tournaments/${tournamentId}/entries/${entry.id}/withdraw`, { reason });
      toast.success('Entry withdrawn.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  const isDoubles = tournament?.competition_format === 'doubles';
  const pairPreview = form.member1 && form.member2 ? `${form.member1.display_name} / ${form.member2.display_name}` : '';

  return (
    <div>
      <PageHeader
        title="Competition Entries"
        subtitle="Register Pickleball singles players and doubles pairs without creating teams."
        action={isAdminRole(user.role) && tournament?.sport === 'pickleball' && <Button onClick={openCreate}><Plus size={18} /> Add {isDoubles ? 'Pair' : 'Singles Entry'}</Button>}
      />
      <TournamentPicker tournaments={pickleballTournaments} tournamentId={tournamentId} onChange={setTournamentId} />

      {!tournament && <EmptyState icon={UserRound} title="Select a Pickleball tournament" description="Create a Pickleball tournament first, then register its competitors here." />}
      {tournament && tournament.sport !== 'pickleball' && <EmptyState icon={UserRound} title="Pickleball entries only" description="Basketball and Volleyball continue to use Teams and Players." />}
      {!loading && tournament?.sport === 'pickleball' && entries.length === 0 && <EmptyState icon={isDoubles ? UsersRound : UserRound} title="No entries yet" description={`Add the first ${isDoubles ? 'pair' : 'player'} for this tournament.`} />}

      <div className="entry-card-grid">
        {entries.map((entry) => (
          <article key={entry.id} className="card card-padding entry-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold text-lg entry-name">{entry.display_name}</div>
                <div className="flex gap-2 flex-wrap mt-2">
                  <Badge>{entry.entry_type === 'pair' ? 'Doubles Pair' : 'Singles'}</Badge>
                  <Badge>{divisionLabel(tournament)}</Badge>
                  <Badge variant={entry.status}>{entry.status}</Badge>
                </div>
              </div>
              {entry.seed_number && <span className="seed-badge">Seed {entry.seed_number}</span>}
            </div>
            {entry.members.length > 0 && (
              <div className="entry-members">
                {entry.members.map((member) => <div key={member.id}>{member.member_order}. {member.display_name}{member.affiliation ? ` · ${member.affiliation}` : ''}</div>)}
              </div>
            )}
            {entry.withdrawal_reason && <div className="text-sm mt-3" style={{ color: 'var(--color-danger)' }}>Reason: {entry.withdrawal_reason}</div>}
            {isAdminRole(user.role) && (
              <div className="flex gap-2 mt-4 flex-wrap">
                <button className="btn-secondary" onClick={() => openEdit(entry)}>Edit</button>
                {entry.status === 'active' && <button className="btn-danger" onClick={() => withdraw(entry)}>Withdraw</button>}
              </div>
            )}
          </article>
        ))}
      </div>

      <ModalBase
        isOpen={showForm}
        onClose={() => { if (!saving) setShowForm(false); }}
        title={editing ? 'Edit Entry' : `Add ${isDoubles ? 'Doubles Pair' : 'Singles Entry'}`}
        subtitle={`${divisionLabel(tournament)} · ${isDoubles ? 'Two participants required' : 'One participant required'}`}
        closeDisabled={saving}
        footer={<><button type="button" className="btn-secondary" style={{ minHeight: '48px' }} disabled={saving} onClick={() => setShowForm(false)}>Cancel</button><button type="submit" form="entry-form" className="btn-primary" style={{ minHeight: '48px' }} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Register Entry'}</button></>}
      >
        <form id="entry-form" onSubmit={submit}>
          {!editing && (
            <div className="space-y-4">
              <ParticipantSelector label={isDoubles ? 'Player 1' : 'Participant'} value={form.member1} onChange={(member1) => setForm((current) => ({ ...current, member1 }))} excludeId={form.member2?.id} />
              {isDoubles && <ParticipantSelector label="Player 2" value={form.member2} onChange={(member2) => setForm((current) => ({ ...current, member2 }))} excludeId={form.member1?.id} />}
              {pairPreview && <div className="pair-preview"><span>Pair preview</span><strong>{pairPreview}</strong></div>}
            </div>
          )}
          <div className="form-grid mt-4">
            <div>
              <label className="form-label">Display Override (optional)</label>
              <input className="form-input" value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} placeholder={pairPreview || 'Uses participant name by default'} />
            </div>
            <div>
              <label className="form-label">Seed (optional)</label>
              <input type="number" min="1" className="form-input" value={form.seed_number} onChange={(event) => setForm({ ...form, seed_number: event.target.value })} />
            </div>
          </div>
          {error && <div className="field-error">{error}</div>}
        </form>
      </ModalBase>
    </div>
  );
}
