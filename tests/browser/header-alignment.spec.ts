import { test, expect } from '@playwright/test';

test('header links align with the main viewing window width on wide screens', async ({ page }) => {
  for (const width of [2560, 1920, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelector('#image-title')?.textContent,
      undefined,
      { timeout: 15000 },
    );
    const box = await page.evaluate(() => {
      const r = (selector: string) => {
        const b = document.querySelector(selector)!.getBoundingClientRect();
        return { left: b.left, right: b.right };
      };
      return {
        wordmark: r('.wordmark'),
        aboutToggle: r('.about-toggle'),
        sourceLink: r('.source-link'),
        // The main viewing window content box (biology header shares its edges).
        content: r('#image-biology'),
        mosaic: r('.mosaic-scroll'),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    // The wordmark's left edge matches the viewing window's left content edge.
    expect(box.wordmark.left).toBe(box.content.left);
    expect(box.content.left).toBe(box.mosaic.left);
    // The rightmost header link's right edge matches the right content edge.
    expect(Math.max(box.sourceLink.right, box.aboutToggle.right)).toBe(box.mosaic.right);
    expect(box.overflow).toBe(false);
  }
});
