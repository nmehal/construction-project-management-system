import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { canCreateProject, createProject } from '../api/projects.js';
import ProjectForm from '../components/ProjectForm.jsx';

export default function NewProjectPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  return (
    <section className="page-panel">
      <Link className="text-link" to="/projects">Back to projects</Link>
      <h1>New project</h1>
      {canCreateProject(user) ? <ProjectForm onSave={async (values) => {
        const created = await createProject(values);
        navigate(`/projects/${encodeURIComponent(created.id)}`, { replace: true });
      }} onCancel={() => navigate('/projects')} /> : <p role="alert">Your system role cannot create projects.</p>}
    </section>
  );
}
