import { test, expect } from './coverage.fixture'

test('public homepage renders hero and CTAs', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Welcome to Yappr/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Get Started/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Explore Public Posts/i })).toBeVisible()
  // Sidebar should show Sign In when not authenticated
  await expect(page.getByRole('link', { name: /Sign In/i })).toBeVisible()
})

