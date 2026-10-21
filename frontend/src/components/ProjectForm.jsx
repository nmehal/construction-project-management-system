import { useState } from 'react';
import { normalizeMoney } from '../utils/money.js';

const fields = [
  ['name', 'Project name', 255], ['client', 'Client', 255], ['suburb', 'Suburb', 128],
  ['contract_value', 'Contract value (AUD)', undefined],
];
export default function ProjectForm({ project, onSave, onCancel }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(([key]) => [key, project?.[key] ?? ''])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError(''); setNotice('');
    try {
      const trimmed = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]));
      if (fields.some(([key]) => !trimmed[key])) throw new Error('Complete all required fields.');
      normalizeMoney(trimmed.contract_value);
      const changes = project ? Object.fromEntries(Object.entries(trimmed).filter(([key, value]) => (
        key === 'contract_value' ? normalizeMoney(value) !== normalizeMoney(project[key]) : value !== (project[key] ?? '')
      ))) : trimmed;
      if (!Object.keys(changes).length) { setNotice('No changes to save.'); return; }
      setBusy(true);
      await onSave(changes);
    } catch (failure) { setError(failure.message || 'Unable to save project.'); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} aria-label={project ? 'Edit project' : 'Create project'} aria-busy={busy} className="project-form">
      {error && <p role="alert" className="form-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {fields.map(([key, label, maxLength]) => (
        <div key={key} className="form-field">
          <label htmlFor={`project-${key}`}>{label}</label>
          <input id={`project-${key}`} name={key} type="text" required maxLength={maxLength}
            inputMode={key === 'contract_value' ? 'decimal' : undefined}
            value={values[key]} disabled={busy}
            onChange={(event) => setValues({ ...values, [key]: event.target.value })} />
        </div>
      ))}
      <div className="project-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : project ? 'Save changes' : 'Create project'}</button>
        {onCancel && <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </form>
  );
}
