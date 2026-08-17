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

  test('split no playhead e ripple delete fecham a timeline', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    await page.goto('/e2e/editor');
    await page.getByTestId('nle-ruler').click({ position: { x: 90, y: 8 } });
    await page.getByRole('button', { name: 'Tesoura / Split' }).click();
    await expect(page.getByText('C1 Serviço-b').first()).toBeVisible();
    await page.getByTestId('nle-clip-C1 Serviço-b').click();
    await page.keyboard.press('Control+Backspace');
    await expect(page.getByText('C1 Serviço-b')).toHaveCount(0);
    await page.getByRole('button', { name: 'IA', exact: true }).click();
    await page.getByRole('button', { name: 'Criar Reel' }).click();
    await expect(page.getByText(/canvas 9:16/).first()).toBeVisible();
  });
});
