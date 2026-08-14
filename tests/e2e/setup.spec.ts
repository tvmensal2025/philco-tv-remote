import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, expectNoSeriousAccessibilityViolations } from './helpers';

test.describe('instalação sem credenciais', () => {
  test('redireciona para o login e nunca tenta usar serviços reais', async ({ page }) => {
    const externalRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(request.url());
    });

    await page.goto('/');

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: /Preencha o arquivo \.env/i })).toBeVisible();
    await expect(page.getByText('Configuração da instalação')).toBeVisible();
    await expect(page.getByText('NEXT_PUBLIC_SUPABASE_URL', { exact: true })).toBeVisible();
    await expect(page.getByText('INGEST_API_KEY', { exact: true })).toBeVisible();
    expect(
      externalRequests,
      'o modo sem credenciais não deve chamar Supabase, Redis ou MinIO',
    ).toEqual([]);
  });

  test('expõe readiness honesta para automação', async ({ request }) => {
    const response = await request.get('/api/ready');
    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toEqual({ ready: true, configured: false });
  });

  test('permanece legível e sem overflow em desktop e celular', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /Preencha o arquivo \.env/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.getByText('NEXT_PUBLIC_SUPABASE_URL', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('não possui violações críticas ou sérias de acessibilidade', async ({ page }) => {
    await page.goto('/login');
    await expectNoSeriousAccessibilityViolations(page);
  });
});
