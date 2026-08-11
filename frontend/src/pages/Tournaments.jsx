import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trophy } from 'lucide-react';
import { api } from '../api/client';
import Badge from '../components/ui/Badge';
import PageHeader from '../components/ui/PageHeader';
import ModalBase from '../components/ModalBase';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import { SkeletonList } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { isAdminRole } from '../utils/roles';

const FORMAT_LABELS = {
  round_robin: 'Single Round Robin',
  groups_playoffs: 'Group Stage + Playoffs',
  single_elimination: 'Single Elimination',
};

const emptyForm = {
  name: '', sport: 'basketball', category: '', format: 'groups_playoffs',
  venue: '', start_date: '', end_date: '', rules: '',
  groups_count: 2, advancing_per_group: 2, third_place_game: true,
  competition_format: 'singles', division: 'open', custom_division: '',
  scoring_mode: 'side_out', games_to_win: 2,
  points_to_win_standard_game: 11, points_to_win_deciding_game: 11,
  win_by: 2, score_cap: '', track_service: true, track_server_number: false,
  side_switch_enabled: true, side_switch_point: 6,
};

export default function Tournaments() {
  const { user } = useAuth();
  const toast = useToast();
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api.get('/tournaments')
      .then((d) => setTournaments(d.tournaments))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/tournaments', form);
      toast.success(`"${form.name}" created.`);
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Tournaments"
        action={isAdminRole(user.role) && (
          <Button onClick={() => setShowForm(true)}>
            <Plus size={18} strokeWidth={2.5} /> New Tournament
          </Button>
        )}
      />

      <ModalBase
        isOpen={showForm}
        onClose={() => { setShowForm(false); setForm(emptyForm); setError(''); }}
        title="New Tournament"
        subtitle="Create a new league/tournament setup."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => { setShowForm(false); setForm(emptyForm); setError(''); }}>Cancel</button>
            <button type="submit" form="tournament-form" className="btn-primary" disabled={saving}>
              {saving ? 'Creating\u2026' : 'Create Tournament'}
            </button>
          </>
        }
      >
        <form id="tournament-form" onSubmit={handleCreate}>
          <div className="form-section">
            <div className="form-section-title">Basic Details</div>
            <div className="form-grid">
              <div>
                <label className="form-label">Tournament Name <span className="required">*</span></label>
                <input className="form-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Barangay League S3" />
              </div>
              <div>
                <label className="form-label">Sport <span className="required">*</span></label>
                <select className="form-select" value={form.sport} onChange={(e) => {
                  const sport = e.target.value;
                  setForm({ ...form, sport, format: sport === 'pickleball' && form.format === 'groups_playoffs' ? 'round_robin' : form.format });
                }}>
                  <option value="basketball">Basketball</option>
                  <option value="volleyball">Volleyball</option>
                  <option value="pickleball">Pickleball</option>
                </select>
              </div>
              {form.sport !== 'pickleball' && <div>
                <label className="form-label">Category / Division</label>
                <input className="form-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Men's Open" />
              </div>}
              <div>
                <label className="form-label">Venue</label>
                <input className="form-input" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder="e.g. Barangay Court" />
              </div>
            </div>
          </div>

          {form.sport === 'pickleball' && (
            <div className="form-section">
              <div className="form-section-title">Pickleball Competition</div>
              <div className="form-grid">
                <div>
                  <label className="form-label">Competition Format <span className="required">*</span></label>
                  <select className="form-select" value={form.competition_format} onChange={(e) => {
                    const competition_format = e.target.value;
                    setForm({ ...form, competition_format, track_server_number: competition_format === 'doubles', division: competition_format === 'singles' && form.division === 'mixed' ? 'open' : form.division });
                  }}>
                    <option value="singles">Singles</option>
                    <option value="doubles">Doubles</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Division <span className="required">*</span></label>
                  <select className="form-select" value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })}>
                    <option value="men">Men's</option>
                    <option value="women">Women's</option>
                    {form.competition_format === 'doubles' && <option value="mixed">Mixed</option>}
                    <option value="open">Open</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                {form.division === 'custom' && <div>
                  <label className="form-label">Custom Division <span className="required">*</span></label>
                  <input className="form-input" required value={form.custom_division} onChange={(e) => setForm({ ...form, custom_division: e.target.value })} placeholder="e.g. Veterans 40+" />
                </div>}
              </div>
            </div>
          )}

          <div className="form-section">
            <div className="form-section-title">Schedule</div>
            <div className="form-grid">
              <div>
                <label className="form-label">Start Date <span className="required">*</span></label>
                <input type="date" className="form-input" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div>
                <label className="form-label">End Date</label>
                <input type="date" className="form-input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Format <span className="required">*</span></div>
            <select className="form-select" value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
              {form.sport !== 'pickleball' && <option value="groups_playoffs">Group Stage + Playoffs (default)</option>}
              <option value="round_robin">Single Round Robin</option>
              <option value="single_elimination">Single Elimination</option>
            </select>

            {form.format === 'groups_playoffs' && (
              <div className="format-settings-panel" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '14px', alignItems: 'end', padding: '16px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '16px', marginTop: '14px' }}>
                <div>
                  <label className="form-label">Number of Groups</label>
                  <input type="number" min="2" className="form-input" value={form.groups_count} onChange={(e) => setForm({ ...form, groups_count: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="form-label">Advancing Per Group</label>
                  <input type="number" min="1" className="form-input" value={form.advancing_per_group} onChange={(e) => setForm({ ...form, advancing_per_group: Number(e.target.value) })} />
                </div>
                <div className="checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: '10px', minHeight: '46px', color: '#0F172A', fontSize: '15px' }}>
                  <input type="checkbox" checked={form.third_place_game} onChange={(e) => setForm({ ...form, third_place_game: e.target.checked })} />
                  <span>Third Place</span>
                </div>
              </div>
            )}
          </div>

          {form.sport === 'pickleball' && (
            <div className="form-section">
              <div className="form-section-title">Scoring Rules Snapshot</div>
              <div className="form-grid">
                <div><label className="form-label">Scoring Mode</label><select className="form-select" value={form.scoring_mode} onChange={(e) => setForm({ ...form, scoring_mode: e.target.value })}><option value="side_out">Side-out</option><option value="rally">Rally</option></select></div>
                <div><label className="form-label">Games to Win</label><input type="number" min="1" max="5" className="form-input" value={form.games_to_win} onChange={(e) => setForm({ ...form, games_to_win: Number(e.target.value) })} /></div>
                <div><label className="form-label">Standard Game Target</label><input type="number" min="1" max="99" className="form-input" value={form.points_to_win_standard_game} onChange={(e) => setForm({ ...form, points_to_win_standard_game: Number(e.target.value) })} /></div>
                <div><label className="form-label">Deciding Game Target</label><input type="number" min="1" max="99" className="form-input" value={form.points_to_win_deciding_game} onChange={(e) => setForm({ ...form, points_to_win_deciding_game: Number(e.target.value) })} /></div>
                <div><label className="form-label">Win By</label><input type="number" min="1" max="10" className="form-input" value={form.win_by} onChange={(e) => setForm({ ...form, win_by: Number(e.target.value) })} /></div>
                <div><label className="form-label">Score Cap (optional)</label><input type="number" min="1" max="199" className="form-input" value={form.score_cap} onChange={(e) => setForm({ ...form, score_cap: e.target.value === '' ? '' : Number(e.target.value) })} /></div>
                <div><label className="form-label">Side-switch Point</label><input type="number" min="1" max="99" className="form-input" disabled={!form.side_switch_enabled} value={form.side_switch_point} onChange={(e) => setForm({ ...form, side_switch_point: Number(e.target.value) })} /></div>
              </div>
              <div className="pickleball-rule-toggles">
                <label><input type="checkbox" checked={form.track_service} onChange={(e) => setForm({ ...form, track_service: e.target.checked })} /> Track serving side</label>
                {form.competition_format === 'doubles' && <label><input type="checkbox" checked={form.track_server_number} onChange={(e) => setForm({ ...form, track_server_number: e.target.checked })} /> Track server 1/2</label>}
                <label><input type="checkbox" checked={form.side_switch_enabled} onChange={(e) => setForm({ ...form, side_switch_enabled: e.target.checked })} /> Enable deciding-game side switch</label>
              </div>
            </div>
          )}

          <div className="form-section">
            <div className="form-section-title">Rules / Remarks</div>
            <textarea className="form-textarea" rows={3} value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value })} placeholder="Optional rules or notes for this tournament..." />
          </div>

          {error && <div className="field-error">{error}</div>}
        </form>
      </ModalBase>

      {loading && <SkeletonList count={3} />}

      {!loading && tournaments.length === 0 && (
        <EmptyState
          icon={Trophy}
          title="No tournaments yet"
          description="Create your first tournament to start setting up teams and a schedule."
          action={isAdminRole(user.role) && (
            <Button onClick={() => setShowForm(true)}><Plus size={18} strokeWidth={2.5} /> New Tournament</Button>
          )}
        />
      )}

      <div className="space-y-3">
        {!loading && tournaments.map((t) => (
          <Link key={t.id} to={`/tournaments/${t.id}`} className="tournament-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-lg" style={{ color: 'var(--color-text)' }}>{t.name}</div>
                <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  {FORMAT_LABELS[t.format]} · {t.venue || 'Venue TBA'} · {t.sport}
                </div>
              </div>
              <Badge variant={t.status}>{t.status}</Badge>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
