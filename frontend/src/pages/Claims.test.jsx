import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import App from '../App.jsx';
import { clearSession } from '../api/client.js';
const id = 'project-one';
const base = `/projects/${id}/claims`;
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
let rows, capabilities, network, failure, writeFailure;
beforeEach(() => {
  clearSession(); failure = 0; writeFailure = 0;
  capabilities = { can_create_claims: true, can_update_claims: true };
  rows = [{ id: 'claim-one', project_id: id, claim_no: 'CL-001', stage: 'Fictional Ballarat framing', date: '2026-10-23T00:30:00+11:00', amount: '1000.10', status: 'Issued', paid_date: null }];
  network = vi.fn(async (path, options) => {
    if (path === '/auth/refresh') return reply({ access_token: 'access' });
    if (path === '/auth/me') return reply({ id: 'user', email: 'builder@example.com', system_role: 'Admin' });
    if (path === `/projects/${id}`) return reply({ id, name: 'Fictional Ballarat House', contract_value: '1000.00', project_role: 'Viewer', capabilities });
    if (path === base && options.method === 'GET') return failure ? reply({ detail: 'Unavailable' }, failure) : reply(rows);
    if (path === base && options.method === 'POST') {
      if (writeFailure) return reply({ detail: 'Invalid claim' }, writeFailure);
      rows = [...rows, { ...JSON.parse(options.body), id: 'new', project_id: id }];
      return reply(rows.at(-1));
    }
    if (path === `${base}/claim-one` && options.method === 'PATCH') {
      if (writeFailure) return reply({ detail: 'Update denied' }, writeFailure);
      const changes = JSON.parse(options.body);
      rows = [{ ...rows[0], ...changes }];
      if (changes.status === 'Paid' && !rows[0].paid_date) rows[0].paid_date = '2026-10-24T01:00:00Z';
      return reply(rows[0]);
    }
    if (path === `${base}/claim-one` && options.method === 'GET') return reply(rows[0]);
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal('fetch', network);
});
afterEach(() => { clearSession(); vi.unstubAllGlobals(); });
function open(path = base) { render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); }
const writes = (method) => network.mock.calls.filter(([path, opts]) => path.startsWith(base) && opts.method === method);
it('renders exact claim fields, money and original datetime without timezone shifts', async () => {
  open(); const row = await screen.findByRole('row', { name: /CL-001/ });
  for (const text of ['Fictional Ballarat framing', 'A$1,000.10', 'Issued', '2026-10-23T00:30:00+11:00', 'Not provided']) expect(within(row).getByText(text)).toBeVisible();
  expect(network.mock.calls.find(([path]) => path === base)[1].headers.get('Authorization')).toBe('Bearer access');
  expect(screen.queryByText(/due date|issued date/i)).not.toBeInTheDocument();
});

async function createForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'New claim' }));
  for (const [label, value] of [['Claim number', 'CL-002'], ['Stage', 'Fictional Bendigo fit-out'], ['Amount (AUD)', '1234.50'], ['Claim date (ISO datetime)', '2026-10-25T00:30:00+11:00']]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
it('creates exact backend fields without read-only fields or datetime conversion', async () => {
  open(); await createForm();
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Draft', 'Issued', 'Paid', 'Overdue']);
  fireEvent.click(screen.getByRole('button', { name: 'Create claim' }));
  const row = await screen.findByRole('row', { name: /CL-002/ });
  expect(within(row).getByText('2026-10-25T00:30:00+11:00')).toBeVisible();
  expect(JSON.parse(writes('POST')[0][1].body)).toEqual({ claim_no: 'CL-002', stage: 'Fictional Bendigo fit-out', date: '2026-10-25T00:30:00+11:00', amount: '1234.50', status: 'Draft' });
});

it('sends only changed amount and preserves original datetime fields', async () => {
  rows[0].paid_date = '2026-10-23T23:30:45.123456-07:00';
  open(); fireEvent.click(await screen.findByRole('button', { name: 'Edit CL-001' }));
  expect(screen.getByLabelText('Claim date (ISO datetime)')).toHaveValue(rows[0].date);
  expect(screen.getByLabelText('Paid date (ISO datetime)')).toHaveValue(rows[0].paid_date);
  fireEvent.change(screen.getByLabelText('Amount (AUD)'), { target: { value: '2345.67' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('A$2,345.67')).toBeVisible();
  expect(JSON.parse(writes('PATCH')[0][1].body)).toEqual({ amount: '2345.67' });
  expect(screen.getByText('2026-10-23T23:30:45.123456-07:00')).toBeVisible();
});

it('links project detail to Claims', async () => {
  open(`/projects/${id}`); const link = await screen.findByRole('link', { name: 'Claims' });
  expect(link).toHaveAttribute('href', base); fireEvent.click(link);
  expect(await screen.findByText('CL-001')).toBeVisible();
});
it('supports the read-one endpoint', async () => {
  const api = await import('../api/claims.js');
  expect(api.getClaim).toBeTypeOf('function');
  expect(await api.getClaim(id, 'claim-one')).toEqual(rows[0]);
  expect(network.mock.calls[0][0]).toBe(`${base}/claim-one`);
});

it('shows empty state', async () => {
  rows = []; open(); expect(await screen.findByText('No claims are available for this project.')).toBeVisible();
});
it('shows list error and retries', async () => {
  failure = 500; open(); expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
  failure = 0; fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('CL-001')).toBeVisible();
});
it('shows create validation error and retains inputs', async () => {
  writeFailure = 422; open(); await createForm();
  fireEvent.click(screen.getByRole('button', { name: 'Create claim' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid claim');
  expect(screen.getByLabelText('Claim number')).toHaveValue('CL-002');
});
it('hides create without capability even for Admin', async () => {
  capabilities.can_create_claims = false; open(); await screen.findByText('CL-001');
  expect(screen.queryByRole('button', { name: 'New claim' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Edit CL-001' })).toBeVisible();
});
it('hides edit independently of create capability', async () => {
  capabilities.can_update_claims = false; open(); await screen.findByText('CL-001');
  expect(screen.queryByRole('button', { name: 'Edit CL-001' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'New claim' })).toBeVisible();
});
it('hides write controls when capabilities are missing', async () => {
  capabilities = {}; open(); await screen.findByText('CL-001');
  expect(screen.queryByRole('button', { name: /New claim|Edit CL/ })).not.toBeInTheDocument();
});
it('shows list 403 without write controls', async () => {
  failure = 403; open(); expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  expect(screen.queryByRole('button', { name: 'New claim' })).not.toBeInTheDocument();
});
it.each(['create', 'edit'])('shows %s 403 and keeps form open', async (mode) => {
  writeFailure = 403; open();
  if (mode === 'create') await createForm();
  else {
    fireEvent.click(await screen.findByRole('button', { name: 'Edit CL-001' }));
    fireEvent.change(screen.getByLabelText('Stage'), { target: { value: 'Revised fictional stage' } });
  }
  fireEvent.click(screen.getByRole('button', { name: mode === 'create' ? 'Create claim' : 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied'); expect(screen.getByRole('form')).toBeVisible();
});
it('rejects invalid money without posting', async () => {
  open(); await createForm();
  fireEvent.change(screen.getByLabelText('Amount (AUD)'), { target: { value: '1.234' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create claim' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('two decimal places'); expect(writes('POST')).toHaveLength(0);
});
it('does not PATCH unchanged or equivalent money values', async () => {
  rows[0].amount = '1000.1'; open(); fireEvent.click(await screen.findByRole('button', { name: 'Edit CL-001' }));
  fireEvent.change(screen.getByLabelText('Amount (AUD)'), { target: { value: '1000.10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('No changes to save.')).toBeVisible(); expect(writes('PATCH')).toHaveLength(0);
});
it.each(['Draft', 'Issued', 'Paid', 'Overdue'])('displays backend status %s exactly', async (status) => {
  rows[0].status = status; open(); expect(await screen.findByRole('cell', { name: status })).toBeVisible();
});
it('leaves paid timestamp generation to the backend for status-only PATCH', async () => {
  open(); fireEvent.click(await screen.findByRole('button', { name: 'Edit CL-001' }));
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Paid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('2026-10-24T01:00:00Z')).toBeVisible();
  expect(JSON.parse(writes('PATCH')[0][1].body)).toEqual({ status: 'Paid' });
});
it('submits an explicit paid datetime even without a status change', async () => {
  open(); fireEvent.click(await screen.findByRole('button', { name: 'Edit CL-001' }));
  fireEvent.change(screen.getByLabelText('Paid date (ISO datetime)'), { target: { value: '2026-10-24T23:59:12.123456-07:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('2026-10-24T23:59:12.123456-07:00')).toBeVisible();
  expect(JSON.parse(writes('PATCH')[0][1].body)).toEqual({ paid_date: '2026-10-24T23:59:12.123456-07:00' });
});
it('preserves an existing paid date when changing status', async () => {
  rows[0].paid_date = '2026-10-22T02:00:00Z'; open();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit CL-001' }));
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Paid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Claim saved.');
  expect(screen.getByText('2026-10-22T02:00:00Z')).toBeVisible();
  expect(JSON.parse(writes('PATCH')[0][1].body)).toEqual({ status: 'Paid' });
});
it('explains that backend does not support clearing existing paid dates', async () => {
  rows[0].paid_date = '2026-10-22T02:00:00Z'; open();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit CL-001' }));
  fireEvent.change(screen.getByLabelText('Paid date (ISO datetime)'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('does not support clearing'); expect(writes('PATCH')).toHaveLength(0);
});
it('sends explicit paid date on creation without imposing a Paid-only rule', async () => {
  open(); await createForm();
  fireEvent.change(screen.getByLabelText('Paid date (ISO datetime)'), { target: { value: '2026-10-25T09:00:00+11:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create claim' }));
  await screen.findByText('CL-002');
  const payload = JSON.parse(writes('POST')[0][1].body);
  expect(payload.paid_date).toBe('2026-10-25T09:00:00+11:00'); expect(payload.status).toBe('Draft');
});
it('passes naive API datetimes through unchanged on edit', async () => {
  rows[0].date = '2026-10-23T00:30:00'; open();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit CL-001' }));
  expect(screen.getByLabelText('Claim date (ISO datetime)')).toHaveValue('2026-10-23T00:30:00');
  fireEvent.change(screen.getByLabelText('Claim date (ISO datetime)'), { target: { value: '2026-10-24T00:30:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('2026-10-24T00:30:00')).toBeVisible();
  expect(JSON.parse(writes('PATCH')[0][1].body)).toEqual({ date: '2026-10-24T00:30:00' });
});
it('shows loading while the list is pending', async () => {
  let release; const original = network.getMockImplementation();
  network.mockImplementation((path, opts) => path === base ? new Promise((resolve) => { release = resolve; }) : original(path, opts));
  open(); expect(await screen.findByText('Loading claims…')).toBeVisible();
  await waitFor(() => expect(release).toBeTypeOf('function')); release(reply(rows));
  expect(await screen.findByText('CL-001')).toBeVisible();
});
it('protects direct navigation when refresh is unavailable', async () => {
  const original = network.getMockImplementation();
  network.mockImplementation((path, opts) => path === '/auth/refresh' ? reply({ detail: 'Expired' }, 401) : original(path, opts));
  open(); expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(network.mock.calls.filter(([path]) => path.startsWith('/projects'))).toHaveLength(0);
});
