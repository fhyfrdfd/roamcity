import { expect, test } from "@playwright/test";

test.describe("3DGS sample scene", () => {
  test("boots the vendored SuperSplat viewer with attribution", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

    await page.goto("/3d/knock-community-hall");
    await expect(page.getByRole("heading", { name: /Knock Community Hall/ })).toBeVisible();
    await expect(page.getByTestId("scene-license")).toContainText("CC-BY-4.0");
    await expect(page.getByText(/SuperSplat Viewer/)).toBeVisible();

    const frame = page.frameLocator('[data-testid="splat-viewer"]');
    await expect(frame.locator("canvas")).toBeVisible({ timeout: 90_000 });
    expect(errors).toEqual([]);
  });

  test("stays usable at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/3d/knock-community-hall");
    await expect(page.getByTestId("splat-viewer")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
