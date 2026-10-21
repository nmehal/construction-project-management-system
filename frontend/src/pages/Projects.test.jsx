import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.jsx';
import { clearSession } from '../api/client.js';

const initial = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Fictional Banksia Renovation',
  client: 'Fictional Household', suburb: 'Ballarat', contract_value: '250000.10',
  status: 'Active', is_archived: false, project_role: 'Contributor',
  capabilities: { can_read: true, can_manage_project: true, can_archive_project: true },
};
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
let project, systemRole, network, listError, writeError, empty;
beforeEach(() => {
  clearSession();
  project = structuredClone(initial);
  systemRole = 'Admin'; listError = false; writeError = false; empty = false;
  network = vi.fn(async (path, options) => {
    if (path === '/auth/refresh') return reply({ access_token: 'test-token' });
    if (path === '/auth/me') return reply({ id: 'user', email: 'builder@example.com', system_role: systemRole });
    if (path === '/projects' && options.method === 'POST') {
      if (writeError) return reply({ detail: [{ msg: 'Invalid project details' }] }, 422);
      project = { ...project, ...JSON.parse(options.body) }; return reply(project);
    }
    if (path === '/projects' || path === '/projects?include_archived=true') {
      if (listError) return reply({ detail: 'Projects unavailable' }, 503);
      return reply(empty || (project.is_archived && !path.includes('?')) ? [] : [project]);
    }
    if (path === `/projects/${project.id}/archive`) {
      if (writeError) return reply({ detail: 'Archive denied' }, 403);
      project = { ...project, is_archived: true }; return reply(project);
    }
    if (path === `/projects/${project.id}`) {
      if (options.method === 'PATCH') {
        if (writeError) return reply({ detail: 'Edit denied' }, 403);
        project = { ...project, ...JSON.parse(options.body) };
      }
      return reply(project);
    }
    throw new Error(`Unexpected request: ${options.method} ${path}`);
  });
  vi.stubGlobal('fetch', network);
});
afterEach(() => { clearSession(); vi.unstubAllGlobals(); });
function open(path = '/projects') { return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); }
const writes = (method) => network.mock.calls.filter(([path, options]) => path.startsWith('/projects') && options.method === method);
async function detail() { open(`/projects/${project.id}`); return screen.findByRole('heading', { name: project.name }); }
async function fillCreate() {
  await screen.findByRole('form', { name: 'Create project' });
  for (const [label, value] of [['Project name', 'Fictional Wattle House'], ['Client', 'Fictional Client'], ['Suburb', 'Bendigo'], ['Contract value (AUD)', '100000.20']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

describe('Projects frontend', () => {
  it('renders accessible projects, exact AUD display, API role and detail link', async () => {
    open();
    const link = await screen.findByRole('link', { name: project.name });
    expect(link).toHaveAttribute('href', `/projects/${project.id}`);
    expect(screen.getByText(project.client)).toBeVisible();
    expect(screen.getByText(project.suburb)).toBeVisible();
    expect(screen.getByText('A$250,000.10')).toBeVisible();
    expect(screen.getByText('Contributor')).toBeVisible();
    expect(screen.getByText('Not archived')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
    const call = network.mock.calls.find(([path]) => path === '/projects');
    expect(call[1].headers.get('Authorization')).toBe('Bearer test-token');
  });

  it('shows an empty list message', async () => {
    empty = true; open();
    expect(await screen.findByText('No projects found. Archived projects are hidden.')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows API errors and retries successfully', async () => {
    listError = true; open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Projects unavailable');
    listError = false; fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: project.name })).toBeVisible();
  });

  it('requests archived projects only when the toggle is checked', async () => {
    project.is_archived = true; open();
    await screen.findByText('No projects found. Archived projects are hidden.');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived projects' }));
    expect(await screen.findByRole('link', { name: project.name })).toBeVisible();
    expect(screen.getByText('Archived')).toBeVisible();
    expect(network.mock.calls.some(([path]) => path === '/projects?include_archived=true')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    await screen.findByText('No projects found. Archived projects are hidden.');
  });

  it('renders project detail and API capability summary', async () => {
    await detail();
    expect(screen.getByText('A$250,000.10')).toBeVisible();
    expect(screen.getByText('Contributor')).toBeVisible();
    expect(screen.getByText(/Project access: Can edit project/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to projects' })).toHaveAttribute('href', '/projects');
  });

  it.each(['Admin', 'Project Manager'])('creates a project as %s with string money and navigates to detail', async (role) => {
    systemRole = role; open('/projects/new'); await fillCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByRole('heading', { name: 'Fictional Wattle House' })).toBeVisible();
    expect(JSON.parse(writes('POST')[0][1].body)).toEqual({ name: 'Fictional Wattle House', client: 'Fictional Client', suburb: 'Bendigo', contract_value: '100000.20' });
  });

  it('reports client money validation without sending a create request', async () => {
    open('/projects/new'); await fillCreate();
    fireEvent.change(screen.getByLabelText('Contract value (AUD)'), { target: { value: '100.001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('up to two decimal places');
    expect(writes('POST')).toHaveLength(0);
  });

  it('shows backend create validation errors and preserves input', async () => {
    writeError = true; open('/projects/new'); await fillCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid project details');
    expect(screen.getByLabelText('Project name')).toHaveValue('Fictional Wattle House');
    expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled();
  });

  it('hides creation from system Viewer even with project management capabilities', async () => {
    systemRole = 'Viewer'; open();
    await screen.findByRole('link', { name: project.name });
    expect(screen.queryByRole('link', { name: 'New project' })).not.toBeInTheDocument();
  });

  it('guards direct access to create for a system Viewer', async () => {
    systemRole = 'Viewer'; open('/projects/new');
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot create projects');
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(writes('POST')).toHaveLength(0);
  });

  it('sends only changed fields in a partial edit and updates detail', async () => {
    systemRole = 'Viewer'; project.project_role = 'Manager';
    await detail();
    fireEvent.click(screen.getByRole('button', { name: 'Edit project' }));
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Fictional Revised Name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('heading', { name: 'Fictional Revised Name' })).toBeVisible();
    expect(JSON.parse(writes('PATCH')[0][1].body)).toEqual({ name: 'Fictional Revised Name' });
    expect(screen.getByText('A$250,000.10')).toBeVisible();
  });

  it('avoids PATCH when no fields changed including equivalent decimal strings', async () => {
    await detail(); fireEvent.click(screen.getByRole('button', { name: 'Edit project' }));
    fireEvent.change(screen.getByLabelText('Contract value (AUD)'), { target: { value: '250000.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('status')).toHaveTextContent('No changes to save.');
    expect(writes('PATCH')).toHaveLength(0);
  });

  it('hides edit and archive when capabilities deny them even for system Admin', async () => {
    project.project_role = 'Viewer';
    project.capabilities = { can_read: true, can_manage_project: false, can_archive_project: false };
    await detail();
    expect(screen.getByText('Viewer')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Edit project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive project' })).not.toBeInTheDocument();
  });

  it('uses archive capability independently from manage capability', async () => {
    project.capabilities.can_archive_project = false; await detail();
    expect(screen.getByRole('button', { name: 'Edit project' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Archive project' })).not.toBeInTheDocument();
  });

  it('requires confirmation, archives, reads back state and refreshes the list', async () => {
    await detail(); fireEvent.click(screen.getByRole('button', { name: 'Archive project' }));
    expect(writes('POST')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' }));
    expect(await screen.findByText('Archived')).toBeVisible();
    await waitFor(() => expect(network.mock.calls.filter(([path, options]) => path === `/projects/${project.id}` && options.method === 'GET')).toHaveLength(2));
    expect(writes('POST')[0][0]).toBe(`/projects/${project.id}/archive`);
    expect(screen.queryByRole('button', { name: 'Archive project' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Back to projects' }));
    await screen.findByText('No projects found. Archived projects are hidden.');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(await screen.findByRole('link', { name: project.name })).toBeVisible();
    expect(within(screen.getByRole('table')).getByText('Archived')).toBeVisible();
  });

  it('can cancel archive without writing', async () => {
    await detail(); fireEvent.click(screen.getByRole('button', { name: 'Archive project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel archive' }));
    expect(screen.queryByRole('group', { name: 'Confirm archive' })).not.toBeInTheDocument();
    expect(writes('POST')).toHaveLength(0);
  });

  it('shows archive errors without claiming success', async () => {
    writeError = true; await detail();
    fireEvent.click(screen.getByRole('button', { name: 'Archive project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Archive denied');
    expect(screen.getByText('Not archived')).toBeVisible();
  });
});
