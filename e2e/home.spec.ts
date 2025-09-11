import { test, expect } from './coverage.fixture'

test('login page renders form controls', async ({ page }) => {
  const res = await page.goto('/login')
  expect(res?.ok()).toBeTruthy()
  await expect(page.getByText(/Sign in with your Dash Platform identity/i)).toBeVisible()
  await expect(page.getByLabel('Identity ID')).toBeVisible()
  await expect(page.getByLabel('Private Key (WIF format)')).toBeVisible()
  await expect(page.getByRole('button', { name: /Sign In/i })).toBeVisible()
})
