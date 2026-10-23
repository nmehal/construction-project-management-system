import { request } from './client.js';
const base = (id) => `/projects/${encodeURIComponent(id)}/subcontractors`;
export const listSubcontractors = (id, signal) => request(base(id), { signal });
export const createSubcontractor = (id, values) => request(base(id), { method: 'POST', json: values });
export const updateSubcontractor = (id, subcontractorId, changes) => request(`${base(id)}/${encodeURIComponent(subcontractorId)}`, { method: 'PATCH', json: changes });
export const getSubcontractor = (id, subcontractorId, signal) => request(`${base(id)}/${encodeURIComponent(subcontractorId)}`, { signal });
