import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useTournamentSelection } from '../utils/useTournamentSelection';
import TournamentPicker from '../components/TournamentPicker';
import StandingsTable from '../components/StandingsTable';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCard } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { isAdminRole } from '../utils/roles';

export default function Standings() {
  const { user } = useAuth();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const { tournaments, tournamentId, setTournamentId } = useTournamentSelection();
  const [tournament, setTournament] = useState(null);
  const [groups, setGroups] = useState([]);
  const [teams, setTeams] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [overrideTeam, setOverrideTeam] = useState('');
  const [overrideRank, setOverrideRank] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const fromUrl = searchParams.get('tournament');
    if (fromUrl) setTournamentId(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function load() {
    if (!tournamentId) { setLoading(false); return; }
    setLoading(true);
    api.get(`/standings/by-group?tournament_id=${tournamentId}`)
      .then((d) => setGroups(d.groups))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
    api.get(`/teams?tournament_id=${tournamentId}`).then((d) => setTeams(d.teams)).catch(() => {});
    api.get(`/tournaments/${tournamentId}/entries`).then((d) => setEntries(d.entries)).catch(() => setEntries([]));
    api.get(`/tournaments/${tournamentId}`).then((d) => setTournament(d.tournament)).catch(() => {});
  }

  useEffect(load, [tournamentId]);

  async function handleOverride(e) {
    e.preventDefault();
    setError('');
    try {
      const payload = { manual_rank_override: overrideRank ? Number(overrideRank) : null };
      if (tournament?.sport === 'pickleball') {
        await api.put(`/tournaments/${tournamentId}/entries/${overrideTeam}`, payload);
      } else {
        await api.put(`/teams/${overrideTeam}`, payload);
      }
      toast.success('Ranking override applied.');
      setOverrideTeam('');
      setOverrideRank('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const advancingCount = tournament?.format === 'groups_playoffs' ? tournament.advancing_per_group : null;
  const overrideOptions = tournament?.sport === 'pickleball' ? entries : teams;

  return (
    <div>
      <PageHeader title="Standings" />
      <TournamentPicker tournaments={tournaments} tournamentId={tournamentId} onChange={setTournamentId} />

      {loading && <SkeletonCard lines={4} />}

      {!loading && tournamentId && groups.length === 0 && (
        <EmptyState icon="📊" title="No standings yet" description="Standings appear once games have been scheduled and results approved." />
      )}

      <div className="space-y-8">
        {!loading && groups.map(({ group, standings }) => (
          <div key={group ? group.id : 'overall'} className="card card-padding">
            <h2 style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--color-text)', marginBottom: '16px' }}>{group ? group.name : 'Overall Standings'}</h2>
            <StandingsTable standings={standings} advancingCount={group ? advancingCount : null} />
            {group && advancingCount && (
              <div style={{ fontSize: '12px', color: 'var(--color-text-soft)', marginTop: '12px' }}>Top {advancingCount} advance to the playoffs.</div>
            )}
          </div>
        ))}
      </div>

      {isAdminRole(user.role) && overrideOptions.length > 0 && (
        <div className="card card-padding mt-8">
          <h2 style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Committee Override</h2>
          <p style={{ fontSize: '14px', color: 'var(--color-text-soft)', marginBottom: '16px' }}>
            Use this only when the documented tiebreakers cannot settle a tie and the committee must set a competitor's rank.
            Entries marked this way show a "*" on the public standings.
          </p>
          <form onSubmit={handleOverride} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px' }}>
            <div>
              <label className="label">{tournament?.sport === 'pickleball' ? 'Entry' : 'Team'}</label>
              <select className="input" required value={overrideTeam} onChange={(e) => setOverrideTeam(e.target.value)}>
                <option value="">Select competitor</option>
                {overrideOptions.map((t) => (
                  <option key={t.id} value={t.id}>{t.display_name || t.name}{t.manual_rank_override ? ` (currently rank ${t.manual_rank_override})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Force Rank (blank to clear)</label>
              <input type="number" min="1" className="input w-32" value={overrideRank} onChange={(e) => setOverrideRank(e.target.value)} />
            </div>
            <button className="btn-secondary">Apply</button>
            {error && <div style={{ color: 'var(--color-danger)', fontSize: '14px' }}>{error}</div>}
          </form>
        </div>
      )}
    </div>
  );
}
