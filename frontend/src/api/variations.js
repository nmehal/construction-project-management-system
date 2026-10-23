import { request } from './client.js';
const base = (id) => `/projects/${encodeURIComponent(id)}/variations`;
export const listVariations = (id, signal) => request(base(id), { signal });
export const getVariation = (id, variationId, signal) => request(`${base(id)}/${encodeURIComponent(variationId)}`, { signal });
export const createVariation = (id, values) => request(base(id), { method: 'POST', json: values });
export const updateVariation = (id, variationId, changes) => request(`${base(id)}/${encodeURIComponent(variationId)}`, { method: 'PATCH', json: changes });
