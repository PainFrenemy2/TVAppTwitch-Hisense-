// Генерация плиток для установки через hisense://debug (как у Netflix/YouTube на главном экране VIDAA):
// node tools/make-icons.js
const { chromium } = require('playwright');
const path = require('path');

const root = path.join(__dirname, '..');
const fontUrl = 'data:font/woff2;base64,' + require('fs').readFileSync(path.join(root, 'fonts/inter-latin-700-normal.woff2')).toString('base64');
const glitch = '<svg viewBox="0 0 24 24" style="height:100%;display:block"><path fill="#fff" d="M2.149 0 .537 4.119v16.836h5.731V24h3.224l3.045-3.045h4.657l6.269-6.269V0H2.149zm19.164 13.612-3.582 3.582H12l-3.045 3.045v-3.045H4.119V2.149h17.194v11.463zm-3.582-7.343v6.262h-2.149V6.269h2.149zm-5.731 0v6.262H9.851V6.269H12z"/></svg>';

// Плитка: фиолетовый фон Twitch, Glitch + слово «twitch»
const tile = (w, h) => `<html><head><style>
  @font-face{font-family:I;font-weight:700;src:url(${fontUrl})}
  body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#9146ff;
    display:flex;align-items:center;justify-content:center;font-family:I,Arial,sans-serif;color:#fff}
  .g{height:${h * 0.34}px}
  .t{font-size:${h * 0.27}px;font-weight:700;letter-spacing:${-h * 0.006}px;margin-left:${h * 0.06}px;margin-top:-${h * 0.04}px}
</style></head><body><div class="g">${glitch}</div><div class="t">twitch</div></body></html>`;

// Квадратный значок: только Glitch
const square = (s) => `<html><body style="margin:0;width:${s}px;height:${s}px;background:#9146ff;display:flex;align-items:center;justify-content:center">
  <div style="height:${s * 0.56}px">${glitch}</div></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const shot = async (html, w, h, file) => {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(root, 'icons', file) });
    await page.close();
    console.log('icons/' + file, w + 'x' + h);
  };
  await shot(tile(1280, 720), 1280, 720, 'thumbnail.png');
  await shot(tile(640, 360), 640, 360, 'icon-large.png');
  await shot(tile(320, 180), 320, 180, 'icon-small.png');
  await shot(square(512), 512, 512, 'icon-square.png');
  await browser.close();
})();
