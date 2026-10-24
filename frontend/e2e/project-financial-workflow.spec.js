import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

const responseFor = (page, method, path) => page.waitForResponse((response) =>
  response.request().method() === method &&
  new URL(response.url()).pathname === path &&
  (response.headers()['content-type'] || '').includes('application/json'));

async function moduleLink(page, name) {
  await page.getByRole('navigation', { name: 'Project modules' })
    .getByRole('link', { name, exact: true }).click();
}

// Definition lists have semantic terms/definitions but no labelled value node.
async function metric(page, region, label, value) {
  const item = page.getByRole('region', { name: region, exact: true })
    .locator('dl > div').filter({ has: page.getByText(label, { exact: true }) });
  await expect(item.getByRole('definition')).toHaveText(value);
}

async function claimMetrics(page, paid) {
  await moduleLink(page, 'Dashboard');
  await metric(page, 'Claims', 'Claims draft', paid ? 'A$0.00' : 'A$50,000.00');
  await metric(page, 'Claims', 'Claims total', paid ? 'A$55,000.00' : 'A$0.00');
  await metric(page, 'Claims', 'Claims paid', paid ? 'A$55,000.00' : 'A$0.00');
  await metric(page, 'Claims', 'Claims outstanding', 'A$0.00');
  await metric(page, 'Claims', 'Claims issued', 'A$0.00');
  await metric(page, 'Claims', 'Claims overdue', 'A$0.00');
  for (const status of ['Draft', 'Issued', 'Paid', 'Overdue']) {
    await metric(page, 'Claim counts', status, status === (paid ? 'Paid' : 'Draft') ? '1' : '0');
  }
}

// One cohesive workflow; retries are disabled because this writes real demo data.
// Records remain prefixed for review/manual archive, including on partial failure.
test('project financial lifecycle survives nested navigation and session restoration', async ({ page }) => {
  const suffix = randomUUID();
  const projectName = `E2E Project ${suffix}`;
  const variation = `E2E Variation ${suffix}`;
  const company = `E2E Subcontractor ${suffix}`;
  const claimNo = `E2E-${suffix}`;

  await test.step('sign in through the UI', async () => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
    // Do not expose fill arguments in an authentication failure's call log.
    try {
      await page.getByLabel('Email', { exact: true }).fill(process.env.E2E_EMAIL);
      await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_PASSWORD);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    } catch {
      throw new Error('UI sign-in failed. Check demo credentials and target availability; authentication details suppressed.');
    }
  });

  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'New project', exact: true }).click();
  const projectForm = page.getByRole('form', { name: 'Create project', exact: true });
  await projectForm.getByLabel('Project name', { exact: true }).fill(projectName);
  await projectForm.getByLabel('Client', { exact: true }).fill('Fictional E2E Client');
  await projectForm.getByLabel('Suburb', { exact: true }).fill('Demo Suburb');
  await projectForm.getByLabel('Contract value (AUD)', { exact: true }).fill('500000');
  await projectForm.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('heading', { name: projectName, exact: true })).toBeVisible();
  const projectPath = new URL(page.url()).pathname;
  expect(projectPath).toMatch(/^\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('definition').filter({ hasText: /^A\$500,000\.00$/ })).toBeVisible();

  await test.step('approved variation reconciles contract totals', async () => {
    await moduleLink(page, 'Variations');
    await page.getByRole('button', { name: 'New variation', exact: true }).click();
    const form = page.getByRole('form', { name: 'Create variation', exact: true });
    await form.getByLabel('Description', { exact: true }).fill(variation);
    await form.getByLabel('Requested by', { exact: true }).fill('Fictional E2E Client');
    await form.getByLabel('Cost change (AUD)', { exact: true }).fill('10000');
    await form.getByLabel('Margin (AUD)', { exact: true }).fill('1500');
    await form.getByLabel('Status', { exact: true }).selectOption('Approved');
    await form.getByRole('button', { name: 'Create variation', exact: true }).click();
    const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: variation, exact: true }) });
    await expect(row.getByRole('cell')).toHaveText(['Fictional E2E Client', 'A$10,000.00', 'A$1,500.00', 'A$11,500.00', 'Approved', 'Edit']);
    await moduleLink(page, 'Dashboard');
    await metric(page, 'Contract', 'Contract value', 'A$500,000.00');
    await metric(page, 'Contract', 'Approved variations total', 'A$11,500.00');
    await metric(page, 'Contract', 'Revised contract value', 'A$511,500.00');
    for (const status of ['Draft', 'Submitted', 'Pending', 'Approved', 'Rejected']) {
      await metric(page, 'Variation counts', status, status === 'Approved' ? '1' : '0');
    }
  });

  await test.step('subcontractor reconciles commitments and outstanding', async () => {
    await moduleLink(page, 'Subcontractors');
    await page.getByRole('button', { name: 'New subcontractor', exact: true }).click();
    const form = page.getByRole('form', { name: 'Create subcontractor', exact: true });
    for (const [label, value] of [
      ['Company', company], ['Trade', 'Carpentry'], ['Scope', 'Fictional E2E framing'],
      ['Allowance (AUD)', '25000'], ['Committed (AUD)', '20000'], ['Paid (AUD)', '5000'], ['Status', 'active'],
    ]) await form.getByLabel(label, { exact: true }).fill(value);
    await form.getByRole('button', { name: 'Create subcontractor', exact: true }).click();
    const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: company, exact: true }) });
    await expect(row.getByRole('cell')).toHaveText(['Carpentry', 'Fictional E2E framing', 'A$25,000.00', 'A$20,000.00', 'A$5,000.00', 'A$15,000.00', 'active', 'Edit']);
    await moduleLink(page, 'Dashboard');
    for (const [label, value] of [
      ['Subcontractor allowance', 'A$25,000.00'], ['Subcontractor committed', 'A$20,000.00'],
      ['Subcontractor paid', 'A$5,000.00'], ['Subcontractor outstanding', 'A$15,000.00'],
    ]) await metric(page, 'Subcontractors', label, value);
  });

  let paidDate;
  let claimId;
  await test.step('Draft claim is edited then marked Paid with a server-generated date', async () => {
    await moduleLink(page, 'Claims');
    await page.getByRole('button', { name: 'New claim', exact: true }).click();
    const form = page.getByRole('form', { name: 'Create claim', exact: true });
    await form.getByLabel('Claim number', { exact: true }).fill(claimNo);
    await form.getByLabel('Stage', { exact: true }).fill('Fictional E2E progress');
    await form.getByLabel('Amount (AUD)', { exact: true }).fill('50000');
    await form.getByLabel('Claim date (ISO datetime)', { exact: true }).fill(new Date().toISOString());
    await form.getByLabel('Status', { exact: true }).selectOption('Draft');
    await expect(form.getByLabel('Paid date (ISO datetime)', { exact: true })).toHaveValue('');
    const createdResponse = responseFor(page, 'POST', `${projectPath}/claims`);
    await form.getByRole('button', { name: 'Create claim', exact: true }).click();
    const created = await createdResponse;
    expect(created.ok()).toBe(true);
    const draft = await created.json();
    claimId = draft.id;
    expect(draft.paid_date).toBeNull();
    const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: claimNo, exact: true }) });
    await expect(row.getByRole('cell', { name: 'A$50,000.00', exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'Draft', exact: true })).toBeVisible();
    await claimMetrics(page, false);

    await moduleLink(page, 'Claims');
    await page.getByRole('button', { name: `Edit ${claimNo}`, exact: true }).click();
    const edit = page.getByRole('form', { name: 'Edit claim', exact: true });
    await edit.getByLabel('Amount (AUD)', { exact: true }).fill('55000');
    await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(row.getByRole('cell', { name: 'A$55,000.00', exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'Draft', exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Edit ${claimNo}`, exact: true }).click();
    await edit.getByLabel('Status', { exact: true }).selectOption('Paid');
    await expect(edit.getByLabel('Paid date (ISO datetime)', { exact: true })).toHaveValue('');
    const paidResponse = responseFor(page, 'PATCH', `${projectPath}/claims/${claimId}`);
    await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
    const response = await paidResponse;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toEqual({ status: 'Paid' });
    const paid = await response.json();
    paidDate = paid.paid_date;
    expect(paidDate).toEqual(expect.any(String));
    expect(Number.isFinite(Date.parse(paidDate))).toBe(true);
    expect(paid.status).toBe('Paid');
    expect(paid.amount).toBe('55000.00');
    await expect(row.getByRole('cell', { name: paidDate, exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'Paid', exact: true })).toBeVisible();
    await claimMetrics(page, true);
  });

  await test.step('direct nested navigation and reload restore session and persisted claim', async () => {
    for (const navigate of [() => page.goto(`${projectPath}/claims`), () => page.reload()]) {
      const refresh = responseFor(page, 'POST', '/auth/refresh');
      const readback = responseFor(page, 'GET', `${projectPath}/claims`);
      const document = await navigate();
      expect(document.ok()).toBe(true);
      expect(document.headers()['content-type']).toContain('text/html');
      expect((await refresh).ok()).toBe(true);
      const response = await readback;
      expect(response.ok()).toBe(true);
      expect((await response.json()).find((claim) => claim.id === claimId)).toMatchObject({
        claim_no: claimNo, status: 'Paid', amount: '55000.00', paid_date: paidDate,
      });
      await expect(page.getByRole('heading', { name: 'Progress claims', exact: true })).toBeVisible();
      const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: claimNo, exact: true }) });
      await expect(row.getByRole('cell', { name: paidDate, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    }
    await claimMetrics(page, true);
    await metric(page, 'Contract', 'Revised contract value', 'A$511,500.00');
    await metric(page, 'Subcontractors', 'Subcontractor outstanding', 'A$15,000.00');
  });

  await test.step('sign out invalidates restored access', async () => {
    const logout = responseFor(page, 'POST', '/auth/logout');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    expect((await logout).ok()).toBe(true);
    await expect(page).toHaveURL(/\/login$/);
    await page.goto(`${projectPath}/claims`);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
  });
});
