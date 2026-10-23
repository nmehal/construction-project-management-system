import { useState } from 'react';
import { normalizeMoney } from '../utils/money.js';

export const variationStatuses = ['Draft', 'Submitted', 'Pending', 'Approved', 'Rejected'];
export default function VariationForm({ variation, onSave, onCancel }) {
  const initial = { description: variation?.description ?? '', requested_by: variation?.requested_by ?? '', cost_change: variation?.cost_change ?? '', margin: variation?.margin ?? '0', status: variation?.status ?? 'Draft' };
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError(''); setNotice('');
    try {
      const data = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]));
      const changes = variation ? Object.fromEntries(Object.entries(data).filter(([key, value]) => (
        ['cost_change', 'margin'].includes(key) ? normalizeMoney(value) !== normalizeMoney(initial[key]) : value !== initial[key]
      ))) : data;
      if ((!variation || 'description' in changes) && !data.description) throw new Error('Description is required.');
      if (!variation && !data.requested_by) throw new Error('Requested by is required.');
      normalizeMoney(data.cost_change); normalizeMoney(data.margin);
      if (!Object.keys(changes).length) { setNotice('No changes to save.'); return; }
      setBusy(true);
      await onSave(changes);
    } catch (failure) { setError(failure.status === 403 ? 'Access denied. You cannot save this variation.' : failure.message || 'Unable to save variation.'); }
    finally { setBusy(false); }
  }
  return <form className="project-form" aria-label={variation ? 'Edit variation' : 'Create variation'} onSubmit={submit} aria-busy={busy}>
    <h2>{variation ? 'Edit variation' : 'Create variation'}</h2>
    {error && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {[['description', 'Description', 1000], ['requested_by', 'Requested by', 255], ['cost_change', 'Cost change (AUD)'], ['margin', 'Margin (AUD)']].map(([key, label, maxLength]) => <div className="form-field" key={key}>
      <label htmlFor={`variation-${key}`}>{label}</label>
      <input id={`variation-${key}`} type="text" maxLength={maxLength} required={key !== 'requested_by' || !variation} disabled={busy}
        inputMode={['cost_change', 'margin'].includes(key) ? 'decimal' : undefined}
        value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} />
    </div>)}
    <label htmlFor="variation-status">Status</label>
    <select id="variation-status" disabled={busy} value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value })}>
      {variationStatuses.map((status) => <option key={status}>{status}</option>)}
    </select>
    <p className="muted">The backend calculates total from cost change plus margin.</p>
    <div className="project-actions"><button disabled={busy}>{busy ? 'Saving…' : variation ? 'Save changes' : 'Create variation'}</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}
