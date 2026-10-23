import { useState } from 'react';
import { normalizeMoney } from '../utils/money.js';
export const claimStatuses = ['Draft', 'Issued', 'Paid', 'Overdue'];
const fields = [['claim_no', 'Claim number', 64], ['stage', 'Stage', 128], ['amount', 'Amount (AUD)'], ['date', 'Claim date (ISO datetime)'], ['paid_date', 'Paid date (ISO datetime)']];
export default function ClaimForm({ claim, onSave, onCancel }) {
  const initial = { claim_no: '', stage: '', amount: '', date: '', paid_date: '', status: 'Draft' };
  for (const key of Object.keys(initial)) initial[key] = claim?.[key] ?? initial[key];
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
      if (!data.claim_no || !data.date) throw new Error('Claim number and claim date are required.');
      normalizeMoney(data.amount);
      if (claim?.paid_date && !data.paid_date) throw new Error('The backend does not support clearing an existing paid date. Keep it or enter a replacement.');
      const changes = claim ? Object.fromEntries(Object.entries(data).filter(([key, value]) => key === 'amount' ? normalizeMoney(value) !== normalizeMoney(initial[key]) : value !== initial[key])) : data;
      if (!changes.paid_date) delete changes.paid_date;
      if (!Object.keys(changes).length) { setNotice('No changes to save.'); return; }
      setBusy(true); await onSave(changes);
    } catch (failure) { setError(failure.status === 403 ? 'Access denied. You cannot save this claim.' : failure.message || 'Unable to save claim.'); }
    finally { setBusy(false); }
  }
  return <form className="project-form" aria-label={claim ? 'Edit claim' : 'Create claim'} onSubmit={submit} aria-busy={busy}>
    <h2>{claim ? 'Edit claim' : 'Create claim'}</h2>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {fields.map(([key, label, maxLength]) => <div className="form-field" key={key}>
      <label htmlFor={`claim-${key}`}>{label}</label>
      <input id={`claim-${key}`} type="text" maxLength={maxLength} required={['claim_no', 'amount', 'date'].includes(key)} disabled={busy}
        aria-describedby={['date', 'paid_date'].includes(key) ? 'claim-date-help' : undefined}
        inputMode={key === 'amount' ? 'decimal' : undefined} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} />
    </div>)}
    <p id="claim-date-help" className="muted">Enter an ISO datetime, for example 2026-10-23T09:00:00+11:00. Values are sent unchanged, without timezone conversion. The server validates dates. When no paid date exists, leave it blank to let the server set it when marking Paid. Existing paid dates are preserved by the server unless replaced.</p>
    <label htmlFor="claim-status">Status</label>
    <select id="claim-status" disabled={busy} value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value })}>
      {claimStatuses.map((status) => <option key={status}>{status}</option>)}
    </select>
    <div className="project-actions"><button disabled={busy}>{busy ? 'Saving…' : claim ? 'Save changes' : 'Create claim'}</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}
