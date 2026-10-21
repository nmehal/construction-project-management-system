import { Link, useParams } from 'react-router';
import { getDashboard } from '../api/dashboard.js';
import useProjectRead from '../hooks/useProjectRead.js';
import { formatAUD } from '../utils/money.js';

const groups = [
  ['Contract', [['contract_value', 'Contract value'], ['approved_variations_total', 'Approved variations total'], ['revised_contract_value', 'Revised contract value']]],
  ['Budget', [['budget_total', 'Budget total'], ['budget_committed', 'Budget committed'], ['budget_actual', 'Budget actual'], ['budget_remaining', 'Budget remaining']]],
  ['Subcontractors', [['subcontractor_allowance', 'Subcontractor allowance'], ['subcontractor_committed', 'Subcontractor committed'], ['subcontractor_paid', 'Subcontractor paid'], ['subcontractor_outstanding', 'Subcontractor outstanding']]],
  ['Claims', [['claims_total', 'Claims total'], ['claims_draft', 'Claims draft'], ['claims_issued', 'Claims issued'], ['claims_paid', 'Claims paid'], ['claims_overdue', 'Claims overdue'], ['claims_outstanding', 'Claims outstanding']]],
];
const counts = [
  ['Variation counts', 'variation_counts', ['Draft', 'Submitted', 'Pending', 'Approved', 'Rejected']],
  ['Claim counts', 'claim_counts', ['Draft', 'Issued', 'Paid', 'Overdue']],
];
export default function DashboardPage() {
  const { projectId } = useParams();
  const { data, loading, error, retry } = useProjectRead(getDashboard, projectId);
  return (
    <section className="page-panel">
      <Link className="text-link" to={`/projects/${encodeURIComponent(projectId)}`}>Back to project</Link>
      <h1>Project dashboard</h1>
      {loading ? <p role="status">Loading dashboard…</p> : error ? <>
        <p role="alert" className="form-error">{error}</p><button onClick={retry}>Try again</button>
      </> : !data ? <p>No dashboard data is available.</p> : <>
        <p className="intro">{data.project_name}</p>
        <div className="kpi-grid">
          {groups.map(([title, fields]) => <section className="kpi-section" key={title} aria-label={title}>
            <h2>{title}</h2>
            <dl>{fields.map(([key, label]) => <div className="kpi-item" key={key}><dt>{label}</dt><dd className="money">{formatAUD(data[key])}</dd></div>)}</dl>
          </section>)}
          {counts.map(([title, key, statuses]) => <section className="kpi-section" key={key} aria-label={title}>
            <h2>{title}</h2>
            <dl>{statuses.map((status) => <div className="kpi-item" key={status}><dt>{status}</dt><dd>{data[key]?.[status] ?? 'Unavailable'}</dd></div>)}</dl>
          </section>)}
        </div>
        <p className="muted">Read-only totals from the project API. Budget and subcontractor totals are shown separately. Claims total excludes Draft; claims outstanding includes Issued and Overdue.</p>
      </>}
    </section>
  );
}
