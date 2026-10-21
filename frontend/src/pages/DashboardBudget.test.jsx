import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.jsx';
import { clearSession } from '../api/client.js';
import { subtractMoney } from '../utils/money.js';

const id = '11111111-1111-4111-8111-111111111111';
const monetary = {
  contract_value: '100000.10', approved_variations_total: '100.20', revised_contract_value: '100100.30',
  budget_total: '10000.10', budget_committed: '4000.20', budget_actual: '3000.30', budget_remaining: '6999.80',
  subcontractor_allowance: '8000.10', subcontractor_committed: '6000.20', subcontractor_paid: '2000.30', subcontractor_outstanding: '3999.90',
  claims_total: '600.60', claims_draft: '900.90', claims_issued: '100.10', claims_paid: '200.20', claims_overdue: '300.30', claims_outstanding: '400.40',
};
const moneyLabels = [
  ['Contract value', 'A$100,000.10'], ['Approved variations total', 'A$100.20'], ['Revised contract value', 'A$100,100.30'],
  ['Budget total', 'A$10,000.10'], ['Budget committed', 'A$4,000.20'], ['Budget actual', 'A$3,000.30'], ['Budget remaining', 'A$6,999.80'],
  ['Subcontractor allowance', 'A$8,000.10'], ['Subcontractor committed', 'A$6,000.20'], ['Subcontractor paid', 'A$2,000.30'], ['Subcontractor outstanding', 'A$3,999.90'],
  ['Claims total', 'A$600.60'], ['Claims draft', 'A$900.90'], ['Claims issued', 'A$100.10'], ['Claims paid', 'A$200.20'], ['Claims overdue', 'A$300.30'], ['Claims outstanding', 'A$400.40'],
];
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
let dashboard, budget, network, failure, authenticated, systemRole;
beforeEach(() => {
  clearSession(); failure = 0; authenticated = true; systemRole = 'Viewer';
  dashboard = { project_id: id, project_name: 'Fictional Wattle Renovation', ...monetary,
    variation_counts: { Draft: 1, Submitted: 2, Pending: 3, Approved: 4, Rejected: 5 },
    claim_counts: { Draft: 6, Issued: 7, Paid: 8, Overdue: 9 },
  };
  budget = [
    { id: 'budget-one', category: 'Framing', budget: '100.30', committed: '90.10', actual: '100.10' },
    { id: 'budget-two', category: 'Plumbing', budget: '0.20', committed: '0.20', actual: '100.30' },
  ];
  network = vi.fn(async (path) => {
    if (path === '/auth/refresh') return authenticated ? reply({ access_token: 'read-token' }) : reply({ detail: 'Expired' }, 401);
    if (path === '/auth/me') return reply({ id: 'user', email: 'reader@example.com', system_role: systemRole });
    if (path === `/projects/${id}`) return reply({ id, name: 'Fictional Wattle Renovation', client: 'Fictional Client', suburb: 'Ballarat', contract_value: '100000.10', status: 'Active', is_archived: false, project_role: 'Viewer', capabilities: { can_read: true, can_manage_project: false, can_archive_project: false } });
    if (path === `/projects/${id}/dashboard`) return failure ? reply({ detail: 'Dashboard unavailable' }, failure) : reply(dashboard);
    if (path === `/projects/${id}/budget`) return failure ? reply({ detail: 'Budget unavailable' }, failure) : reply(budget);
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal('fetch', network);
});
afterEach(() => { clearSession(); vi.unstubAllGlobals(); });
function open(module) { render(<MemoryRouter initialEntries={[`/projects/${id}${module ? `/${module}` : ''}`]}><App /></MemoryRouter>); }
async function loadedDashboard() { return screen.findByText('Fictional Wattle Renovation'); }
function assertReadOnly() {
  const calls = network.mock.calls.filter(([path]) => path.startsWith('/projects/'));
  expect(calls.length).toBeGreaterThan(0);
  for (const [, options] of calls) {
    expect(options.method).toBe('GET');
    expect(options.headers.get('Authorization')).toBe('Bearer read-token');
    expect(options.body).toBeUndefined();
  }
  expect(screen.queryByRole('button', { name: /edit|save|create/i })).not.toBeInTheDocument();
}

describe('read-only project dashboard', () => {
  it('renders all backend monetary KPI values in separate groups without recomputing them', async () => {
    open('dashboard'); await loadedDashboard();
    expect(screen.getByRole('heading', { name: 'Project dashboard' })).toBeVisible();
    for (const [label, expected] of moneyLabels) {
      expect(within(screen.getByText(label, { selector: 'dt' }).parentElement).getByText(expected)).toBeVisible();
    }
    for (const group of ['Contract', 'Budget', 'Subcontractors', 'Claims']) expect(screen.getByRole('region', { name: group })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to project' })).toHaveAttribute('href', `/projects/${id}`);
    expect(dashboard.contract_value).toBe('100000.10');
    assertReadOnly();
  });

  it('renders all five variation counts from the API', async () => {
    open('dashboard'); await loadedDashboard();
    const section = within(screen.getByRole('region', { name: 'Variation counts' }));
    for (const [status, count] of Object.entries(dashboard.variation_counts)) {
      expect(section.getByText(status).nextElementSibling).toHaveTextContent(String(count));
    }
  });

  it('renders all four claim counts independently of variation counts', async () => {
    open('dashboard'); await loadedDashboard();
    const section = within(screen.getByRole('region', { name: 'Claim counts' }));
    for (const [status, count] of Object.entries(dashboard.claim_counts)) {
      expect(section.getByText(status).nextElementSibling).toHaveTextContent(String(count));
    }
  });

  it('renders zero monetary totals and counts for an empty project', async () => {
    Object.keys(monetary).forEach((key) => { dashboard[key] = '0'; });
    Object.keys(dashboard.variation_counts).forEach((key) => { dashboard.variation_counts[key] = 0; });
    Object.keys(dashboard.claim_counts).forEach((key) => { dashboard.claim_counts[key] = 0; });
    open('dashboard'); await loadedDashboard();
    for (const [label] of moneyLabels) expect(screen.getByText(label, { selector: 'dt' }).nextElementSibling).toHaveTextContent('A$0.00');
    expect(within(screen.getByRole('region', { name: 'Claim counts' })).getByText('Draft').nextElementSibling).toHaveTextContent('0');
  });

  it('shows dashboard API errors and supports retry', async () => {
    failure = 500; open('dashboard');
    expect(await screen.findByRole('alert')).toHaveTextContent('Dashboard unavailable');
    expect(screen.queryByRole('region', { name: 'Contract' })).not.toBeInTheDocument();
    failure = 0; fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await loadedDashboard();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('read-only budget', () => {
  it('renders categories and exact remaining amounts, including over-budget negatives', async () => {
    open('budget'); const table = await screen.findByRole('table');
    const framing = within(within(table).getByRole('row', { name: /Framing/ }));
    expect(framing.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['A$100.30', 'A$90.10', 'A$100.10', 'A$0.20']);
    const plumbing = within(within(table).getByRole('row', { name: /Plumbing/ }));
    expect(plumbing.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['A$0.20', 'A$0.20', 'A$100.30', '-A$100.10']);
    expect(budget[0].budget).toBe('100.30');
    assertReadOnly();
  });

  it('explains the empty budget without offering category creation', async () => {
    budget = []; open('budget');
    expect(await screen.findByText('No budget categories are available for this project.')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    assertReadOnly();
  });

  it('shows budget API error rather than reporting an empty budget', async () => {
    failure = 500; open('budget');
    expect(await screen.findByRole('alert')).toHaveTextContent('Budget unavailable');
    expect(screen.queryByText('No budget categories are available for this project.')).not.toBeInTheDocument();
  });

  it('does not fabricate remaining values for invalid monetary data', async () => {
    budget[0].actual = null; open('budget');
    const row = await screen.findByRole('row', { name: /Framing/ });
    expect(within(row).getAllByText('Unavailable')).toHaveLength(2);
  });
});

describe('module access and navigation', () => {
  it.each(['dashboard', 'budget'])('shows authoritative 403 for %s even for system Admin', async (module) => {
    systemRole = 'Admin'; failure = 403; open(module);
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied. You do not have permission to view this project.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Contract' })).not.toBeInTheDocument();
  });

  it.each(['dashboard', 'budget'])('protects the direct %s route from unauthenticated access', async (module) => {
    authenticated = false; open(module);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(network.mock.calls.filter(([path]) => path.startsWith('/projects'))).toHaveLength(0);
  });

  it.each(['dashboard', 'budget'])('shows loading until the %s request resolves', async (module) => {
    let release;
    const original = network.getMockImplementation();
    network.mockImplementation((path, options) => path.endsWith(`/${module}`) ? new Promise((resolve) => { release = resolve; }) : original(path, options));
    open(module);
    expect(await screen.findByText(`Loading ${module}…`)).toBeVisible();
    await waitFor(() => expect(release).toBeTypeOf('function'));
    release(reply(module === 'dashboard' ? dashboard : budget));
    if (module === 'dashboard') await loadedDashboard(); else await screen.findByRole('table');
    expect(screen.queryByText(`Loading ${module}…`)).not.toBeInTheDocument();
  });

  it('links project detail only to implemented Dashboard and Budget modules', async () => {
    open(); await screen.findByRole('heading', { name: 'Fictional Wattle Renovation' });
    const nav = within(screen.getByRole('navigation', { name: 'Project modules' }));
    expect(nav.getAllByRole('link').map((link) => link.textContent)).toEqual(['Dashboard', 'Budget']);
    expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', `/projects/${id}/dashboard`);
    expect(nav.getByRole('link', { name: 'Budget' })).toHaveAttribute('href', `/projects/${id}/budget`);
    fireEvent.click(nav.getByRole('link', { name: 'Dashboard' }));
    await screen.findByRole('region', { name: 'Contract' });
    fireEvent.click(screen.getByRole('link', { name: 'Back to project' }));
    await screen.findByRole('heading', { name: 'Fictional Wattle Renovation' });
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Project modules' })).getByRole('link', { name: 'Budget' }));
    expect(await screen.findByRole('table')).toBeVisible();
  });
});

describe('exact decimal remaining calculation', () => {
  it.each([
    ['100.30', '100.10', '0.20'], ['100.10', '0.20', '99.90'],
    ['0.20', '100.30', '-100.10'], ['0', '0.00', '0.00'],
    ['999999999999999999.99', '0.01', '999999999999999999.98'],
    ['-0.10', '-0.20', '0.10'],
  ])('subtracts %s minus %s exactly', (budgetValue, actual, expected) => {
    expect(subtractMoney(budgetValue, actual)).toBe(expected);
  });
});
