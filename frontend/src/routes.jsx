import { Route, Routes } from 'react-router';
import AppLayout from './components/AppLayout.jsx';
import HomePage from './pages/HomePage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ProtectedRoute from './auth/ProtectedRoute.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import NewProjectPage from './pages/NewProjectPage.jsx';
import ProjectDetailPage from './pages/ProjectDetailPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import BudgetPage from './pages/BudgetPage.jsx';

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route index element={<HomePage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/new" element={<NewProjectPage />} />
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="projects/:projectId/dashboard" element={<DashboardPage />} />
          <Route path="projects/:projectId/budget" element={<BudgetPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
