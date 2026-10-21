import { request } from './client.js';

export const getDashboard = (projectId, signal) => request(
  `/projects/${encodeURIComponent(projectId)}/dashboard`, { signal },
);
