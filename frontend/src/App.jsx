import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './layouts/AdminLayout';
import ScorerLayout from './layouts/ScorerLayout';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Tournaments from './pages/Tournaments';
import TournamentDetail from './pages/TournamentDetail';
import Teams from './pages/Teams';
import Players from './pages/Players';
import Entries from './pages/Entries';
import Games from './pages/Games';
import Scorer from './pages/Scorer';
import ScorerConsole from './pages/ScorerConsole';
import Standings from './pages/Standings';
import Bracket from './pages/Bracket';
import Users from './pages/Users';
import ExportCenter from './pages/ExportCenter';
import SystemUpdate from './pages/SystemUpdate';
import ChangePassword from './pages/ChangePassword';

import PublicTournamentList from './pages/PublicTournamentList';
import PublicOverview from './pages/PublicOverview';
import PublicSchedule from './pages/PublicSchedule';
import PublicResults from './pages/PublicResults';
import PublicStandings from './pages/PublicStandings';
import PublicBracket from './pages/PublicBracket';

function withLayout(Layout, Page) {
  return (
    <Layout>
      <Page />
    </Layout>
  );
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Public routes - no login required */}
      <Route path="/public" element={<PublicTournamentList />} />
      <Route path="/public/:tournamentId" element={<PublicOverview />} />
      <Route path="/public/:tournamentId/schedule" element={<PublicSchedule />} />
      <Route path="/public/:tournamentId/results" element={<PublicResults />} />
      <Route path="/public/:tournamentId/standings" element={<PublicStandings />} />
      <Route path="/public/:tournamentId/bracket" element={<PublicBracket />} />

      {/* Scorer gets a minimal, mobile-first single screen */}
      <Route
        path="/scorer"
        element={
          <ProtectedRoute roles={['scorer', 'admin']}>
            <ScorerLayout><Scorer /></ScorerLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/scorer-console/:gameId"
        element={
          <ProtectedRoute roles={['scorer', 'admin']}>
            <ScorerConsole />
          </ProtectedRoute>
        }
      />

      {/* Admin (and scorer, where relevant) app */}
      <Route
        path="/"
        element={
          <ProtectedRoute roles={['admin', 'scorer']}>
            {user?.role === 'scorer' ? <Navigate to="/scorer" replace /> : <AdminLayout><Dashboard /></AdminLayout>}
          </ProtectedRoute>
        }
      />
      <Route path="/tournaments" element={<ProtectedRoute roles={['admin', 'scorer']}>{withLayout(AdminLayout, Tournaments)}</ProtectedRoute>} />
      <Route path="/tournaments/:id" element={<ProtectedRoute roles={['admin', 'scorer']}>{withLayout(AdminLayout, TournamentDetail)}</ProtectedRoute>} />
      <Route path="/teams" element={<ProtectedRoute roles={['admin', 'scorer']}>{withLayout(AdminLayout, Teams)}</ProtectedRoute>} />
      <Route path="/players" element={<ProtectedRoute roles={['admin', 'scorer']}>{withLayout(AdminLayout, Players)}</ProtectedRoute>} />
      <Route path="/entries" element={<ProtectedRoute roles={['admin', 'scorer']}>{withLayout(AdminLayout, Entries)}</ProtectedRoute>} />
      <Route path="/games" element={<ProtectedRoute roles={['admin', 'scorer']}>{withLayout(AdminLayout, Games)}</ProtectedRoute>} />
      <Route path="/standings" element={<ProtectedRoute roles={['admin', 'scorer']}>{withLayout(AdminLayout, Standings)}</ProtectedRoute>} />
      <Route path="/bracket" element={<ProtectedRoute roles={['admin', 'scorer']}>{withLayout(AdminLayout, Bracket)}</ProtectedRoute>} />
      <Route path="/export" element={<ProtectedRoute roles={['admin']}>{withLayout(AdminLayout, ExportCenter)}</ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute roles={['admin']}>{withLayout(AdminLayout, Users)}</ProtectedRoute>} />
      <Route path="/system-update" element={<ProtectedRoute roles={['super_admin']}>{withLayout(AdminLayout, SystemUpdate)}</ProtectedRoute>} />
      <Route
        path="/change-password"
        element={
          <ProtectedRoute roles={['super_admin', 'admin', 'scorer']}>
            {user?.role === 'scorer'
              ? <ScorerLayout><ChangePassword /></ScorerLayout>
              : withLayout(AdminLayout, ChangePassword)}
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
