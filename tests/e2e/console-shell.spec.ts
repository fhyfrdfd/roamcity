import { expect, test } from "@playwright/test";

test.describe("cartographic console shell", () => {
  test("defaults to dark, floats the panel over the map, and exposes the theme toggle", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByTestId("itinerary-card").first()).toBeVisible({ timeout: 15_000 });

    const box = await page.locator("main").first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThan(200);
    expect(box!.y).toBeGreaterThan(56);

    const toggle = page.getByRole("button", { name: /切换到/ }).last();
    await toggle.click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await toggle.click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "搜索页面或行程地点" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "搜索页面或行程地点" })).not.toBeVisible();
  });

  test("stays usable at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/trip/chongqing-2026");
    await expect(page.getByRole("button", { name: "调整行程面板高度" })).toBeVisible({ timeout: 15_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
