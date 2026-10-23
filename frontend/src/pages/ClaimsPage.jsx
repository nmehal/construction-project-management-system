import { useState } from 'react';
import ClaimForm from '../components/ClaimForm.jsx';
import { Link, useParams } from 'react-router';
import { getProject } from '../api/projects.js';
import { listClaims, createClaim, updateClaim } from '../api/claims.js';
import useProjectRead from '../hooks/useProjectRead.js';
import ProjectModuleNav from '../components/ProjectModuleNav.jsx';
import { formatAUD } from '../utils/money.js';
async function load(id, signal) {
  const [project, claims] = await Promise.all([getProject(id, signal), listClaims(id, signal)]);
  return { project, claims };
}
export default function ClaimsPage() {
  const { projectId } = useParams();
  return <ClaimsWorkspace key={projectId} projectId={projectId} />;
}
function ClaimsWorkspace({ projectId }) {
  const { data, loading, error, retry } = useProjectRead(load, projectId);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState('');
  const canCreate = data?.project.capabilities?.can_create_claims === true;
  const canUpdate = data?.project.capabilities?.can_update_claims === true;
  async function save(values) {
    if (form.kind === 'create') await createClaim(projectId, values);
    else await updateClaim(projectId, form.claim.id, values);
    setForm(null); setSaved('Claim saved.'); retry();
  }
  return <section className="page-panel">
    <Link className="text-link" to={`/projects/${encodeURIComponent(projectId)}`}>Back to project</Link>
    <h1>Progress claims</h1>
    <ProjectModuleNav projectId={projectId} />
    {loading ? <p role="status">Loading claims…</p> : error ? <><p role="alert" className="form-error">{error}</p><button onClick={retry}>Try again</button></> : data && <>
      <p className="intro">{data.project.name}</p>
      {saved && <p role="status">{saved}</p>}
      {canCreate && !form && <button onClick={() => { setSaved(''); setForm({ kind: 'create' }); }}>New claim</button>}
      {form && ((form.kind === 'create' && canCreate) || (form.kind === 'edit' && canUpdate)) && <ClaimForm key={form.claim?.id ?? 'new'} claim={form.claim} onSave={save} onCancel={() => setForm(null)} />}
      {data.claims.length === 0 ? <p>No claims are available for this project.</p> : <div className="table-scroll"><table>
        <caption className="visually-hidden">Project claims</caption>
        <thead><tr>{['Claim number', 'Stage', 'Amount', 'Status', 'Claim date', 'Paid date', ...(canUpdate ? ['Actions'] : [])].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{data.claims.map((claim) => <tr key={claim.id}>
          <th scope="row">{claim.claim_no}</th><td>{claim.stage || 'Not provided'}</td>
          <td className="money">{formatAUD(claim.amount)}</td><td>{claim.status}</td>
          <td>{claim.date}</td><td>{claim.paid_date ?? 'Not provided'}</td>
          {canUpdate && <td><button disabled={Boolean(form)} aria-label={`Edit ${claim.claim_no}`} onClick={() => { setSaved(''); setForm({ kind: 'edit', claim }); }}>Edit</button></td>}
        </tr>)}</tbody>
      </table><p className="muted">Dates are shown as returned by the API, including any timezone offset.</p></div>}
    </>}
  </section>;
}
