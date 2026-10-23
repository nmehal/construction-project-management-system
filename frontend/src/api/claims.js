import { request } from './client.js';
const base = (id) => `/projects/${encodeURIComponent(id)}/claims`;
export const listClaims = (id, signal) => request(base(id), { signal });
export const createClaim = (id, values) => request(base(id), { method: 'POST', json: values });
export const updateClaim = (id, claimId, changes) => request(`${base(id)}/${encodeURIComponent(claimId)}`, { method: 'PATCH', json: changes });
export const getClaim = (id, claimId, signal) => request(`${base(id)}/${encodeURIComponent(claimId)}`, { signal });
