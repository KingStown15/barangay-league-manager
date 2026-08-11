import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Settings, Trash2, Users, GitBranch, Clock, ExternalLink, ArrowLeft } from 'lucide-react';
import { api } from '../api/client';
import Badge from '../components/ui/Badge';
import { SkeletonCard } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import ModalBase from '../components/ModalBase';
import { isAdminRole } from '../utils/roles';

const FORMAT_LABELS = {
  round_robin: 'Single Round Robin',
  groups_playoffs: 'Group Stage + Playoffs',
  single_elimination: 'Single Elimination',
};

export default function TournamentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState(null);
  const [groups, setGroups] = useState([]);
  const [teams, setTeams] = useState([]);
  const [entries, setEntries] = useState([]);
  const [games, setGames] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsForm, setSettingsForm] = useState({});
  const loadIdRef = useRef(0);

  function load() {
    const fetchId = ++loadIdRef.current;
    api.get(`/tournaments/${id}`).then((d) => {
      if (loadIdRef.current !== fetchId) return;
      setTournament(d.tournament);
      setGroups(d.groups);
    }).catch((err) => {
      if (loadIdRef.current === fetchId) setError(err.message);
    });
    api.get(`/teams?tournament_id=${id}`).then((d) => {
      if (loadIdRef.current === fetchId) setTeams(d.teams);
    }).catch(() => {});
    api.get(`/tournaments/${id}/entries`).then((d) => {
      if (loadIdRef.current === fetchId) setEntries(d.entries || []);
    }).catch(() => {});
    api.get(`/games?tournament_id=${id}`).then((d) => {
      if (loadIdRef.current === fetchId) setGames(d.games);
    }).catch(() => {});
  }

  useEffect(load, [id]);

  async function runAction(fn, successMessage) {
    setBusy(true);
    try {
      const result = await fn();
      toast.success(typeof successMessage === 'function' ? successMessage(result) : successMessage);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusChange(status) {
    await runAction(() => api.put(`/tournaments/${id}`, { status }), `Tournament marked as ${status}.`);
  }

  function openSettings() {
    const config = tournament.sport_config || {};
    setSettingsForm({
      name: tournament.name || '', venue: tournament.venue || '', format: tournament.format,
      competition_format: tournament.competition_format || 'singles', division: tournament.division || 'open',
      custom_division: config.custom_division || '', scoring_mode: config.scoring_mode || 'side_out',
      games_to_win: config.games_to_win || 2,
      points_to_win_standard_game: config.points_to_win_standard_game || 11,
      points_to_win_deciding_game: config.points_to_win_deciding_game || 11,
      win_by: config.win_by || 2, score_cap: config.score_cap ?? '',
      track_service: config.track_service ?? true,
      track_server_number: config.track_server_number ?? tournament.competition_format === 'doubles',
      side_switch_enabled: config.side_switch_enabled ?? true,
      side_switch_point: config.side_switch_point || 6,
    });
    setSettingsError('');
    setShowSettings(true);
  }

  async function saveSettings(event) {
    event.preventDefault();
    setBusy(true);
    setSettingsError('');
    try {
      await api.put(`/tournaments/${id}`, settingsForm);
      toast.success('Tournament settings updated. Existing match rule snapshots remain unchanged.');
      setShowSettings(false);
      load();
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAssignGroups() {
    const ok = await confirm({
      title: groups.length > 0 ? 'Re-assign teams to groups?' : 'Assign teams to groups?',
      message: groups.length > 0
        ? 'This will redistribute all active teams across groups. Existing group assignments will be replaced.'
        : `Splits ${teams.length} active teams into ${tournament.groups_count} groups.`,
      confirmLabel: groups.length > 0 ? 'Re-assign Groups' : 'Assign Groups',
      danger: groups.length > 0,
    });
    if (!ok) return;
    await runAction(() => api.post(`/tournaments/${id}/assign-groups`), 'Teams assigned to groups.');
  }

  async function handleGenerateSchedule() {
    const hasGames = groupStageGamesExist || games.length > 0;
    const ok = await confirm({
      title: hasGames ? 'Regenerate schedule?' : 'Generate schedule?',
      message: hasGames
        ? 'This will replace existing generated games for this tournament. Completed or approved games will be preserved.'
        : `Builds a ${tournament.format === 'single_elimination' ? 'knockout bracket' : 'round robin schedule'} from active ${tournament.sport === 'pickleball' ? (tournament.competition_format === 'doubles' ? 'pairs' : 'players') : 'teams'}.`,
      confirmLabel: hasGames ? 'Regenerate Schedule' : 'Generate Schedule',
      danger: hasGames,
    });
    if (!ok) return;
    await runAction(
      () => api.post(`/tournaments/${id}/generate-schedule`),
      (res) => `Schedule generated: ${res.gamesCreated} games created.`
    );
  }

  async function handleGeneratePlayoffs() {
    const ok = await confirm({
      title: playoffGamesExist ? 'Regenerate playoffs?' : 'Generate playoff bracket?',
      message: playoffGamesExist
        ? 'This will replace the existing playoff bracket. Completed or approved games will be preserved.'
        : 'Uses current group standings to build the playoff bracket.',
      confirmLabel: playoffGamesExist ? 'Regenerate Playoffs' : 'Generate Playoffs',
      danger: playoffGamesExist,
    });
    if (!ok) return;
    await runAction(() => api.post(`/tournaments/${id}/generate-playoffs`), 'Playoff bracket generated.');
  }

  async function handleDelete() {
    const ok = await confirm({
      title: 'Delete this tournament?',
      message: `Deleting "${tournament.name}" removes all its ${tournament.sport === 'pickleball' ? 'entries and games' : 'teams, players, and games'}. This can't be undone.`,
      confirmLabel: 'Delete Tournament',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/tournaments/${id}`);
      toast.success(`"${tournament.name}" deleted.`);
      navigate('/tournaments');
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (error && !tournament) return <div style={{ color: 'var(--color-danger)' }}>{error}</div>;
  if (!tournament) {
    return (
      <div className="space-y-6">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={4} />
      </div>
    );
  }

  const isAdmin = isAdminRole(user.role);
  const isPickleball = tournament.sport === 'pickleball';
  const activeEntries = entries.filter((entry) => entry.status === 'active');
  const competitorCount = isPickleball ? activeEntries.length : teams.length;
  const competitorLabel = isPickleball ? (tournament.competition_format === 'doubles' ? 'pairs' : 'players') : 'teams';
  const groupStageGamesExist = games.some((g) => g.group_id);
  const playoffGamesExist = games.some((g) => g.bracket_slot);

  return (
    <div className="tournament-detail-page space-y-5">
      <div>
        <Link to="/tournaments" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-bold" style={{ color: '#64748B' }} onMouseEnter={(e) => { e.currentTarget.style.background = '#F1F5F9'; e.currentTarget.style.color = '#0F172A'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748B'; }}>
          <ArrowLeft size={16} strokeWidth={2} /> Back to Tournaments
        </Link>
      </div>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}>{FORMAT_LABELS[tournament.format]}</div>
          <h1 className="text-2xl font-bold mt-0.5" style={{ color: 'var(--color-text)' }}>{tournament.name}</h1>
          <div style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginTop: '2px' }}>{tournament.venue || 'Venue TBA'} &middot; {tournament.sport}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={tournament.status}>{tournament.status}</Badge>
          {isAdmin && <button className="btn-secondary" onClick={openSettings}><Settings size={15} /> Edit Settings</button>}
        </div>
      </div>

      <ModalBase
        isOpen={showSettings}
        onClose={() => { if (!busy) setShowSettings(false); }}
        title="Edit Tournament Settings"
        subtitle={isPickleball ? 'Rule changes apply to newly generated matches; existing matches keep their snapshot.' : 'Update tournament details.'}
        closeDisabled={busy}
        footer={<><button type="button" className="btn-secondary" disabled={busy} onClick={() => setShowSettings(false)}>Cancel</button><button type="submit" form="tournament-settings-form" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save Settings'}</button></>}
      >
        <form id="tournament-settings-form" onSubmit={saveSettings}>
          <div className="form-grid">
            <div><label className="form-label">Name</label><input className="form-input" required value={settingsForm.name || ''} onChange={(event) => setSettingsForm({ ...settingsForm, name: event.target.value })} /></div>
            <div><label className="form-label">Venue</label><input className="form-input" value={settingsForm.venue || ''} onChange={(event) => setSettingsForm({ ...settingsForm, venue: event.target.value })} /></div>
            <div><label className="form-label">Format</label><select className="form-select" value={settingsForm.format || 'round_robin'} onChange={(event) => setSettingsForm({ ...settingsForm, format: event.target.value })}>{!isPickleball && <option value="groups_playoffs">Groups + Playoffs</option>}<option value="round_robin">Round Robin</option><option value="single_elimination">Single Elimination</option></select></div>
          </div>
          {isPickleball && (
            <>
              <div className="form-grid mt-4">
                <div><label className="form-label">Competition</label><select className="form-select" value={settingsForm.competition_format} onChange={(event) => setSettingsForm({ ...settingsForm, competition_format: event.target.value, track_server_number: event.target.value === 'doubles', division: event.target.value === 'singles' && settingsForm.division === 'mixed' ? 'open' : settingsForm.division })}><option value="singles">Singles</option><option value="doubles">Doubles</option></select></div>
                <div><label className="form-label">Division</label><select className="form-select" value={settingsForm.division} onChange={(event) => setSettingsForm({ ...settingsForm, division: event.target.value })}><option value="men">Men's</option><option value="women">Women's</option>{settingsForm.competition_format === 'doubles' && <option value="mixed">Mixed</option>}<option value="open">Open</option><option value="custom">Custom</option></select></div>
                {settingsForm.division === 'custom' && <div><label className="form-label">Custom Division</label><input className="form-input" required value={settingsForm.custom_division} onChange={(event) => setSettingsForm({ ...settingsForm, custom_division: event.target.value })} /></div>}
                <div><label className="form-label">Scoring Mode</label><select className="form-select" value={settingsForm.scoring_mode} onChange={(event) => setSettingsForm({ ...settingsForm, scoring_mode: event.target.value })}><option value="side_out">Side-out</option><option value="rally">Rally</option></select></div>
                <div><label className="form-label">Games to Win</label><input type="number" min="1" max="5" className="form-input" value={settingsForm.games_to_win} onChange={(event) => setSettingsForm({ ...settingsForm, games_to_win: Number(event.target.value) })} /></div>
                <div><label className="form-label">Standard Target</label><input type="number" min="1" max="99" className="form-input" value={settingsForm.points_to_win_standard_game} onChange={(event) => setSettingsForm({ ...settingsForm, points_to_win_standard_game: Number(event.target.value) })} /></div>
                <div><label className="form-label">Deciding Target</label><input type="number" min="1" max="99" className="form-input" value={settingsForm.points_to_win_deciding_game} onChange={(event) => setSettingsForm({ ...settingsForm, points_to_win_deciding_game: Number(event.target.value) })} /></div>
                <div><label className="form-label">Win By</label><input type="number" min="1" max="10" className="form-input" value={settingsForm.win_by} onChange={(event) => setSettingsForm({ ...settingsForm, win_by: Number(event.target.value) })} /></div>
                <div><label className="form-label">Score Cap</label><input type="number" min="1" max="199" className="form-input" value={settingsForm.score_cap} onChange={(event) => setSettingsForm({ ...settingsForm, score_cap: event.target.value === '' ? '' : Number(event.target.value) })} /></div>
                <div><label className="form-label">Side-switch Point</label><input type="number" min="1" max="99" className="form-input" disabled={!settingsForm.side_switch_enabled} value={settingsForm.side_switch_point} onChange={(event) => setSettingsForm({ ...settingsForm, side_switch_point: Number(event.target.value) })} /></div>
              </div>
              <div className="pickleball-rule-toggles">
                <label><input type="checkbox" checked={settingsForm.track_service} onChange={(event) => setSettingsForm({ ...settingsForm, track_service: event.target.checked })} /> Track serving side</label>
                {settingsForm.competition_format === 'doubles' && <label><input type="checkbox" checked={settingsForm.track_server_number} onChange={(event) => setSettingsForm({ ...settingsForm, track_server_number: event.target.checked })} /> Track server 1/2</label>}
                <label><input type="checkbox" checked={settingsForm.side_switch_enabled} onChange={(event) => setSettingsForm({ ...settingsForm, side_switch_enabled: event.target.checked })} /> Enable side switch</label>
              </div>
            </>
          )}
          {settingsError && <div className="field-error">{settingsError}</div>}
        </form>
      </ModalBase>

      <div className="flex items-center gap-1.5 flex-wrap" style={{ overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {isPickleball ? (
          <Link to={`/entries?tournament=${id}`} className="detail-tab"><Users size={15} strokeWidth={2} /> Entries ({entries.length})</Link>
        ) : (
          <>
            <Link to={`/teams?tournament=${id}`} className="detail-tab"><Users size={15} strokeWidth={2} /> Teams ({teams.length})</Link>
            <Link to={`/players?tournament=${id}`} className="detail-tab">Players</Link>
          </>
        )}
        <Link to={`/games?tournament=${id}`} className="detail-tab"><Clock size={15} strokeWidth={2} /> Schedule ({games.length})</Link>
        <Link to={`/standings?tournament=${id}`} className="detail-tab">Standings</Link>
        <Link to={`/bracket?tournament=${id}`} className="detail-tab"><GitBranch size={15} strokeWidth={2} /> Bracket</Link>
        <a href={`/public/${id}`} target="_blank" rel="noreferrer" className="detail-tab-public"><ExternalLink size={15} strokeWidth={2} /> Public View</a>
      </div>

      <div className="tournament-detail-grid">
        <div>
          {isAdmin && (
            <div className="setup-card">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--color-text-muted)' }}>
                <Settings size={14} strokeWidth={2.5} /> Setup Progress
              </div>

              <div className="setup-step-list">
                {tournament.format === 'groups_playoffs' && (
                  <div className="setup-step">
                    <div>
                      <div className="setup-step-title">{groups.length > 0 ? 'Groups Assigned' : 'Assign Groups'}</div>
                      <div className="setup-step-description">
                        {groups.length > 0 ? `${groups.length} groups assigned.` : `Split ${teams.length} active teams into ${tournament.groups_count} groups.`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {groups.length > 0 && <Badge variant="success">Assigned</Badge>}
                      <button
                        className="setup-step-action btn-secondary"
                        disabled={busy || teams.length < tournament.groups_count * 2}
                        onClick={handleAssignGroups}
                      >
                        {groups.length > 0 ? 'Re-assign' : 'Assign'}
                      </button>
                    </div>
                  </div>
                )}

                {(() => {
                  const scheduleGames = tournament.format === 'groups_playoffs' ? games.filter((g) => g.group_id) : games;
                  const hasSchedule = scheduleGames.length > 0;
                  if (tournament.format === 'single_elimination' && hasSchedule) {
                    return (
                      <div className="setup-step">
                        <div>
                          <div className="setup-step-title">Schedule Generated</div>
                          <div className="setup-step-description">{scheduleGames.length} game{scheduleGames.length !== 1 ? 's' : ''} created for this knockout tournament.</div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="success">Generated</Badge>
                          <Link to={`/games?tournament=${id}`} className="setup-step-action btn-secondary">View Schedule</Link>
                          <button className="setup-step-action btn-accent" disabled={busy} onClick={handleGenerateSchedule}>Regenerate</button>
                        </div>
                      </div>
                    );
                  }
                  if (tournament.format === 'single_elimination' && !hasSchedule) {
                    return (
                      <div className="setup-step">
                        <div>
                          <div className="setup-step-title">Generate Schedule</div>
                          <div className="setup-step-description">Builds the knockout bracket from active {competitorLabel}.</div>
                        </div>
                        <button className="setup-step-action btn-primary" disabled={busy || competitorCount < 2} onClick={handleGenerateSchedule}>Generate Schedule</button>
                      </div>
                    );
                  }
                  if (hasSchedule) {
                    return (
                      <div className="setup-step">
                        <div>
                          <div className="setup-step-title">Schedule Generated</div>
                          <div className="setup-step-description">{scheduleGames.length} game{scheduleGames.length !== 1 ? 's' : ''} created for this tournament.</div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="success">Generated</Badge>
                          <Link to={`/games?tournament=${id}`} className="setup-step-action btn-secondary">View Schedule</Link>
                          <button className="setup-step-action btn-accent" disabled={busy} onClick={handleGenerateSchedule}>Regenerate</button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="setup-step">
                      <div>
                        <div className="setup-step-title">Generate Schedule</div>
                        <div className="setup-step-description">
                          {isPickleball ? `Builds a round robin schedule from active ${competitorLabel}.` : 'Builds a round robin schedule for each group.'}
                        </div>
                      </div>
                      <button
                        className="setup-step-action btn-primary"
                        disabled={busy || competitorCount < 2 || (tournament.format === 'groups_playoffs' && groups.length === 0)}
                        onClick={handleGenerateSchedule}
                      >
                        Generate Schedule
                      </button>
                    </div>
                  );
                })()}

                {tournament.format === 'groups_playoffs' && (
                  <div className="setup-step">
                    <div>
                      <div className="setup-step-title">{playoffGamesExist ? 'Playoffs Generated' : 'Generate Playoffs'}</div>
                      <div className="setup-step-description">
                        {playoffGamesExist
                          ? `${games.filter((g) => g.bracket_slot).length} playoff game${games.filter((g) => g.bracket_slot).length !== 1 ? 's' : ''} created.`
                          : 'Uses group standings once group games are complete and approved.'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {playoffGamesExist && <Badge variant="success">Generated</Badge>}
                      <button
                        className={`setup-step-action ${playoffGamesExist ? 'btn-secondary' : 'btn-primary'}`}
                        disabled={busy || groups.length === 0}
                        onClick={handleGeneratePlayoffs}
                      >
                        {playoffGamesExist ? 'Regenerate' : 'Generate'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          {isAdmin && (
            <div className="status-card">
              <div className="status-title">Tournament Status</div>
              <div className="status-description">Controls visibility on the public view and dashboard.</div>
              <div className="status-segment">
                {['draft', 'active', 'completed', 'archived'].map((s) => (
                  <button
                    key={s}
                    className={`status-button${tournament.status === s ? ' active' : ''}`}
                    disabled={busy}
                    onClick={() => handleStatusChange(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isAdmin && (
            <div className="danger-card">
              <div className="danger-title">Danger Zone</div>
              <div className="danger-description">Delete the entire tournament and all its data.</div>
              <div className="danger-actions">
                <button className="btn-danger text-sm" onClick={handleDelete}>
                  <Trash2 size={14} strokeWidth={2.5} /> Delete Tournament
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
