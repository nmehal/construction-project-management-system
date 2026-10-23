import { useState } from 'react';
import SubcontractorForm from '../components/SubcontractorForm.jsx';
import { Link, useParams } from 'react-router';
import { getProject } from '../api/projects.js';
import { listSubcontractors, createSubcontractor, updateSubcontractor } from '../api/subcontractors.js';
import useProjectRead from '../hooks/useProjectRead.js';
import ProjectModuleNav from '../components/ProjectModuleNav.jsx';
import { formatAUD, subtractMoney } from '../utils/money.js';
async function load(id, signal) {
  const [project, subcontractors] = await Promise.all([getProject(id, signal), listSubcontractors(id, signal)]);
  return { project, subcontractors };
}
export default function SubcontractorsPage() {
  const { projectId } = useParams();
  return <SubcontractorsWorkspace key={projectId} projectId={projectId} />;
}
function SubcontractorsWorkspace({ projectId }) {
  const { data, loading, error, retry } = useProjectRead(load, projectId);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState('');
  const canCreate = data?.project.capabilities?.can_create_subcontractors === true;
  const canUpdate = data?.project.capabilities?.can_update_subcontractors === true;
  async function save(values) {
    if (form.kind === 'create') await createSubcontractor(projectId, values);
    else await updateSubcontractor(projectId, form.subcontractor.id, values);
    setForm(null); setSaved('Subcontractor saved.'); retry();
  }
  return <section className="page-panel">
    <Link className="text-link" to={`/projects/${encodeURIComponent(projectId)}`}>Back to project</Link>
    <h1>Subcontractors</h1>
    <ProjectModuleNav projectId={projectId} />
    {loading ? <p role="status">Loading subcontractors…</p> : error ? <><p role="alert" className="form-error">{error}</p><button onClick={retry}>Try again</button></> : data && <>
      <p className="intro">{data.project.name}</p>
      {saved && <p role="status">{saved}</p>}
      {canCreate && !form && <button onClick={() => { setSaved(''); setForm({ kind: 'create' }); }}>New subcontractor</button>}
      {form && ((form.kind === 'create' && canCreate) || (form.kind === 'edit' && canUpdate)) && <SubcontractorForm key={form.subcontractor?.id ?? 'new'} subcontractor={form.subcontractor} onSave={save} onCancel={() => setForm(null)} />}
      {data.subcontractors.length === 0 ? <p>No subcontractors are available for this project.</p> : <div className="table-scroll"><table>
        <caption className="visually-hidden">Project subcontractors</caption>
        <thead><tr>{['Company', 'Trade', 'Scope', 'Allowance', 'Committed', 'Paid', 'Outstanding', 'Status', ...(canUpdate ? ['Actions'] : [])].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{data.subcontractors.map((subcontractor) => <tr key={subcontractor.id}>
          <th scope="row">{subcontractor.company}</th><td>{subcontractor.trade}</td><td>{subcontractor.scope || 'Not provided'}</td>
          <td className="money">{formatAUD(subcontractor.allowance)}</td><td className="money">{formatAUD(subcontractor.committed)}</td><td className="money">{formatAUD(subcontractor.paid)}</td>
          <td className="money">{formatAUD(subtractMoney(subcontractor.committed, subcontractor.paid))}</td><td>{subcontractor.status}</td>
          {canUpdate && <td><button disabled={Boolean(form)} aria-label={`Edit ${subcontractor.company}`} onClick={() => { setSaved(''); setForm({ kind: 'edit', subcontractor }); }}>Edit</button></td>}
        </tr>)}</tbody>
      </table><p className="muted">Outstanding = committed − paid (display only).</p></div>}
    </>}
  </section>;
}
