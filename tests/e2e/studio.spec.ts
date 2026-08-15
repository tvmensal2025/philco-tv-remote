import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';

test.describe('estúdio NLE sem backend', () => {
  test('abre o editor com monitor, transporte e uma linha de efeitos reais', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.goto('/e2e/studio');

    await expect(page.getByRole('heading', { name: 'Estúdio dos 4 programas' })).toBeVisible();
    await expect(page.getByText('Validado')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Monitor Reels 1080 por 1920' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cortar', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aproximar timeline' })).toBeVisible();
    await expect(page.getByText('V1')).toBeVisible();
    await expect(page.getByText('Efeitos da fábrica')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dissolve' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Título' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Logo' })).toBeVisible();
    await expect(page.getByText('Push direcional')).toBeHidden();

    await page.getByText(/Ainda não na fábrica/).click();
    await expect(page.getByText('Push direcional')).toBeVisible();

    await page.getByRole('tab', { name: 'Casa' }).click();
    await expect(page.getByRole('heading', { name: 'Take 1' })).toBeVisible();
    await expect(page.getByText('Capacidade desta fábrica')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
