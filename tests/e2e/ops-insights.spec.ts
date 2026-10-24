import { expect, test } from "@playwright/test";

test.describe("operations insights", () => {
  test("renders the full dashboard at phone width", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/trip/chongqing-2026/insights");

    await expect(page.getByRole("heading", { name: /运营看点/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("region", { name: "运营指标" })).toContainText("估算花费");
    await expect(page.getByRole("img", { name: "POI 密度网格" })).toBeVisible();
    await expect(page.getByRole("img", { name: "分时负载图" })).toBeVisible();
    await expect(page.getByRole("region", { name: "路线负载" })).toContainText("Day 1");
    await expect(page.getByRole("region", { name: "客流风险" })).toContainText("估算");
    await expect(page.getByRole("region", { name: "运营建议" })).toBeVisible();
    await expect(page.getByTestId("ops-export")).toBeEnabled();
    await expect(page.getByText(/仅行程内 POI/)).toBeVisible();

    const day2 = page.getByRole("button", { name: "Day 2" });
    await day2.click();
    await expect(day2).toHaveAttribute("aria-pressed", "true");

    const highRisk = page.getByRole("button", { name: "高风险" });
    await highRisk.click();
    await expect(highRisk).toHaveAttribute("aria-pressed", "true");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});
