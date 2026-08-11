import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { roleSatisfies } from '../utils/roles';

export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();

  if (loading) return <div role="status" className="p-6">Checking session…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roleSatisfies(user.role, roles)) return <Navigate to="/" replace />;

  return children;
}
