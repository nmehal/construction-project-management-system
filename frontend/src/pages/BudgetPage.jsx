import { Link, useParams } from 'react-router';
import { getBudget } from '../api/budgets.js';
import useProjectRead from '../hooks/useProjectRead.js';
import ProjectModuleNav from '../components/ProjectModuleNav.jsx';
import { formatAUD, subtractMoney } from '../utils/money.js';

function remaining(category) {
  try { return formatAUD(subtractMoney(category.budget, category.actual)); }
  catch { return 'Unavailable'; }
}
export default function BudgetPage() {
  const { projectId } = useParams();
  const { data, loading, error, retry } = useProjectRead(getBudget, projectId);
  return (
    <section className="page-panel">
      <Link className="text-link" to={`/projects/${encodeURIComponent(projectId)}`}>Back to project</Link>
      <h1>Project budget</h1>
      <ProjectModuleNav projectId={projectId} />
      <p className="muted">Read-only budget categories. Remaining is budget minus actual cost.</p>
      {loading ? <p role="status">Loading budget…</p> : error ? <>
        <p role="alert" className="form-error">{error}</p><button onClick={retry}>Try again</button>
      </> : !data?.length ? <p>No budget categories are available for this project.</p> : (
        <div className="table-scroll"><table>
          <caption className="visually-hidden">Project budget categories (AUD)</caption>
          <thead><tr>{['Category', 'Budget', 'Committed', 'Actual', 'Remaining'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{data.map((category) => <tr key={category.id}>
            <th scope="row">{category.category}</th>
            <td className="money">{formatAUD(category.budget)}</td>
            <td className="money">{formatAUD(category.committed)}</td>
            <td className="money">{formatAUD(category.actual)}</td>
            <td className="money">{remaining(category)}</td>
          </tr>)}</tbody>
        </table></div>
      )}
    </section>
  );
}
