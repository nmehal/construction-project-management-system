import { useState } from 'react';
import { normalizeMoney } from '../utils/money.js';
const moneyFields = ['allowance', 'committed', 'paid'];
const fields = [['company', 'Company', 255], ['trade', 'Trade', 128], ['scope', 'Scope', 1000], ['allowance', 'Allowance (AUD)'], ['committed', 'Committed (AUD)'], ['paid', 'Paid (AUD)'], ['status', 'Status', 32]];
export default function SubcontractorForm({ subcontractor, onSave, onCancel }) {
  const initial = { company: '', trade: '', scope: '', allowance: '', committed: '0', paid: '0', status: 'active' };
  for (const key of Object.keys(initial)) initial[key] = subcontractor?.[key] ?? initial[key];
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
      if (!data.company || !data.trade) throw new Error('Company and trade are required.');
      moneyFields.forEach((key) => normalizeMoney(data[key]));
      const changes = subcontractor ? Object.fromEntries(Object.entries(data).filter(([key, value]) => moneyFields.includes(key) ? normalizeMoney(value) !== normalizeMoney(initial[key]) : value !== initial[key])) : data;
      if (!Object.keys(changes).length) { setNotice('No changes to save.'); return; }
      setBusy(true); await onSave(changes);
    } catch (failure) { setError(failure.status === 403 ? 'Access denied. You cannot save this subcontractor.' : failure.message || 'Unable to save subcontractor.'); }
    finally { setBusy(false); }
  }
  return <form className="project-form" aria-label={subcontractor ? 'Edit subcontractor' : 'Create subcontractor'} onSubmit={submit} aria-busy={busy}>
    <h2>{subcontractor ? 'Edit subcontractor' : 'Create subcontractor'}</h2>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {fields.map(([key, label, maxLength]) => <div className="form-field" key={key}>
      <label htmlFor={`subcontractor-${key}`}>{label}</label>
      <input id={`subcontractor-${key}`} type="text" maxLength={maxLength} required={['company', 'trade', ...moneyFields].includes(key)} disabled={busy}
        inputMode={moneyFields.includes(key) ? 'decimal' : undefined} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} />
    </div>)}
    <div className="project-actions"><button disabled={busy}>{busy ? 'Saving…' : subcontractor ? 'Save changes' : 'Create subcontractor'}</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}
