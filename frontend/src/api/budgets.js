import { request } from './client.js';

export const getBudget = (projectId, signal) => request(
  `/projects/${encodeURIComponent(projectId)}/budget`, { signal },
);
