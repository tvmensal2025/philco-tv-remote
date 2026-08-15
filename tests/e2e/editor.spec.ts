import { expect, test } from '@playwright/test';

test.describe('editor NLE de projeto', () => {
  test('abre timeline real a partir da decisão da IA', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    await page.goto('/e2e/editor');

    await expect(page.getByText('Editor fixture')).toBeVisible();
    await expect(page.getByText('V1', { exact: true })).toBeVisible();
    await expect(page.getByText('A1 Original')).toBeVisible();
    await expect(page.getByText('C1 Serviço').first()).toBeVisible();
    await expect(page.getByText('C3 Prato').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tesoura / Split' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Exportar' })).toBeVisible();
    await page.getByRole('button', { name: 'IA', exact: true }).click();
    await expect(page.getByText('AI Decisions')).toBeVisible();
    await expect(page.getByText(/Maior clareza visual/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Não usados' }).click();
    await expect(page.getByText('Baixa coerência visual')).toBeVisible();
  });
});
