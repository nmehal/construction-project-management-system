import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import App from '../App.jsx';
import { clearSession } from '../api/client.js';
const id = 'project-one';
const base = `/projects/${id}/subcontractors`;
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
let rows, capabilities, network, failure, writeFailure;
beforeEach(() => {
  clearSession(); failure = 0; writeFailure = 0;
  capabilities = { can_create_subcontractors: true, can_update_subcontractors: true };
  rows = [{ id: 'sub-one', project_id: id, company: 'Fictional Ballarat Plumbing', trade: 'Plumbing', scope: 'Bathroom plumbing', allowance: '1000.10', committed: '100.30', paid: '100.10', status: 'active' }];
  network = vi.fn(async (path, options) => {
    if (path === '/auth/refresh') return reply({ access_token: 'access' });
    if (path === '/auth/me') return reply({ id: 'user', email: 'builder@example.com', system_role: 'Admin' });
    if (path === `/projects/${id}`) return reply({ id, name: 'Fictional Ballarat House', contract_value: '1000.00', project_role: 'Viewer', capabilities });
    if (path === base && options.method === 'GET') return failure ? reply({ detail: 'Unavailable' }, failure) : reply(rows);
    if (path === base && options.method === 'POST') {
      if (writeFailure) return reply({ detail: 'Invalid subcontractor' }, writeFailure);
      rows = [...rows, { ...JSON.parse(options.body), id: 'new', project_id: id }];
      return reply(rows.at(-1));
    }
    if (path === `${base}/sub-one` && options.method === 'PATCH') {
      if (writeFailure) return reply({ detail: 'Update denied' }, writeFailure);
      rows = [{ ...rows[0], ...JSON.parse(options.body) }]; return reply(rows[0]);
    }
    if (path === `${base}/sub-one` && options.method === 'GET') return reply(rows[0]);
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal('fetch', network);
});
afterEach(() => { clearSession(); vi.unstubAllGlobals(); });
function open(path = base) { render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); }
const writes = (method) => network.mock.calls.filter(([path, opts]) => path.startsWith(base) && opts.method === method);
it('renders backend fields, exact AUD and outstanding with authentication', async () => {
  open(); const row = await screen.findByRole('row', { name: /Fictional Ballarat Plumbing/ });
  for (const text of ['Plumbing', 'Bathroom plumbing', 'A$1,000.10', 'A$100.30', 'A$100.10', 'A$0.20', 'active']) expect(within(row).getByText(text)).toBeVisible();
  expect(network.mock.calls.find(([path]) => path === base)[1].headers.get('Authorization')).toBe('Bearer access');
});

async function createForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'New subcontractor' }));
  for (const [label, value] of [['Company', 'Fictional Bendigo Electrical'], ['Trade', 'Electrical'], ['Scope', 'Kitchen wiring'], ['Allowance (AUD)', '1234.50'], ['Committed (AUD)', '100.30'], ['Paid (AUD)', '0.20']]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
it('creates using only exact writable backend fields, including scope', async () => {
  open(); await createForm();
  expect(screen.queryByLabelText(/outstanding/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create subcontractor' }));
  expect(await screen.findByRole('row', { name: /Fictional Bendigo Electrical/ })).toBeVisible();
  expect(JSON.parse(writes('POST')[0][1].body)).toEqual({ company: 'Fictional Bendigo Electrical', trade: 'Electrical', scope: 'Kitchen wiring', allowance: '1234.50', committed: '100.30', paid: '0.20', status: 'active' });
});

it('PATCH sends only changed paid and refreshes authoritative data', async () => {
  open(); fireEvent.click(await screen.findByRole('button', { name: 'Edit Fictional Ballarat Plumbing' }));
  fireEvent.change(screen.getByLabelText('Paid (AUD)'), { target: { value: '0.20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('A$100.10', { selector: 'td' })).toBeVisible();
  await screen.findByText('Subcontractor saved.');
  expect(JSON.parse(writes('PATCH')[0][1].body)).toEqual({ paid: '0.20' });
  expect(within(screen.getByRole('row', { name: /Fictional Ballarat Plumbing/ })).getByText('A$0.20')).toBeVisible();
});

it('links project detail to Subcontractors', async () => {
  open(`/projects/${id}`); const link = await screen.findByRole('link', { name: 'Subcontractors' });
  expect(link).toHaveAttribute('href', base); fireEvent.click(link);
  expect(await screen.findByText('Fictional Ballarat Plumbing')).toBeVisible();
});
it('supports the read-one endpoint', async () => {
  const api = await import('../api/subcontractors.js');
  expect(api.getSubcontractor).toBeTypeOf('function');
  expect(await api.getSubcontractor(id, 'sub-one')).toEqual(rows[0]);
  expect(network.mock.calls[0][0]).toBe(`${base}/sub-one`);
});

it('shows empty state', async () => {
  rows = []; open(); expect(await screen.findByText('No subcontractors are available for this project.')).toBeVisible();
});
it('shows list error and retries', async () => {
  failure = 500; open(); expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
  failure = 0; fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Fictional Ballarat Plumbing')).toBeVisible();
});
it('shows create validation error and retains inputs', async () => {
  writeFailure = 422; open(); await createForm();
  fireEvent.click(screen.getByRole('button', { name: 'Create subcontractor' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid subcontractor');
  expect(screen.getByLabelText('Company')).toHaveValue('Fictional Bendigo Electrical');
});
it('hides create without capability, even for system Admin', async () => {
  capabilities.can_create_subcontractors = false; open(); await screen.findByText('Fictional Ballarat Plumbing');
  expect(screen.queryByRole('button', { name: 'New subcontractor' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Edit Fictional Ballarat Plumbing' })).toBeVisible();
});
it('hides edit independently of create capability', async () => {
  capabilities.can_update_subcontractors = false; open(); await screen.findByText('Fictional Ballarat Plumbing');
  expect(screen.queryByRole('button', { name: 'Edit Fictional Ballarat Plumbing' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'New subcontractor' })).toBeVisible();
});
it('denies controls when capabilities are missing', async () => {
  capabilities = {}; open(); await screen.findByText('Fictional Ballarat Plumbing');
  expect(screen.queryByRole('button', { name: /New subcontractor|Edit Fictional/ })).not.toBeInTheDocument();
});
it('shows list 403 without create controls', async () => {
  failure = 403; open(); expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  expect(screen.queryByRole('button', { name: 'New subcontractor' })).not.toBeInTheDocument();
});
it.each(['create', 'edit'])('shows authoritative %s 403 and keeps form open', async (mode) => {
  writeFailure = 403; open();
  if (mode === 'create') await createForm();
  else {
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Fictional Ballarat Plumbing' }));
    fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'Revised fictional scope' } });
  }
  fireEvent.click(screen.getByRole('button', { name: mode === 'create' ? 'Create subcontractor' : 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  expect(screen.getByRole('form')).toBeVisible();
});
it('rejects invalid money without posting', async () => {
  open(); await createForm();
  fireEvent.change(screen.getByLabelText('Allowance (AUD)'), { target: { value: '1.234' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create subcontractor' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('two decimal places');
  expect(writes('POST')).toHaveLength(0);
});
it('does not PATCH unchanged or equivalent decimal values', async () => {
  rows[0].paid = '100.1'; open();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Fictional Ballarat Plumbing' }));
  fireEvent.change(screen.getByLabelText('Paid (AUD)'), { target: { value: '100.10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('No changes to save.')).toBeVisible(); expect(writes('PATCH')).toHaveLength(0);
});
it('allows backend free-text status and clearing scope with a partial PATCH', async () => {
  open(); fireEvent.click(await screen.findByRole('button', { name: 'Edit Fictional Ballarat Plumbing' }));
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'on hold' } });
  fireEvent.change(screen.getByLabelText('Scope'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('cell', { name: 'on hold' })).toBeVisible();
  expect(JSON.parse(writes('PATCH')[0][1].body)).toEqual({ status: 'on hold', scope: '' });
});
it('shows loading until list resolves', async () => {
  let release; const original = network.getMockImplementation();
  network.mockImplementation((path, opts) => path === base ? new Promise((resolve) => { release = resolve; }) : original(path, opts));
  open(); expect(await screen.findByText('Loading subcontractors…')).toBeVisible();
  await waitFor(() => expect(release).toBeTypeOf('function'));
  release(reply(rows)); expect(await screen.findByText('Fictional Ballarat Plumbing')).toBeVisible();
});
it('protects direct navigation when refresh is unavailable', async () => {
  const original = network.getMockImplementation();
  network.mockImplementation((path, opts) => path === '/auth/refresh' ? reply({ detail: 'Expired' }, 401) : original(path, opts));
  open(); expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(network.mock.calls.filter(([path]) => path.startsWith('/projects'))).toHaveLength(0);
});
it('preserves very large amounts and negative outstanding exactly', async () => {
  rows[0].allowance = '999999999999999999.99'; rows[0].paid = '100.50'; open();
  const row = await screen.findByRole('row', { name: /Fictional Ballarat Plumbing/ });
  expect(within(row).getByText('A$999,999,999,999,999,999.99')).toBeVisible();
  expect(within(row).getByText('-A$0.20')).toBeVisible();
});
