import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { getProject } from '../api/projects.js';
import { listVariations, createVariation, updateVariation } from '../api/variations.js';
import useProjectRead from '../hooks/useProjectRead.js';
import VariationForm from '../components/VariationForm.jsx';
import { formatAUD } from '../utils/money.js';

async function load(id, signal) {
  const [project, variations] = await Promise.all([getProject(id, signal), listVariations(id, signal)]);
  return { project, variations };
}
export default function VariationsPage() {
  const { projectId } = useParams();
  // Key the workspace to the project so forms cannot leak across project changes.
  return <VariationsWorkspace key={projectId} projectId={projectId} />;
}
function VariationsWorkspace({ projectId }) {
  const { data, loading, error, retry } = useProjectRead(load, projectId);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState('');
  const canCreate = data?.project.capabilities?.can_create_variations === true;
  const canUpdate = data?.project.capabilities?.can_update_variations === true;
  async function save(values) {
    if (form.kind === 'create') await createVariation(projectId, values);
    else await updateVariation(projectId, form.variation.id, values);
    setForm(null); setSaved('Variation saved.'); retry();
  }
  return <section className="page-panel">
    <Link className="text-link" to={`/projects/${encodeURIComponent(projectId)}`}>Back to project</Link>
    <h1>Variations</h1>
    {loading ? <p role="status">Loading variations…</p> : error ? <><p role="alert" className="form-error">{error}</p><button onClick={retry}>Try again</button></> : data && <>
      <p className="intro">{data.project.name}</p>
      {saved && <p role="status">{saved}</p>}
      {canCreate && !form && <button onClick={() => { setSaved(''); setForm({ kind: 'create' }); }}>New variation</button>}
      {form && ((form.kind === 'create' && canCreate) || (form.kind === 'edit' && canUpdate)) && <VariationForm
        key={form.kind === 'create' ? 'new' : form.variation.id} variation={form.variation}
        onSave={save} onCancel={() => setForm(null)} />}
      {data.variations.length === 0 ? <p>No variations are available for this project.</p> : <div className="table-scroll"><table>
        <caption className="visually-hidden">Project variations</caption>
        <thead><tr>{['Description', 'Requested by', 'Cost change', 'Margin', 'Total', 'Status', ...(canUpdate ? ['Actions'] : [])].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{data.variations.map((variation) => <tr key={variation.id}>
          <th scope="row">{variation.description}</th><td>{variation.requested_by ?? 'Not provided'}</td>
          <td className="money">{formatAUD(variation.cost_change)}</td><td className="money">{formatAUD(variation.margin)}</td><td className="money">{formatAUD(variation.total)}</td><td>{variation.status}</td>
          {canUpdate && <td><button disabled={Boolean(form)} aria-label={`Edit ${variation.description}`} onClick={() => { setSaved(''); setForm({ kind: 'edit', variation }); }}>Edit</button></td>}
        </tr>)}</tbody>
      </table></div>}
    </>}
  </section>;
}
