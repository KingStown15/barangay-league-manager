import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { createRequestSession } from './usePolling';

export function usePublicTournament() {
  const { tournamentId } = useParams();
  const [tournament, setTournament] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const session = createRequestSession();
    setTournament(null);
    setError('');
    api.public.get(`/public/tournaments/${tournamentId}`)
      .then((d) => {
        if (session.isCurrent()) setTournament(d.tournament);
      })
      .catch((err) => {
        if (session.isCurrent()) setError(err.message);
      });
    return session.cancel;
  }, [tournamentId]);

  return { tournament, tournamentId, error };
}
