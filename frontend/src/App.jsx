import AppRoutes from './routes.jsx';
import { AuthProvider } from './auth/AuthProvider.jsx';

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>;
}
