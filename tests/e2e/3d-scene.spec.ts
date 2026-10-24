import { expect, test } from "@playwright/test";

test.describe("3D preset scene", () => {
  test("loads a preset scene with three clickable hotspots", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 200)}`);
    });

    const started = Date.now();
    await page.goto("/3d/chongqing-hongyadong");
    await expect(page.getByRole("heading", { name: /洪崖洞/ })).toBeVisible();
    await expect(page.getByTestId("scene-narration")).toContainText(/吊脚楼/);
    await expect(page.getByTestId("hotspot-detail")).toContainText(/吊脚楼/);
    await expect(page.getByRole("group", { name: "讲解员" })).toContainText("小漫");

    const hotspots = page.getByTestId("scene-hotspot");
    await expect(hotspots).toHaveCount(3);
    await hotspots.nth(1).click();
    await expect(page.getByTestId("hotspot-detail")).toContainText(/暖黄灯光/);
    await expect(page.getByTestId("scene-license")).toContainText(/CC0/);

    await expect(page.getByTestId("scene-viewer")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(errors).toEqual([]);
  });

  test("stays usable at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/3d/chongqing-hongyadong");
    await expect(page.getByRole("heading", { name: /洪崖洞/ })).toBeVisible();
    await expect(page.getByTestId("scene-hotspot").first()).toBeVisible();
    await page.getByTestId("scene-hotspot").first().click();
    await expect(page.getByTestId("hotspot-detail")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
