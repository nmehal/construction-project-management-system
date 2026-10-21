import { request } from './client.js';

const projectPath = (id) => `/projects/${encodeURIComponent(id)}`;
export const listProjects = (includeArchived = false, signal) => request(
  includeArchived ? '/projects?include_archived=true' : '/projects', { signal },
);
export const getProject = (id, signal) => request(projectPath(id), { signal });
export const createProject = (values) => request('/projects', { method: 'POST', json: values });
export const updateProject = (id, changes) => request(projectPath(id), { method: 'PATCH', json: changes });
export const archiveProject = (id) => request(`${projectPath(id)}/archive`, { method: 'POST' });

// Creation is a system-level rule from POST /projects, unlike per-project edits.
// Read the role from /auth/me; never derive project capabilities from it.
export const canCreateProject = (user) => ['Admin', 'Project Manager'].includes(user?.system_role);
