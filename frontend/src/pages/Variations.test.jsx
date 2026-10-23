import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import App from '../App.jsx';
import { clearSession } from '../api/client.js';
import { getVariation } from '../api/variations.js';

const id = 'project-one';
const base = `/projects/${id}/variations`;
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
let rows, capabilities, network, failure, writeFailure;
beforeEach(() => {
  clearSession(); failure = 0; writeFailure = 0;
  capabilities = { can_create_variations: true, can_update_variations: true };
  rows = [{ id: 'variation-one', description: 'Fictional verandah', requested_by: 'Fictional Owner', cost_change: '100.10', margin: '0.20', total: '100.30', status: 'Draft' }];
  network = vi.fn(async (path, options) => {
    if (path === '/auth/refresh') return reply({ access_token: 'access' });
    // System Admin does NOT override a false capability in the UI.
    if (path === '/auth/me') return reply({ id: 'user', email: 'builder@example.com', system_role: 'Admin' });
    if (path === `/projects/${id}`) return reply({ id, name: 'Fictional Ballarat House', contract_value: '1000.00', project_role: 'Contributor', capabilities });
    if (path === base && options.method === 'GET') return failure ? reply({ detail: 'Unavailable' }, failure) : reply(rows);
    if (path === base && options.method === 'POST') {
      if (writeFailure) return reply({ detail: 'Invalid variation' }, writeFailure);
      const data = JSON.parse(options.body);
      rows = [...rows, { ...data, id: 'new', total: '100.30' }];
      return reply(rows.at(-1));
    }
    if (path === `${base}/variation-one` && options.method === 'PATCH') {
      if (writeFailure) return reply({ detail: 'Update denied' }, writeFailure);
      rows = [{ ...rows[0], ...JSON.parse(options.body), total: '200.30' }];
      return reply(rows[0]);
    }
    if (path === `${base}/variation-one`) return reply(rows[0]);
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal('fetch', network);
});
afterEach(() => { clearSession(); vi.unstubAllGlobals(); });
function open(path = base) { render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); }
const writes = (method) => network.mock.calls.filter(([path, opts]) => path.startsWith(base) && opts.method === method);
async function createForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'New variation' }));
  for (const [label, value] of [['Description', 'Fictional extra framing'], ['Requested by', 'Fictional Owner'], ['Cost change (AUD)', '100.10'], ['Margin (AUD)', '0.20']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}
it('renders list, exact money, requester and status with bearer authentication', async () => {
  open(); const row = await screen.findByRole('row', { name: /Fictional verandah/ });
  for (const text of ['Fictional Owner', 'A$100.10', 'A$0.20', 'A$100.30', 'Draft']) expect(within(row).getByText(text)).toBeVisible();
  expect(network.mock.calls.find(([path]) => path === base)[1].headers.get('Authorization')).toBe('Bearer access');
});
it('shows empty state', async () => {
  rows = []; open(); expect(await screen.findByText('No variations are available for this project.')).toBeVisible();
});
it('shows error and retries', async () => {
  failure = 500; open(); expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
  failure = 0; fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Fictional verandah')).toBeVisible();
});
it('creates without a total field and displays server total', async () => {
  open(); await createForm();
  expect(screen.queryByLabelText(/total/i)).not.toBeInTheDocument();
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Draft', 'Submitted', 'Pending', 'Approved', 'Rejected']);
  fireEvent.click(screen.getByRole('button', { name: 'Create variation' }));
  const row = await screen.findByRole('row', { name: /Fictional extra framing/ });
  expect(within(row).getByText('A$100.30')).toBeVisible();
  expect(JSON.parse(writes('POST')[0][1].body)).toEqual({ description: 'Fictional extra framing', requested_by: 'Fictional Owner', cost_change: '100.10', margin: '0.20', status: 'Draft' });
});
it('shows create backend validation error and keeps inputs', async () => {
  writeFailure = 422; open(); await createForm();
  fireEvent.click(screen.getByRole('button', { name: 'Create variation' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid variation');
  expect(screen.getByLabelText('Description')).toHaveValue('Fictional extra framing');
});
it('rejects invalid money without submitting', async () => {
  open(); await createForm();
  fireEvent.change(screen.getByLabelText('Cost change (AUD)'), { target: { value: '1.234' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create variation' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('two decimal places');
  expect(writes('POST')).toHaveLength(0);
});
it('hides create independently of update capability, even for Admin', async () => {
  capabilities.can_create_variations = false; open(); await screen.findByText('Fictional verandah');
  expect(screen.queryByRole('button', { name: 'New variation' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Edit Fictional verandah' })).toBeVisible();
});
it('hides edits independently of create capability', async () => {
  capabilities.can_update_variations = false; open(); await screen.findByText('Fictional verandah');
  expect(screen.queryByRole('button', { name: 'Edit Fictional verandah' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'New variation' })).toBeVisible();
});
it('sends only changed cost in PATCH and displays backend-recalculated total', async () => {
  open(); fireEvent.click(await screen.findByRole('button', { name: 'Edit Fictional verandah' }));
  fireEvent.change(screen.getByLabelText('Cost change (AUD)'), { target: { value: '200.10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('A$200.30')).toBeVisible();
  expect(JSON.parse(writes('PATCH')[0][1].body)).toEqual({ cost_change: '200.10' });
  expect(screen.getByText('A$0.20')).toBeVisible();
});
it('permits status-only PATCH', async () => {
  open(); fireEvent.click(await screen.findByRole('button', { name: 'Edit Fictional verandah' }));
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Approved' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('cell', { name: 'Approved' })).toBeVisible();
  expect(JSON.parse(writes('PATCH')[0][1].body)).toEqual({ status: 'Approved' });
});
it('does not send an unchanged edit', async () => {
  open(); fireEvent.click(await screen.findByRole('button', { name: 'Edit Fictional verandah' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('No changes to save.')).toBeVisible();
  expect(writes('PATCH')).toHaveLength(0);
});
it('shows authoritative list 403', async () => {
  failure = 403; open(); expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  expect(screen.queryByRole('button', { name: 'New variation' })).not.toBeInTheDocument();
});
it('shows authoritative write 403 without closing the form', async () => {
  writeFailure = 403; open(); await createForm();
  fireEvent.click(screen.getByRole('button', { name: 'Create variation' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  expect(screen.getByRole('form', { name: 'Create variation' })).toBeVisible();
});
it('links project detail to protected Variations page', async () => {
  open(`/projects/${id}`);
  const link = await screen.findByRole('link', { name: 'Variations' });
  expect(link).toHaveAttribute('href', base); fireEvent.click(link);
  expect(await screen.findByText('Fictional verandah')).toBeVisible();
});
it('supports the read-one API using the same client', async () => {
  expect(await getVariation(id, 'variation-one')).toEqual(rows[0]);
  expect(network.mock.calls[0][0]).toBe(`${base}/variation-one`);
});
it('shows loading while waiting for list data', async () => {
  let release;
  const original = network.getMockImplementation();
  network.mockImplementation((path, opts) => path === base ? new Promise((resolve) => { release = resolve; }) : original(path, opts));
  open(); expect(await screen.findByText('Loading variations…')).toBeVisible();
  await waitFor(() => expect(release).toBeTypeOf('function'));
  release(reply(rows)); expect(await screen.findByText('Fictional verandah')).toBeVisible();
});
