import { chromium } from "playwright";

const BASE = "http://localhost:3002";
const GUEST = "a49ba397-288d-4d9b-a2d7-40acbaeb3cd7";
const TRIP = "f9ff9be1-9741-4c77-976e-70069cefecb5";

const shots = [
  { path: `/trip/${TRIP}`, out: "shots/deck/assets/03-workspace-light.png" },
  { path: `/trip/${TRIP}/today`, out: "shots/deck/assets/06-today-light.png" },
];

const HIDE = `section[aria-label="本次规划来源"], section[aria-label="行程可信度校验"] { display: none !important; }`;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const shot of shots) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  await ctx.addCookies([{ name: "voyage_guest_workspace", value: GUEST, url: BASE }]);
  await ctx.addInitScript(() => window.localStorage.setItem("theme", "light"));
  const page = await ctx.newPage();
  await page.goto(BASE + shot.path, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: HIDE });
  const htmlClass = await page.evaluate(() => document.documentElement.className);
  await page.screenshot({ path: shot.out });
  console.log("saved", shot.out, "html.class=" + JSON.stringify(htmlClass));
  await ctx.close();
}
await browser.close();
