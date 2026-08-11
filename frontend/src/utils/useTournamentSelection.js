import { useEffect, useState } from 'react';
import { api } from '../api/client';

const LAST_TOURNAMENT_KEY = 'blm_last_tournament_id';

export function useTournamentSelection() {
  const [tournaments, setTournaments] = useState([]);
  const [tournamentId, setTournamentIdState] = useState(() => localStorage.getItem(LAST_TOURNAMENT_KEY) || '');
  const [loading, setLoading] = useState(true);

  function setTournamentId(id) {
    setTournamentIdState(id);
    if (id) localStorage.setItem(LAST_TOURNAMENT_KEY, id);
  }

  useEffect(() => {
    api.get('/tournaments').then((d) => {
      setTournaments(d.tournaments);
      setLoading(false);
      const stillExists = d.tournaments.some((t) => String(t.id) === String(tournamentId));
      if (!stillExists) {
        const active = d.tournaments.find((t) => t.status === 'active') || d.tournaments[0];
        if (active) setTournamentId(String(active.id));
      }
    }).catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { tournaments, tournamentId, setTournamentId, loading };
}
