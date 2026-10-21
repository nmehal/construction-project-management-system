import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { canCreateProject, listProjects } from '../api/projects.js';
import { formatAUD } from '../utils/money.js';

export default function ProjectsPage() {
  const { user } = useAuth();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    listProjects(includeArchived, controller.signal).then((data) => {
      if (!controller.signal.aborted) setProjects(data);
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(failure.message || 'Unable to load projects.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [includeArchived, reload]);
  return (
    <section className="page-panel" aria-labelledby="projects-title">
      <div className="project-heading">
        <h1 id="projects-title">Projects</h1>
        {canCreateProject(user) && <Link className="text-link" to="/projects/new">New project</Link>}
      </div>
      <label className="checkbox-label"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />Include archived projects</label>
      {loading ? <p role="status">Loading projects…</p> : error ? (
        <div><p role="alert" className="form-error">{error}</p><button onClick={() => setReload(reload + 1)}>Try again</button></div>
      ) : projects.length === 0 ? <p>No projects found{includeArchived ? '.' : '. Archived projects are hidden.'}</p> : (
        <div className="table-scroll"><table>
          <caption className="visually-hidden">Accessible projects</caption>
          <thead><tr><th scope="col">Project</th><th scope="col">Client</th><th scope="col">Suburb</th><th scope="col">Contract value</th><th scope="col">Archive status</th><th scope="col">Project role</th></tr></thead>
          <tbody>{projects.map((project) => <tr key={project.id}>
            <td><Link to={`/projects/${encodeURIComponent(project.id)}`}>{project.name}</Link></td>
            <td>{project.client ?? 'Not provided'}</td><td>{project.suburb ?? 'Not provided'}</td>
            <td className="money">{formatAUD(project.contract_value)}</td>
            <td>{project.is_archived ? 'Archived' : 'Not archived'}</td>
            <td>{project.project_role ?? 'No project role'}</td>
          </tr>)}</tbody>
        </table></div>
      )}
    </section>
  );
}
