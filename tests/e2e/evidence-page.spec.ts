import { expect, test } from "@playwright/test";

test.describe("evidence source page", () => {
  test("opens from the trust panel and lists captured evidence", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 200)}`);
    });

    await page.goto("/new-trip?q=去重庆玩3天，2个人，预算3000，喜欢美食");
    await page.getByRole("button", { name: "开始对话" }).click();
    await expect(page.getByRole("heading", { name: "一起把这趟旅行定下来" })).toBeVisible();
    await page.getByLabel("出发日期").fill("2030-05-01");
    await page.getByLabel("返程日期").fill("2030-05-03");
    await page.getByRole("button", { name: "生成路线图" }).click();
    await page.waitForURL(/\/trip\//, { timeout: 30_000 });

    const trustPanel = page.getByRole("region", { name: "行程可信度校验" });
    await expect(trustPanel).toBeVisible({ timeout: 15_000 });
    await trustPanel.getByRole("link", { name: /证据 \d+ 条/ }).click();
    await page.waitForURL(/\/evidence$/, { timeout: 15_000 });

    await expect(page.getByRole("heading", { name: "证据来源" })).toBeVisible();
    const stats = page.getByRole("region", { name: "证据统计" });
    await expect(stats).toContainText("证据卡");
    await expect(stats).toContainText("真实来源");
    await expect(page.getByText(/数据记录时间：/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /返回行程/ })).toBeVisible();

    expect(errors).toEqual([]);
  });
});
