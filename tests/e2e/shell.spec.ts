import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, expectNoSeriousAccessibilityViolations } from './helpers';

const navigation = [
  ['Início', '/'],
  ['Sala', '/recordings'],
  ['Reels', '/reels'],
  ['Turno', '/moments'],
  ['Câmeras', '/cameras'],
  ['Estúdio', '/estudio'],
  ['Conta', '/settings'],
] as const;

test.describe('shell responsivo sem backend', () => {
  test('oferece navegação completa e foco visível no desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/e2e/shell');

    const primaryNav = page.getByRole('navigation', { name: 'Navegação principal' });
    for (const [name, href] of navigation) {
      await expect(primaryNav.getByRole('link', { name })).toHaveAttribute('href', href);
    }
    await expect(page.getByRole('heading', { level: 1, name: 'Hoje' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sair da conta' })).toBeVisible();

    const overview = primaryNav.getByRole('link', { name: 'Início' });
    await overview.focus();
    await expect(overview).toBeFocused();
    await expectNoHorizontalOverflow(page);
  });

  test('abre o menu completo no celular', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/e2e/shell');
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    const primaryNav = page.getByRole('navigation', { name: 'Navegação principal' });
    await expect(primaryNav.getByRole('link', { name: 'Conta' })).toHaveAttribute(
      'href',
      '/settings',
    );
    await expect(page.getByRole('button', { name: 'Sair da conta' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('não possui violações críticas ou sérias com o menu móvel aberto', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/e2e/shell');
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    await expectNoSeriousAccessibilityViolations(page);
  });
});
