import { useEffect, useState } from 'react';
import { api } from '../api/client';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import { useToast } from '../components/Toast';
import { useTournamentSelection } from '../utils/useTournamentSelection';
import TournamentPicker from '../components/TournamentPicker';
import { formatMatchup } from '../utils/formatMatchup';
import {
  exportTodaysGames, exportFinalScore, exportStandings, exportMatchup, exportChampion,
} from '../utils/exportImage';
import { getGameSideName } from '../utils/entryDisplay';
import { getWinnerSide } from '../utils/gameResultStyles';

export default function ExportCenter() {
  const toast = useToast();
  const { tournaments, tournamentId, setTournamentId } = useTournamentSelection();
  const [tournament, setTournament] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [groups, setGroups] = useState([]);
  const [bracketGames, setBracketGames] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  function load() {
    if (!tournamentId) return;
    api.get(`/tournaments/${tournamentId}`).then((d) => setTournament(d.tournament));
    api.get(`/games?tournament_id=${tournamentId}&status=scheduled`).then((d) => setSchedule(d.games));
    api.get(`/games?tournament_id=${tournamentId}&status=completed`).then((d) => setCompleted(d.games));
    api.get(`/games?tournament_id=${tournamentId}&status=forfeited`).then((d) => setCompleted((prev) => [...prev, ...d.games]));
    api.get(`/standings/by-group?tournament_id=${tournamentId}`).then((d) => setGroups(d.groups)).catch(() => {});
    api.get(`/bracket?tournament_id=${tournamentId}`).then((d) => setBracketGames(d.games)).catch(() => {});
  }

  useEffect(load, [tournamentId]);

  async function run(key, fn) {
    setBusy(key);
    setError('');
    try {
      await fn();
      toast.success('Image downloaded - ready to post.');
    } catch (err) {
      setError(err.message || 'Could not generate that image.');
    } finally {
      setBusy('');
    }
  }

  const semifinalGames = bracketGames.filter((g) => g.round_label === 'Semifinals');
  const finalGame = bracketGames.find((g) => g.round_label === 'Final');
  const championGame = bracketGames.find((g) => g.round_label === 'Final' && g.status === 'completed' && (g.winner_entry_id || g.winner_team_id));
  const championSide = championGame ? getWinnerSide(championGame) : null;
  const championName = championGame
    ? getGameSideName(championGame, championSide === 'A' ? 'a' : 'b')
    : null;
  const runnerUpName = championGame
    ? getGameSideName(championGame, championSide === 'A' ? 'b' : 'a')
    : null;

  return (
    <div>
      <PageHeader title="Export / Post" />
      <p style={{ color: 'var(--color-text-soft)', marginBottom: '16px', maxWidth: '640px', fontSize: '14px' }}>
        Download clean, Facebook-ready images (1080×1350) generated straight from your live tournament data.
        No fake logos, sponsors, or QR codes — just the schedule, scores, and standings you already entered.
      </p>
      <TournamentPicker tournaments={tournaments} tournamentId={tournamentId} onChange={setTournamentId} />

      {error && <div style={{ color: 'var(--color-danger)', fontSize: '14px', marginBottom: '16px' }}>{error}</div>}

      {tournament && (
        <div className="grid md:grid-cols-2 gap-4">
          <ExportCard
            title="Today's Games"
            description={`${schedule.length} scheduled game${schedule.length === 1 ? '' : 's'} not yet started`}
            disabled={busy || schedule.length === 0}
            loading={busy === 'today'}
            onClick={() => run('today', () => exportTodaysGames(schedule, tournament.name))}
          />

          <ExportCard
            title="Latest Final Score"
            description={completed[0] ? formatMatchup(getGameSideName(completed[0], 'a'), getGameSideName(completed[0], 'b')) : 'No completed games yet'}
            disabled={busy || completed.length === 0}
            loading={busy === 'final'}
            onClick={() => run('final', () => exportFinalScore(completed[0], tournament.name))}
          />

          {groups.map(({ group, standings }) => (
            <ExportCard
              key={group ? group.id : 'overall'}
              title={`Standings - ${group ? group.name : 'Overall'}`}
              description={`${standings.length} competitors ranked`}
              disabled={busy || standings.length === 0}
              loading={busy === `standings-${group ? group.id : 'overall'}`}
              onClick={() => run(`standings-${group ? group.id : 'overall'}`, () => exportStandings(standings, group ? group.name : null, tournament.name))}
            />
          ))}

          {semifinalGames.map((g, idx) => (
            <ExportCard
              key={g.id}
              title={`Semifinal Matchup ${idx + 1}`}
              description={formatMatchup(getGameSideName(g, 'a'), getGameSideName(g, 'b'))}
              disabled={busy}
              loading={busy === `sf-${g.id}`}
              onClick={() => run(`sf-${g.id}`, () => exportMatchup(getGameSideName(g, 'a'), getGameSideName(g, 'b'), 'Semifinals', tournament.name))}
            />
          ))}

          {finalGame && (
            <ExportCard
              title="Finals Matchup"
              description={formatMatchup(getGameSideName(finalGame, 'a'), getGameSideName(finalGame, 'b'))}
              disabled={busy}
              loading={busy === 'final-matchup'}
              onClick={() => run('final-matchup', () => exportMatchup(getGameSideName(finalGame, 'a'), getGameSideName(finalGame, 'b'), 'Finals', tournament.name))}
            />
          )}

          {championName && (
            <ExportCard
              title="Champion Announcement"
              description={`${championName} champion, ${runnerUpName} runner-up`}
              disabled={busy}
              loading={busy === 'champion'}
              onClick={() => run('champion', () => exportChampion(championName, tournament.name, runnerUpName))}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ExportCard({ title, description, onClick, disabled, loading }) {
  return (
    <div className="card card-padding" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
      <div>
        <div style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--color-text)' }}>{title}</div>
        <div style={{ fontSize: '14px', color: 'var(--color-text-soft)' }}>{description}</div>
      </div>
      <Button variant="accent" disabled={disabled} onClick={onClick} className="shrink-0">
        {loading ? 'Generating\u2026' : 'Download PNG'}
      </Button>
    </div>
  );
}
