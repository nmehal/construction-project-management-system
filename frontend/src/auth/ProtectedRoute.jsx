import { Navigate, Outlet } from 'react-router';
import { useAuth } from './AuthProvider.jsx';

export default function ProtectedRoute() {
  const { authenticated, loading } = useAuth();
  if (loading) return <p role="status">Restoring session…</p>;
  return authenticated ? <Outlet /> : <Navigate to="/login" replace />;
}
