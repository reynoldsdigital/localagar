// Headless repro: load the game, click Play, observe what happens.
import puppeteer from "puppeteer";

const URL = process.env.URL || "http://100.98.219.43:3000";

const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const page = await browser.newPage();
page.setDefaultTimeout(15000);

page.on("console", m => console.log(`[console:${m.type()}]`, m.text()));
page.on("pageerror", e => console.log(`[pageerror]`, e.message));
page.on("requestfailed", r => console.log(`[reqfail]`, r.url(), r.failure()?.errorText));
page.on("response", r => {
  if (r.status() >= 400) console.log(`[HTTP ${r.status()}]`, r.url());
});

console.log(`Loading ${URL} ...`);
await page.goto(URL, { waitUntil: "networkidle0" });

// Inspect DOM state
const beforeClick = await page.evaluate(() => {
  return {
    menuHidden: document.getElementById("menu").hidden,
    hudHidden: document.getElementById("hud").hidden,
    canvasExists: !!document.getElementById("game"),
    nameValue: document.getElementById("name-input")?.value,
    formExists: !!document.getElementById("join-form"),
  };
});
console.log("DOM before click:", beforeClick);

console.log("Clicking Play...");
await page.click("#play-btn");

await new Promise(r => setTimeout(r, 2000));

const afterClick = await page.evaluate(() => {
  return {
    menuHidden: document.getElementById("menu").hidden,
    hudHidden: document.getElementById("hud").hidden,
    wsState: (function() {
      // No exposed var; count visible canvases
      const c = document.getElementById("game");
      return { hasCanvas: !!c, width: c?.width, height: c?.height };
    })(),
    score: document.getElementById("score")?.textContent,
    rank: document.getElementById("rank")?.textContent,
  };
});
console.log("DOM after click:", afterClick);

await browser.close();
