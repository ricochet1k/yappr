import { test, expect } from './coverage.fixture'

test.fixme(true, 'Compose trigger not stable in CI yet')
test('open compose modal and type', async ({ page }) => {
  await page.goto('/feed')
  await page.locator('button:has-text("What\'s happening?")').first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const editor = dialog.getByPlaceholder("What's happening?")
  await editor.fill('Hello from e2e')
  await expect(dialog.getByRole('button', { name: 'Post' })).toBeEnabled()
})

test.fixme(true, 'Requires auth + platform; to be implemented')
test('posting flow succeeds when authenticated (future)', async ({ page }) => {
  await page.goto('/feed')
  await page.locator('button:has-text("What\'s happening?")').first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder("What's happening?").fill('End-to-end post')
  await dialog.getByRole('button', { name: 'Post' }).click()
  await expect(page.getByText(/Post created successfully!/i)).toBeVisible()
})
