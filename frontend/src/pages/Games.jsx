import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useTournamentSelection } from '../utils/useTournamentSelection';
import { getBasketballClockDisplay } from '../utils/basketballClock';
import TournamentPicker from '../components/TournamentPicker';
import GameCard from '../components/GameCard';
import StatusPill from '../components/StatusPill';
import ModalBase from '../components/ModalBase';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import { SkeletonList } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { isAdminRole } from '../utils/roles';
import { getVolleyballFinalValidation } from '../utils/volleyballRules';
import {
  formatCompletedGames,
  formatEntryLabel,
  getCompetitionLabel,
  getGameDivision,
  getGameSideName,
  getMatchupLabel,
  hasGameSides,
  isPickleballGame,
} from '../utils/entryDisplay';

const emptyManualForm = { team_a_id: '', team_b_id: '', side_a_entry_id: '', side_b_entry_id: '', scheduled_at: '', venue: '', round_label: '' };

function getSubmittedResultSummary(game, tournament) {
  const matchup = getMatchupLabel(game);
  if (game.status === 'forfeited') {
    const forfeitingTeam = game.forfeit_team_id === game.team_a_id
      ? (game.team_a_name || 'Team A')
      : (game.team_b_name || 'Team B');
    return `${matchup} · ${forfeitingTeam} forfeited`;
  }
  const winner = game.score_a > game.score_b ? getGameSideName(game, 'a') : getGameSideName(game, 'b');
  const breakdown = formatCompletedGames(game);
  const context = [
    tournament?.name,
    getGameDivision(game, tournament) ? formatEntryLabel(getGameDivision(game, tournament)) : null,
    getCompetitionLabel(game, tournament),
  ].filter(Boolean).join(' · ');
  return `${context ? `${context} · ` : ''}${matchup} · Final ${game.score_a}–${game.score_b}${breakdown ? ` · Games ${breakdown}` : ''} · Winner ${winner} · Remarks: ${game.remarks || 'None'}`;
}

function getFinalScoreValidation(sport, scoreA, scoreB, roundLabel) {
  if (!Number.isSafeInteger(scoreA) || !Number.isSafeInteger(scoreB) || scoreA < 0 || scoreB < 0 || scoreA > 999 || scoreB > 999) {
    return 'Scores must be whole numbers between 0 and 999.';
  }
  if (scoreA === scoreB) {
    return sport === 'basketball'
      ? 'Basketball final scores cannot be tied. Complete overtime before submitting.'
      : 'Volleyball final set scores cannot be tied.';
  }
  if (sport === 'volleyball') {
    return getVolleyballFinalValidation(roundLabel, scoreA, scoreB);
  }
  return '';
}

export default function Games() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams] = useSearchParams();
  const { tournaments, tournamentId, setTournamentId } = useTournamentSelection();
  const [teams, setTeams] = useState([]);
  const [entries, setEntries] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [needsApprovalFilter, setNeedsApprovalFilter] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [sportFilter, setSportFilter] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm] = useState(emptyManualForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [finalConfirmGame, setFinalConfirmGame] = useState(null);
  const [finalSubmitError, setFinalSubmitError] = useState('');
  const fetchIdRef = useRef(0);
  const finalSubmitLockRef = useRef(false);
  const resultActionLockRef = useRef(false);
  const finalCancelRef = useRef(null);
  const resultListFocusRef = useRef(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const gameIdFromUrl = useMemo(() => {
    const raw = searchParams.get('gameId');
    return raw ? Number(raw) : null;
  }, [searchParams]);
  const [highlightedId, setHighlightedId] = useState(null);
  const highlightTimerRef = useRef(null);

  function load() {
    setRefreshKey(k => k + 1);
  }

  function focusScheduleControls() {
    requestAnimationFrame(() => resultListFocusRef.current?.focus());
  }

  useEffect(() => {
    const fromUrl = searchParams.get('tournament');
    if (fromUrl) setTournamentId(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [sortedGames, setSortedGames] = useState([]);

  useEffect(() => {
    if (gameIdFromUrl) {
      setStatusFilter('scheduled');
      setNeedsApprovalFilter(false);
    }
  }, [gameIdFromUrl]);

  useEffect(() => {
    if (!gameIdFromUrl || loading || sortedGames.length === 0) return;

    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-game-id="${gameIdFromUrl}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedId(gameIdFromUrl);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => setHighlightedId(null), 4000);
      }
    });
  }, [gameIdFromUrl, loading, sortedGames]);

  useEffect(() => {
    if (!tournamentId) { setLoading(false); setGames([]); setSortedGames([]); return; }
    setLoading(true);
    setGames([]);
    setSortedGames([]);
    setExpandedId(null);
    const id = ++fetchIdRef.current;
    api.get(`/teams?tournament_id=${tournamentId}`).then((d) => {
      if (fetchIdRef.current !== id) return;
      setTeams(d.teams);
    }).catch(() => {});
    api.get(`/tournaments/${tournamentId}/entries`).then((d) => {
      if (fetchIdRef.current === id) setEntries(d.entries || []);
    }).catch(() => { if (fetchIdRef.current === id) setEntries([]); });
    const filterParam = statusFilter && !needsApprovalFilter ? `&status=${statusFilter}` : '';
    api.get(`/games?tournament_id=${tournamentId}${filterParam}`)
      .then((d) => {
        if (fetchIdRef.current !== id) return;
        let filtered = d.games;
        if (needsApprovalFilter) {
          filtered = filtered.filter((g) => ['completed', 'forfeited'].includes(g.status) && !g.approved_at);
        }
        const sorted = [...filtered].sort((a, b) => {
          const aNeeds = ['completed', 'forfeited'].includes(a.status) && !a.approved_at ? 0 : 1;
          const bNeeds = ['completed', 'forfeited'].includes(b.status) && !b.approved_at ? 0 : 1;
          return aNeeds - bNeeds;
        });
        setSortedGames(sorted);
        setGames(filtered);
      })
      .catch((err) => { if (fetchIdRef.current === id) toast.error(err.message); })
      .finally(() => { if (fetchIdRef.current === id) setLoading(false); });
  }, [tournamentId, statusFilter, needsApprovalFilter, refreshKey]);

  useEffect(() => {
    setSearchFilter('');
    setSportFilter('');
    setDivisionFilter('');
  }, [tournamentId]);

  function toggleExpand(game) {
    if (expandedId === game.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(game.id);
    setEditForm({
      team_a_id: game.team_a_id || '', team_b_id: game.team_b_id || '',
      side_a_entry_id: game.side_a_entry_id || '', side_b_entry_id: game.side_b_entry_id || '',
      scheduled_at: game.scheduled_at ? game.scheduled_at.slice(0, 16) : '',
      venue: game.venue || '', round_label: game.round_label || '',
      score_a: game.score_a ?? game.live_score_a ?? '',
      score_b: game.score_b ?? game.live_score_b ?? '',
      remarks: game.remarks || '',
    });
  }

  async function handleSaveSchedule(gameId) {
    setBusy(true);
    setError('');
    try {
      const game = games.find((item) => item.id === gameId);
      const sides = isPickleballGame(game)
        ? { side_a_entry_id: editForm.side_a_entry_id ? Number(editForm.side_a_entry_id) : null, side_b_entry_id: editForm.side_b_entry_id ? Number(editForm.side_b_entry_id) : null }
        : { team_a_id: editForm.team_a_id || null, team_b_id: editForm.team_b_id || null };
      await api.put(`/games/${gameId}`, {
        ...sides,
        scheduled_at: editForm.scheduled_at || null, venue: editForm.venue, round_label: editForm.round_label,
      });
      toast.success('Schedule updated.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function openAdminFinalConfirm(game) {
    if (busy || isPickleballGame(game) || game.status !== 'ongoing' || !hasGameSides(game)) return;
    setFinalSubmitError('');
    setFinalConfirmGame(game);
  }

  function closeAdminFinalConfirm() {
    if (busy) return;
    setFinalConfirmGame(null);
    setFinalSubmitError('');
  }

  async function handleAdminSubmitScore() {
    if (finalSubmitLockRef.current || !finalConfirmGame) return;
    finalSubmitLockRef.current = true;
    setBusy(true);
    setFinalSubmitError('');
    try {
      await api.post(`/games/${finalConfirmGame.id}/submit`, {
        score_a: editForm.score_a === '' ? null : Number(editForm.score_a),
        score_b: editForm.score_b === '' ? null : Number(editForm.score_b),
        expected_live_score_a: finalConfirmGame.live_score_a,
        expected_live_score_b: finalConfirmGame.live_score_b,
        remarks: editForm.remarks,
      });
      toast.success('Final score saved and approved.');
      setFinalConfirmGame(null);
      setExpandedId(null);
      load();
      focusScheduleControls();
    } catch (err) {
      setFinalSubmitError(err.message);
      if (err.status === 409) load();
    } finally {
      setBusy(false);
      finalSubmitLockRef.current = false;
    }
  }

  async function handleApprove(game) {
    if (resultActionLockRef.current) return;
    resultActionLockRef.current = true;
    const tournament = tournaments.find((item) => String(item.id) === String(game.tournament_id));
    const approved = await confirm({
      title: 'Approve this result?',
      message: getSubmittedResultSummary(game, tournament),
      confirmDetail: 'This publishes the result and may update standings, public results, and bracket progression.',
      confirmLabel: 'Approve Result',
    });
    if (!approved) {
      resultActionLockRef.current = false;
      return;
    }
    setBusy(true);
    try {
      await api.post(`/games/${game.id}/approve`);
      toast.success('Result approved.');
      load();
      focusScheduleControls();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      resultActionLockRef.current = false;
    }
  }

  async function handleReject(game) {
    if (resultActionLockRef.current) return;
    resultActionLockRef.current = true;
    const tournament = tournaments.find((item) => String(item.id) === String(game.tournament_id));
    const reason = await confirm({
      title: 'Reject this result?',
      message: getSubmittedResultSummary(game, tournament),
      confirmDetail: 'This reopens the game as ongoing, clears the submitted result, and requires the scorer to enter it again.',
      input: true,
      inputLabel: 'Reason (required, shown to the scorer)',
      inputPlaceholder: 'e.g. Final score looks swapped',
      inputMinLength: 3,
      confirmLabel: 'Reject & Reopen',
      danger: true,
    });
    if (reason === false) {
      resultActionLockRef.current = false;
      return;
    }
    setBusy(true);
    try {
      await api.post(`/games/${game.id}/reject`, { reason });
      toast.success('Result rejected and reopened for the scorer.');
      load();
      focusScheduleControls();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      resultActionLockRef.current = false;
    }
  }

  async function handleStartGame(game) {
    const matchup = getMatchupLabel(game);
    const ok = await confirm({
      title: 'Start game?',
      message: `This will mark ${matchup} as ongoing and make the live score visible on the public view.`,
      confirmLabel: 'Start Game',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.patch(`/games/${game.id}/status`, { status: 'ongoing' });
      toast.success('Game started.');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(gameId) {
    const game = games.find((g) => g.id === gameId);
    const matchup = game ? getMatchupLabel(game) : 'this game';
    const ok = await confirm({
      title: `Delete ${matchup}?`,
      message: "This removes it from the schedule entirely and can't be undone.",
      confirmLabel: 'Delete Game',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/games/${gameId}`);
      toast.success('Game deleted.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleCreateManual(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const tournament = tournaments.find((item) => String(item.id) === String(tournamentId));
      const sides = tournament?.sport === 'pickleball'
        ? { side_a_entry_id: Number(manualForm.side_a_entry_id), side_b_entry_id: Number(manualForm.side_b_entry_id) }
        : { team_a_id: Number(manualForm.team_a_id), team_b_id: Number(manualForm.team_b_id) };
      await api.post('/games', { ...manualForm, ...sides, tournament_id: Number(tournamentId) });
      toast.success('Game added to the schedule.');
      setManualForm(emptyManualForm);
      setShowManualForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const safeGames = games.filter((g) => String(g.tournament_id) === String(tournamentId));
  const pending = safeGames.filter((g) => ['completed', 'forfeited'].includes(g.status) && !g.approved_at);
  const adminFinalScoreA = editForm.score_a === '' ? null : Number(editForm.score_a);
  const adminFinalScoreB = editForm.score_b === '' ? null : Number(editForm.score_b);
  const adminFinalValidation = finalConfirmGame
    ? getFinalScoreValidation(finalConfirmGame.sport, adminFinalScoreA, adminFinalScoreB, finalConfirmGame.round_label)
    : '';
  const adminWinnerName = finalConfirmGame && !adminFinalValidation
    ? (adminFinalScoreA > adminFinalScoreB
      ? getGameSideName(finalConfirmGame, 'a', 'Team A')
      : getGameSideName(finalConfirmGame, 'b', 'Team B'))
    : '';
  const adminClockDisplay = finalConfirmGame
    ? getBasketballClockDisplay(finalConfirmGame, Date.now())
    : null;
  const selectedTournament = tournaments.find((item) => String(item.id) === String(tournamentId));
  const isPickleballTournament = selectedTournament?.sport === 'pickleball';
  const activeEntries = entries.filter((entry) => entry.status === 'active');
  const visibleGames = sortedGames.filter((game) => {
    if (String(game.tournament_id) !== String(tournamentId)) return false;
    if (sportFilter && game.sport !== sportFilter) return false;
    if (divisionFilter && getGameDivision(game, selectedTournament) !== divisionFilter) return false;
    if (searchFilter.trim()) {
      const query = searchFilter.trim().toLowerCase();
      const searchable = [
        getGameSideName(game, 'a'), getGameSideName(game, 'b'),
        ...(game.side_a?.members || []).map((member) => member.display_name),
        ...(game.side_b?.members || []).map((member) => member.display_name),
      ].join(' ').toLowerCase();
      if (!searchable.includes(query)) return false;
    }
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Schedule"
        action={isAdminRole(user.role) && tournamentId && (isPickleballTournament ? activeEntries.length >= 2 : teams.length >= 2) && (
          <Button onClick={() => setShowManualForm(true)}><span style={{ fontSize: '18px', lineHeight: 1 }}>+</span> Add Game</Button>
        )}
      />

      <TournamentPicker tournaments={tournaments} tournamentId={tournamentId} onChange={setTournamentId} />

      {pending.length > 0 && (
        <div style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)', padding: '8px 16px', borderRadius: '8px', fontSize: '14px', marginBottom: '16px' }}>
          {pending.length} result{pending.length > 1 ? 's' : ''} waiting for approval.
        </div>
      )}

      <ModalBase isOpen={showManualForm} onClose={() => { setShowManualForm(false); setManualForm(emptyManualForm); setError(''); }} title="Add Game" subtitle="Add a game to the schedule." size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => { setShowManualForm(false); setManualForm(emptyManualForm); setError(''); }}>Cancel</button>
            <button type="submit" form="game-form" className="btn-primary">Add Game</button>
          </>
        }
      >
        <form id="game-form" onSubmit={handleCreateManual}>
          <div className="form-grid">
            <div>
              <label className="form-label">{isPickleballTournament ? 'Entry A' : 'Team A'} <span className="required">*</span></label>
              <select className="form-select" required value={isPickleballTournament ? manualForm.side_a_entry_id : manualForm.team_a_id} onChange={(e) => setManualForm({ ...manualForm, [isPickleballTournament ? 'side_a_entry_id' : 'team_a_id']: e.target.value })}>
                <option value="">Select competitor</option>
                {(isPickleballTournament ? activeEntries : teams).map((t) => <option key={t.id} value={t.id}>{t.display_name || t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">{isPickleballTournament ? 'Entry B' : 'Team B'} <span className="required">*</span></label>
              <select className="form-select" required value={isPickleballTournament ? manualForm.side_b_entry_id : manualForm.team_b_id} onChange={(e) => setManualForm({ ...manualForm, [isPickleballTournament ? 'side_b_entry_id' : 'team_b_id']: e.target.value })}>
                <option value="">Select competitor</option>
                {(isPickleballTournament ? activeEntries : teams).map((t) => <option key={t.id} value={t.id}>{t.display_name || t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Date &amp; Time</label>
              <input type="datetime-local" className="form-input" value={manualForm.scheduled_at} onChange={(e) => setManualForm({ ...manualForm, scheduled_at: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Venue / Court</label>
              <input className="form-input" value={manualForm.venue} onChange={(e) => setManualForm({ ...manualForm, venue: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Round / Stage Label</label>
              <input className="form-input" value={manualForm.round_label} onChange={(e) => setManualForm({ ...manualForm, round_label: e.target.value })} />
            </div>
          </div>
          {error && <div className="field-error">{error}</div>}
        </form>
      </ModalBase>

      <ModalBase
        isOpen={Boolean(finalConfirmGame)}
        onClose={closeAdminFinalConfirm}
        title="Submit Final Score?"
        subtitle="Review carefully. This admin submission is approved immediately."
        size="sm"
        closeDisabled={busy}
        initialFocusRef={finalCancelRef}
        footer={
          <>
            <button
              ref={finalCancelRef}
              type="button"
              className="btn-secondary"
              style={{ minHeight: '48px' }}
              disabled={busy}
              onClick={closeAdminFinalConfirm}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              style={{ minHeight: '48px' }}
              disabled={busy || Boolean(adminFinalValidation) || Boolean(finalSubmitError) || finalConfirmGame?.status !== 'ongoing'}
              onClick={handleAdminSubmitScore}
            >
              {busy ? 'Saving\u2026' : 'Confirm & Approve'}
            </button>
          </>
        }
      >
        {finalConfirmGame && (
          <div className="final-submit-summary">
            <div className="final-submit-meta">
              <span>{tournaments.find((item) => String(item.id) === String(finalConfirmGame.tournament_id))?.name || 'Tournament'}</span>
              <span>{finalConfirmGame.sport}</span>
              {finalConfirmGame.round_label && <span>{finalConfirmGame.round_label}</span>}
            </div>
            <div className="final-submit-score-label">Final {finalConfirmGame.sport === 'volleyball' ? 'sets' : 'points'}</div>
            <div className="final-submit-score-grid">
              <div className="final-submit-team">
                <span>{getGameSideName(finalConfirmGame, 'a', 'Team A')}</span>
                <strong>{adminFinalScoreA ?? '—'}</strong>
              </div>
              <span className="final-submit-score-separator">–</span>
              <div className="final-submit-team">
                <span>{getGameSideName(finalConfirmGame, 'b', 'Team B')}</span>
                <strong>{adminFinalScoreB ?? '—'}</strong>
              </div>
            </div>
            {adminFinalValidation ? (
              <div className="final-submit-validation" role="alert">{adminFinalValidation}</div>
            ) : (
              <div className="final-submit-winner"><span>Winner</span><strong>{adminWinnerName}</strong></div>
            )}
            <div className="final-submit-consequence">
              This will finalize and approve the result immediately. Standings, public results, and bracket progression may update.
            </div>
            <dl className="final-submit-details">
              {adminClockDisplay?.text && <><dt>Clock</dt><dd>{adminClockDisplay.text}</dd></>}
              <dt>Remarks</dt><dd>{String(editForm.remarks || '').trim() || 'None'}</dd>
            </dl>
            {finalSubmitError && <div className="final-submit-error" role="alert">{finalSubmitError}</div>}
          </div>
        )}
      </ModalBase>

      <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {['', 'scheduled', 'ongoing', 'completed', 'forfeited', 'postponed'].map((s) => (
          <button
            key={s}
            ref={s === '' ? resultListFocusRef : undefined}
            className={`text-xs px-3 py-1.5 rounded-md font-bold uppercase tracking-wide`}
            style={{
              background: statusFilter === s && !needsApprovalFilter ? 'var(--color-primary)' : 'var(--color-surface-muted)',
              color: statusFilter === s && !needsApprovalFilter ? '#FFFFFF' : 'var(--color-text-muted)',
              border: 'none',
            }}
            onClick={() => { setStatusFilter(s); setNeedsApprovalFilter(false); }}
          >
            {s || 'All'}
          </button>
        ))}
        <button
          className="text-xs px-3 py-1.5 rounded-md font-bold uppercase tracking-wide"
          style={{
            background: needsApprovalFilter ? 'var(--color-danger)' : 'var(--color-danger-soft)',
            color: needsApprovalFilter ? '#FFFFFF' : 'var(--color-danger)',
            border: 'none',
          }}
          onClick={() => { setNeedsApprovalFilter((s) => !s); if (!needsApprovalFilter) setStatusFilter(''); }}
        >
          Needs Approval ({pending.length})
        </button>
      </div>

      <div className="schedule-search-filters">
        <label>
          <span>Search competitor</span>
          <input className="input" value={searchFilter} onChange={(event) => setSearchFilter(event.target.value)} placeholder="Player, pair, or team" />
        </label>
        <label>
          <span>Sport</span>
          <select className="input" value={sportFilter} onChange={(event) => setSportFilter(event.target.value)}>
            <option value="">All sports</option>
            {[...new Set(sortedGames.map((game) => game.sport).filter(Boolean))].map((sport) => <option key={sport} value={sport}>{formatEntryLabel(sport)}</option>)}
          </select>
        </label>
        <label>
          <span>Division</span>
          <select className="input" value={divisionFilter} onChange={(event) => setDivisionFilter(event.target.value)}>
            <option value="">All divisions</option>
            {[...new Set(sortedGames.map((game) => getGameDivision(game, selectedTournament)).filter(Boolean))].map((division) => <option key={division} value={division}>{formatEntryLabel(division)}</option>)}
          </select>
        </label>
      </div>

      {error && <div style={{ color: 'var(--color-danger)', fontSize: '14px', marginBottom: '16px' }}>{error}</div>}

      {!loading && tournamentId && safeGames.length === 0 && (
        <EmptyState icon="📅" title="No games yet" description="This tournament has no games scheduled yet. Generate a schedule or add a game manually." />
      )}

      {!loading && !tournamentId && (
        <EmptyState icon="📅" title="Select a tournament" description="Pick a tournament from the dropdown above to view its schedule." />
      )}

      {loading && <SkeletonList count={4} />}

      <div className="space-y-3">
        {!loading && visibleGames.map((game) => (
          <div key={game.id} data-game-id={game.id} style={highlightedId === game.id ? { background: 'rgba(37, 99, 235, 0.08)', borderRadius: '12px', padding: '4px', margin: '-4px', transition: 'background 0.6s' } : {}}>
            <div onClick={() => toggleExpand(game)}>
              <GameCard game={game} onClick={() => {}} />
            </div>
            {expandedId === game.id && (
              <div className="card card-padding mt-1" style={{ borderTop: '4px solid var(--color-accent)' }}>
                <div className="space-y-4">
                  {isAdminRole(user.role) && ['completed', 'forfeited'].includes(game.status) && !game.approved_at && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <Button disabled={busy} onClick={() => handleApprove(game)}>Approve Result</Button>
                      <Button variant="danger" disabled={busy} onClick={() => handleReject(game)}>Reject &amp; Reopen</Button>
                    </div>
                  )}

                  {game.status === 'ongoing' && game.live_score_a !== null && game.live_score_a !== undefined && game.live_score_b !== null && game.live_score_b !== undefined && (
                    <div style={{ background: 'var(--color-surface-muted)', borderRadius: '8px', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-accent)' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)', animation: 'livePulse 1.6s infinite' }} />
                        Live from scorer
                      </span>
                      <div className="game-score-cluster">
                        <span className="game-score-chip live">{game.live_score_a}</span>
                        <span className="game-score-separator">-</span>
                        <span className="game-score-chip live">{game.live_score_b ?? 0}</span>
                      </div>
                    </div>
                  )}

                  <div>
                    <h3 style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-text-muted)', marginBottom: '8px' }}>Schedule Details</h3>
                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <label className="label">{isPickleballGame(game) ? 'Entry A' : 'Team A'}</label>
                        <select className="input" value={isPickleballGame(game) ? editForm.side_a_entry_id : editForm.team_a_id} onChange={(e) => setEditForm({ ...editForm, [isPickleballGame(game) ? 'side_a_entry_id' : 'team_a_id']: e.target.value })}>
                          <option value="">TBD</option>
                          {(isPickleballGame(game) ? activeEntries : teams).map((t) => <option key={t.id} value={t.id}>{t.display_name || t.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">{isPickleballGame(game) ? 'Entry B' : 'Team B'}</label>
                        <select className="input" value={isPickleballGame(game) ? editForm.side_b_entry_id : editForm.team_b_id} onChange={(e) => setEditForm({ ...editForm, [isPickleballGame(game) ? 'side_b_entry_id' : 'team_b_id']: e.target.value })}>
                          <option value="">TBD</option>
                          {(isPickleballGame(game) ? activeEntries : teams).map((t) => <option key={t.id} value={t.id}>{t.display_name || t.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">Date &amp; Time</label>
                        <input type="datetime-local" className="input" value={editForm.scheduled_at} onChange={(e) => setEditForm({ ...editForm, scheduled_at: e.target.value })} />
                      </div>
                      <div>
                        <label className="label">Venue</label>
                        <input className="input" value={editForm.venue} onChange={(e) => setEditForm({ ...editForm, venue: e.target.value })} />
                      </div>
                    </div>
                    <Button variant="secondary" className="mt-3" disabled={busy} onClick={() => handleSaveSchedule(game.id)}>Save Schedule</Button>
                  </div>

                  <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
                    <h3 style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-text-muted)', marginBottom: '8px' }}>Game Status</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <StatusPill status={game.status} />
                      {game.status === 'scheduled' && (() => {
                        const hasSchedule = Boolean(game.scheduled_at);
                        const origSched = game.scheduled_at ? game.scheduled_at.slice(0, 16) : '';
                        const isDirty = editForm.scheduled_at !== origSched || editForm.venue !== (game.venue || '');
                        const hasBothSides = hasGameSides(game);
                        const canStart = hasSchedule && !isDirty && hasBothSides;
                        if (canStart) {
                          return <button className="btn-primary" disabled={busy} onClick={() => handleStartGame(game)}>Start Game</button>;
                        }
                        const helper = !hasBothSides
                          ? 'Both competitors are required before starting.'
                          : isDirty
                            ? 'Save schedule changes before starting.'
                            : 'Schedule date/time is required before starting this game.';
                        return (
                          <div>
                            <button className="btn-primary" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>Start Game</button>
                            <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' }}>{helper}</div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {isAdminRole(user.role) && game.status === 'ongoing' && !isPickleballGame(game) && (
                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
                      <h3 style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-text-muted)', marginBottom: '8px' }}>Final Score (admin submissions are auto-approved)</h3>
                      <div className="grid grid-cols-2 gap-3 max-w-xs">
                        <div>
                          <label className="label">{getGameSideName(game, 'a', 'Team A')}</label>
                          <input type="number" min="0" max="999" step="1" inputMode="numeric" className="input" value={editForm.score_a} onChange={(e) => setEditForm({ ...editForm, score_a: e.target.value })} />
                        </div>
                        <div>
                          <label className="label">{getGameSideName(game, 'b', 'Team B')}</label>
                          <input type="number" min="0" max="999" step="1" inputMode="numeric" className="input" value={editForm.score_b} onChange={(e) => setEditForm({ ...editForm, score_b: e.target.value })} />
                        </div>
                      </div>
                      <Button className="mt-3" disabled={busy} onClick={() => openAdminFinalConfirm(game)}>Review Final Score</Button>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '6px' }}>
                        Confirmation is required because approval immediately updates the official result.
                      </div>
                    </div>
                  )}

                  <div style={{ border: '1px solid var(--color-danger)', borderRadius: '12px', padding: '16px', background: '#fff5f5', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                    <button style={{ color: 'var(--color-danger)', fontSize: '14px', textDecoration: 'underline' }} onClick={() => handleDelete(game.id)}>Delete Game</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
