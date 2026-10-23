import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { archiveProject, getProject, updateProject } from '../api/projects.js';
import ProjectForm from '../components/ProjectForm.jsx';
import ProjectModuleNav from '../components/ProjectModuleNav.jsx';
import { formatAUD } from '../utils/money.js';

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setProject(null); setEditing(false); setConfirming(false); setActionError('');
    getProject(projectId, controller.signal).then((data) => {
      if (!controller.signal.aborted) setProject(data);
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(failure.status === 403 ? 'Access denied. You do not have permission to view this project.' : failure.message || 'Unable to load project.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, reload]);
  async function archive() {
    if (archiving || project.capabilities?.can_archive_project !== true) return;
    setArchiving(true); setActionError('');
    try {
      const updated = await archiveProject(projectId);
      setProject(updated); setConfirming(false); setEditing(false);
      // Read back authoritative capabilities and archive state after the mutation.
      setProject(await getProject(projectId));
    } catch (failure) { setActionError(failure.message || 'Unable to archive project.'); }
    finally { setArchiving(false); }
  }
  return (
    <section className="page-panel">
      <Link className="text-link" to="/projects">Back to projects</Link>
      <ProjectModuleNav projectId={projectId} />
      {loading ? <p role="status">Loading project…</p> : error ? (
        <div><h1>Project unavailable</h1><p role="alert" className="form-error">{error}</p><button onClick={() => setReload(reload + 1)}>Try again</button></div>
      ) : project && <>
        <h1>{project.name}</h1>
        <dl className="project-details">
          <div><dt>Client</dt><dd>{project.client ?? 'Not provided'}</dd></div>
          <div><dt>Suburb</dt><dd>{project.suburb ?? 'Not provided'}</dd></div>
          <div><dt>Contract value</dt><dd>{formatAUD(project.contract_value)}</dd></div>
          <div><dt>Project status</dt><dd>{project.status}</dd></div>
          <div><dt>Archive status</dt><dd>{project.is_archived ? 'Archived' : 'Not archived'}</dd></div>
          <div><dt>Your project role</dt><dd>{project.project_role ?? 'No project role'}</dd></div>
        </dl>
        <p className="muted">Project access: {project.capabilities?.can_manage_project === true ? 'Can edit project' : 'Cannot edit project'}; {project.capabilities?.can_archive_project === true ? 'can archive project' : 'cannot archive project'}.</p>
        {actionError && <p role="alert" className="form-error">{actionError}</p>}
        <div className="project-actions">
          {project.capabilities?.can_manage_project === true && !editing && !confirming && <button disabled={archiving} onClick={() => setEditing(true)}>Edit project</button>}
          {project.capabilities?.can_archive_project === true && !project.is_archived && !confirming && !editing && <button disabled={archiving} onClick={() => setConfirming(true)}>Archive project</button>}
        </div>
        {confirming && <div className="archive-confirmation" role="group" aria-label="Confirm archive">
          <p>Archive this project? It will be hidden from the default project list.</p>
          <button disabled={archiving} onClick={archive}>{archiving ? 'Archiving…' : 'Confirm archive'}</button>{' '}
          <button disabled={archiving} className="secondary-button" onClick={() => setConfirming(false)}>Cancel archive</button>
        </div>}
        {editing && project.capabilities?.can_manage_project === true && <ProjectForm key={project.id} project={project} onCancel={() => setEditing(false)} onSave={async (changes) => {
          const updated = await updateProject(projectId, changes);
          setProject(updated); setEditing(false);
        }} />}
      </>}
    </section>
  );
}
