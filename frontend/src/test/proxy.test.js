// @vitest-environment node
import { describe, expect, it } from 'vitest';
import config from '../../vite.config.js';

const matcher = '^/projects(?:/|[?]|$)';
const proxy = config.server.proxy[matcher];
// Vite matches the configured regex against req.url, including its query string.
function matchingProxy(url) {
  const entry = Object.entries(config.server.proxy).find(([key]) => (
    key.startsWith('^') ? new RegExp(key).test(url) : url.startsWith(key)
  ));
  return entry?.[1];
}

describe('project screen/API development routing', () => {
  it.each([
    ...['dashboard', 'budget', 'variations', 'subcontractors', 'claims'].map((module) => ['GET', `/projects/11111111-1111-4111-8111-111111111111/${module}`]),
    ['GET', '/projects'],
    ['GET', '/projects?include_archived=true'],
    ['GET', '/projects/11111111-1111-4111-8111-111111111111'],
    ['POST', '/projects/11111111-1111-4111-8111-111111111111/archive'],
  ])('proxies %s %s without changing the URL or query', (method, url) => {
    const matched = matchingProxy(url);
    expect(matched).toBeDefined();
    expect(matched).toBe(proxy);
    expect(matched.target).toBe('http://127.0.0.1:8000');
    const req = { method, url, headers: { accept: 'application/json' } };
    expect(matched.bypass(req)).toBeUndefined();
    expect(req.url).toBe(url);
    expect(matched.rewrite).toBeUndefined();
  });

  it.each([
    ...['dashboard', 'budget', 'variations', 'subcontractors', 'claims'].flatMap((module) => [`/projects/11111111-1111-4111-8111-111111111111/${module}`, `/projects/11111111-1111-4111-8111-111111111111/${module}?reload=true`]),
    '/projects', '/projects/new',
    '/projects/11111111-1111-4111-8111-111111111111',
    '/projects?include_archived=true',
  ])('serves the SPA entry for browser navigation to %s', (url) => {
    const matched = matchingProxy(url);
    expect(matched).toBeDefined();
    expect(matched.bypass({ method: 'GET', url, headers: { accept: 'text/html,application/xhtml+xml' } })).toBe('/index.html');
  });

  it('keeps mutations and requests without Accept proxied', () => {
    expect(proxy.bypass({ method: 'POST', headers: { accept: 'text/html' } })).toBeUndefined();
    expect(proxy.bypass({ method: 'GET', headers: {} })).toBeUndefined();
  });

  it.each(['/projects-other', '/projectsOther?include_archived=true'])('does not match unrelated path %s', (url) => {
    expect(matchingProxy(url)).toBeUndefined();
  });
});
