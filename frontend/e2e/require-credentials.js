export default function requireCredentials() {
  if (!process.env.E2E_EMAIL?.trim() || !process.env.E2E_PASSWORD) {
    throw new Error('Set E2E_EMAIL and E2E_PASSWORD for an existing demo Admin or Project Manager. No tests ran. See e2e/README.md.');
  }
}
