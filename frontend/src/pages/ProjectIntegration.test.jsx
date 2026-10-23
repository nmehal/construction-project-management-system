import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App.jsx';
import { clearSession } from '../api/client.js';

const id = '11111111-1111-4111-8111-111111111111';
const modules = [['Overview', ''], ['Dashboard', '/dashboard'], ['Budget', '/budget'], ['Variations', '/variations'], ['Subcontractors', '/subcontractors'], ['Claims', '/claims']];
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
let network, authenticated, failure, capabilities;
beforeEach(() => {
  clearSession(); authenticated = true; failure = 0; capabilities = undefined;
  network = vi.fn(async (path) => {
    if (path === '/auth/refresh') return authenticated ? reply({ access_token: 'integration-token' }) : reply({ detail: 'Expired' }, 401);
    if (path === '/auth/me') return reply({ id: 'reader', email: 'demo@example.com', system_role: 'Admin' });
    if (failure) return reply({ detail: 'Unavailable' }, failure);
    if (path === `/projects/${id}`) return reply({ id, name: 'Fictional Integration House', contract_value: '999999999999999999.99', status: 'Active', project_role: 'Manager', is_archived: false, capabilities });
    if (path === `/projects/${id}/dashboard`) return reply({ project_name: 'Fictional Integration House', contract_value: '999999999999999999.99', approved_variations_total: '0.30', revised_contract_value: '1000000000000000000.29', budget_total: '10.10', budget_actual: '0.10', budget_committed: '1.00', budget_remaining: '10.00', subcontractor_allowance: '10.00', subcontractor_committed: '1.10', subcontractor_paid: '0.10', subcontractor_outstanding: '1.00', claims_total: '999999999999999999.99', claims_paid: '999999999999999999.99', claims_draft: '0.00', claims_issued: '0.00', claims_overdue: '0.00', claims_outstanding: '0.00', variation_counts: { Draft: 0, Submitted: 0, Pending: 0, Approved: 1, Rejected: 0 }, claim_counts: { Draft: 0, Issued: 0, Paid: 1, Overdue: 0 } });
    if (path === `/projects/${id}/budget`) return reply([{ id: 'b', category: 'Framing', budget: '10.10', actual: '0.10', committed: '1.00' }]);
    if (path === `/projects/${id}/variations`) return reply([{ id: 'v', description: 'Fictional variation', cost_change: '0.10', margin: '0.20', total: '0.30', status: 'Approved' }]);
    if (path === `/projects/${id}/subcontractors`) return reply([{ id: 's', company: 'Fictional Trade', trade: 'Framing', allowance: '10.00', committed: '1.10', paid: '0.10', status: 'Active' }]);
    if (path === `/projects/${id}/claims`) return reply([{ id: 'c', claim_no: 'C-1', amount: '999999999999999999.99', status: 'Paid', date: '2026-01-02T00:15:00.123456+11:00', paid_date: '2026-01-03T23:45:00.654321-05:00' }]);
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal('fetch', network);
});
afterEach(() => { clearSession(); vi.unstubAllGlobals(); });
function open(suffix) { render(<MemoryRouter initialEntries={[`/projects/${id}${suffix}`]}><App /></MemoryRouter>); }
async function loaded(suffix) {
  if (['/budget', '/variations', '/subcontractors', '/claims'].includes(suffix)) await screen.findByRole('table');
  else await screen.findByText('Fictional Integration House');
}


it.each(modules)('navigates directly from %s through every module without backtracking', async (_label, suffix) => {
  open(suffix); await loaded(suffix);
  for (const [name, target] of modules) {
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Project modules' })).getByRole('link', { name }));
    await loaded(target);
    expect(within(screen.getByRole('navigation', { name: 'Project modules' })).getByRole('link', { current: 'page' })).toHaveTextContent(name);
  }
  for (const [, options] of network.mock.calls.filter(([path]) => path.startsWith('/projects/'))) {
    expect(options.method).toBe('GET');
    expect(options.headers.get('Authorization')).toBe('Bearer integration-token');
  }
});

it.each(modules)('hides writes on %s with missing capabilities even for system Admin/project Manager', async (_label, suffix) => {
  open(suffix); await loaded(suffix);
  expect(screen.queryByRole('button', { name: /new|create|edit|archive|save/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
});

it.each(modules)('hides writes on %s with false capabilities even for system Admin/project Manager', async (_label, suffix) => {
  capabilities = Object.fromEntries(['can_manage_project', 'can_archive_project', 'can_create_variations', 'can_update_variations', 'can_create_subcontractors', 'can_update_subcontractors', 'can_create_claims', 'can_update_claims'].map((key) => [key, false]));
  open(suffix); await loaded(suffix);
  expect(screen.queryByRole('button', { name: /new|create|edit|archive|save/i })).not.toBeInTheDocument();
});

it.each(modules)('protects unauthenticated direct %s access without fetching project data', async (_label, suffix) => {
  authenticated = false; open(suffix);
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(screen.queryByRole('navigation', { name: 'Project modules' })).not.toBeInTheDocument();
  expect(network.mock.calls.filter(([path]) => path.startsWith('/projects'))).toHaveLength(0);
});

it('waits for authentication before fetching a nested route', async () => {
  let release;
  const original = network.getMockImplementation();
  network.mockImplementation((path, options) => path === '/auth/refresh' ? new Promise((resolve) => { release = resolve; }) : original(path, options));
  open('/claims');
  await waitFor(() => expect(release).toBeTypeOf('function'));
  expect(network.mock.calls.filter(([path]) => path.startsWith('/projects'))).toHaveLength(0);
  release(reply({ access_token: 'integration-token' }));
  await loaded('/claims');
});

it('preserves exact claim datetimes and large money while navigating to authoritative nonzero dashboard totals', async () => {
  open('/claims'); await loaded('/claims');
  expect(screen.getByText('2026-01-02T00:15:00.123456+11:00')).toBeVisible();
  expect(screen.getByText('2026-01-03T23:45:00.654321-05:00')).toBeVisible();
  expect(screen.getByText('A$999,999,999,999,999,999.99')).toBeVisible();
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Project modules' })).getByRole('link', { name: 'Dashboard' }));
  await loaded('/dashboard');
  for (const [label, amount] of [['Approved variations total', 'A$0.30'], ['Revised contract value', 'A$1,000,000,000,000,000,000.29'], ['Budget remaining', 'A$10.00'], ['Subcontractor outstanding', 'A$1.00'], ['Claims paid', 'A$999,999,999,999,999,999.99']]) {
    expect(screen.getByText(label, { selector: 'dt' }).nextElementSibling.textContent).toBe(amount);
  }
});

it.each(modules)('retains navigation during %s loading and server errors', async (_label, suffix) => {
  let release;
  const original = network.getMockImplementation();
  network.mockImplementation((path, options) => path === `/projects/${id}${suffix}` ? new Promise((resolve) => { release = resolve; }) : original(path, options));
  open(suffix);
  await waitFor(() => expect(release).toBeTypeOf('function'));
  expect(screen.getByRole('navigation', { name: 'Project modules' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  release(reply({ detail: 'Temporary outage' }, 503));
  expect(await screen.findByRole('alert')).toHaveTextContent('Temporary outage');
  expect(screen.getByRole('navigation', { name: 'Project modules' })).toBeVisible();
  network.mockImplementation(original);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await loaded(suffix);
});

it.each(modules)('shows consistent access denial on %s and can retry', async (_label, suffix) => {
  failure = 403; open(suffix);
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied. You do not have permission to view this project.');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Project modules' })).toBeVisible();
  failure = 0; fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await loaded(suffix);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it.each(modules)('provides all module links on direct %s access, with exactly one current page', async (label, suffix) => {
  open(suffix); await loaded(suffix);
  const nav = within(screen.getByRole('navigation', { name: 'Project modules' }));
  expect(nav.getAllByRole('link')).toHaveLength(modules.length);
  for (const [name, target] of modules) expect(nav.getByRole('link', { name })).toHaveAttribute('href', `/projects/${id}${target}`);
  expect(nav.getAllByRole('link', { current: 'page' })).toEqual([nav.getByRole('link', { name: label })]);
});
