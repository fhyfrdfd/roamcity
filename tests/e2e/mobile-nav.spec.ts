import { expect, test } from "@playwright/test";

// Emulate a real touch device: `isMobile` switches Chromium to mobile
// viewport semantics, `hasTouch` makes navigator.maxTouchPoints > 0 (which
// the 3DGS data-saving gate keys off), and the coarse pointer media query
// then matches the way it does on a phone.
test.use({
  viewport: { width: 375, height: 812 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
});

test.describe("mobile navigation", () => {
  test("bottom bar reaches the pages only the desktop sidebar used to own", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");

    const nav = page.getByRole("navigation", { name: "移动端主导航" });
    await expect(nav).toBeVisible({ timeout: 15_000 });
    // First paint can precede hydration; clicking before the client router
    // attaches swallows the navigation. The day tabs render from React state,
    // so they are a reliable "hydration done" signal.
    await expect(page.getByRole("tablist", { name: "选择日期" })).toBeVisible({ timeout: 15_000 });

    // Sharing must survive on phones; it used to disappear below 640px.
    await expect(page.getByRole("button", { name: "分享" })).toBeVisible();

    // The map entry reveals the real map by collapsing the trip sheet: the
    // journey preview pill only exists once the sheet stops covering that
    // corner, so it doubles as the collapse signal.
    const preview = page.getByRole("button", { name: "行程预演" });
    await expect(preview).toBeHidden();
    await nav.getByRole("link", { name: "地图" }).click();
    await expect(page).toHaveURL(/\/trip\/chongqing-2026$/, { timeout: 10_000 });
    await expect(preview).toBeVisible({ timeout: 10_000 });

    await nav.getByRole("link", { name: "今天" }).click();
    await expect(page).toHaveURL(/\/trip\/chongqing-2026\/today$/, { timeout: 10_000 });

    await nav.getByRole("button", { name: "更多" }).click();
    await page.getByRole("dialog", { name: "更多页面" }).getByRole("link", { name: "交通" }).click();
    await expect(page).toHaveURL(/\/trip\/chongqing-2026\/transport$/, { timeout: 10_000 });

    await nav.getByRole("button", { name: "更多" }).click();
    await page.getByRole("dialog", { name: "更多页面" }).getByRole("link", { name: "预订推荐" }).click();
    await expect(page).toHaveURL(/\/trip\/chongqing-2026\/offers$/, { timeout: 10_000 });

    await nav.getByRole("button", { name: "更多" }).click();
    await page.getByRole("dialog", { name: "更多页面" }).getByRole("link", { name: "设置" }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("pages outside a trip get the global bottom bar", async ({ page }) => {
    await page.goto("/settings");

    const globalNav = page.getByRole("navigation", { name: "全局导航" });
    await expect(globalNav).toBeVisible();

    await globalNav.getByRole("link", { name: "我的旅行" }).click();
    await expect(page).toHaveURL(/\/trips$/);
    await expect(globalNav).toBeVisible();
  });

  test("keeps the iOS viewport cover flag and 16px form controls", async ({ page }) => {
    await page.goto("/new-trip");

    // Without viewport-fit=cover every env(safe-area-inset-*) resolves to 0.
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);

    // Safari zooms the page when a focused control is smaller than 16px.
    const fontSize = await page
      .getByLabel("旅行初始想法")
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
  });
});

test.describe("small phone (320px)", () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test("key pages never scroll sideways", async ({ page }) => {
    for (const path of ["/", "/trips", "/new-trip", "/settings", "/trip/chongqing-2026"]) {
      await page.goto(path);
      await expect(page.locator("body")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("landscape phone", () => {
  test.use({ viewport: { width: 812, height: 375 } });

  test("sheet snap states fit the short viewport above the tab bar", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");

    const sheet = page.getByTestId("trip-sheet");
    const handle = page.getByTestId("trip-sheet-handle");
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await expect(handle).toBeVisible({ timeout: 15_000 });
    // Wait for hydration before tapping: the server-rendered handle has no
    // click handler yet.
    await expect(page.getByRole("tablist", { name: "选择日期" })).toBeVisible({ timeout: 15_000 });

    // The sheet opens at "half"; each tap cycles half -> full -> collapsed -> half.
    const sheetHeight = async () => (await sheet.boundingBox())?.height ?? 0;
    const navBox = await page.getByRole("navigation", { name: "移动端主导航" }).boundingBox();
    expect(navBox).not.toBeNull();

    // The panel sits above the fixed tab bar, never underneath it, in every snap state.
    const assertAboveTabBar = async () => {
      const sheetBox = await sheet.boundingBox();
      expect(sheetBox).not.toBeNull();
      expect(sheetBox!.y + sheetBox!.height).toBeLessThanOrEqual(navBox!.y + 1);
    };

    await handle.tap(); // half -> full
    await expect.poll(sheetHeight).toBeGreaterThan(200);
    await assertAboveTabBar();

    await handle.tap(); // full -> collapsed
    await expect.poll(sheetHeight).toBeLessThan(150);
    await assertAboveTabBar();

    await handle.tap(); // collapsed -> half
    await expect.poll(sheetHeight).toBeGreaterThan(150);
    await assertAboveTabBar();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("touch input", () => {
  test("taps drive the bottom bar and the day tabs", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");

    const nav = page.getByRole("navigation", { name: "移动端主导航" });
    await expect(page.getByRole("tablist", { name: "选择日期" })).toBeVisible({ timeout: 15_000 });

    const today = nav.getByRole("link", { name: "今天" });
    const box = await today.boundingBox();
    expect(box).not.toBeNull();
    // Hit area must meet the 44px touch-target minimum.
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await today.tap();
    await expect(page).toHaveURL(/\/trip\/chongqing-2026\/today$/, { timeout: 10_000 });
  });
});

test.describe("tablet width", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("desktop sidebar replaces the mobile tab bar", async ({ page }) => {
    await page.goto("/trips");

    await expect(page.locator("aside").first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: "全局导航" })).toBeHidden();
  });
});

test.describe("3DGS on touch devices", () => {
  test("defers the 28 MB splat download behind a tap", async ({ page }) => {
    await page.goto("/3d/knock-community-hall");

    await expect(page.getByRole("heading", { name: /Knock Community Hall/ })).toBeVisible();
    await expect(page.getByTestId("splat-gate")).toBeVisible();
    await expect(page.getByTestId("splat-viewer")).toHaveCount(0);

    await page.getByTestId("splat-load").tap();
    await expect(page.getByTestId("splat-viewer")).toBeVisible({ timeout: 10_000 });
  });
});
