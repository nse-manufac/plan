// หน้าตายเงียบ ๆ เมื่อไฟล์ที่หน้าโหลดมาไม่ครบชุด — ต้องโหลดใหม่เองครั้งเดียว แล้วถ้ายังไม่หายต้องบอกคน
//
// ฉากจริง (ผู้ตรวจ #139 จำลองเจอ): เครื่องถือ HTML รุ่นเก่าในแคชซึ่งยังไม่มีแท็กของไฟล์ที่เพิ่งแยกออกไป
// แต่ได้ app.js ตัวใหม่ → ReferenceError ตอนเปิดหน้า · โค้ดที่เหลือไม่ได้รัน รวมตัวเช็ก "มีรุ่นใหม่"
//
// จำลองด้วยการถอดนิยามของฟังก์ชันที่โค้ดตอนเปิดหน้าเรียกใช้ ออกจากไฟล์ที่มันอยู่ (patchAppSource
// หาไฟล์ให้เอง) — ผลเหมือนไฟล์นั้นไม่ได้ถูกโหลด และยังใช้ได้หลังฟังก์ชันย้ายไป core/ แล้ว

const { test, expect } = require('@playwright/test');
const { patchAppSource } = require('./app-source');

const APP = '/production_plan_tracker.html';
const ANCHOR = 'function todayISO(){ return isoLocal(new Date()); }';

function trackNavigations(page) {
  const urls = [];
  page.on('framenavigated', f => { if (f === page.mainFrame()) urls.push(f.url()); });
  return urls;
}

test('ไฟล์ไม่ครบชุดตอนเปิดหน้า — โหลดใหม่แบบข้ามแคชเองครั้งเดียว แล้วใช้งานได้', async ({ page }) => {
  // ขาดเฉพาะรอบแรก = แคชเก่า · รอบที่โหลดใหม่ได้ไฟล์ครบ
  let served = 0;
  await page.route(url => url.hostname === '127.0.0.1' && /\.(html|js)$/.test(url.pathname), async route => {
    const res = await route.fetch();
    const body = await res.text();
    if (!body.includes(ANCHOR) || served++ > 0) return route.fulfill({ response: res });
    return route.fulfill({ response: res, body: body.replace(ANCHOR, '') });
  });
  const navs = trackNavigations(page);
  await page.goto(APP);

  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.stateReady)).toBe('1');
  expect(served, 'ไฟล์ที่ขาดต้องถูกขอใหม่ในรอบที่สอง').toBe(2);
  expect(navs.length, 'โหลดหน้าใหม่หนึ่งครั้งพอดี').toBe(2);
  expect(navs[1], 'ต้องข้ามแคชของ HTML แบบเดียวกับปุ่ม "มีรุ่นใหม่"').toMatch(/\?_v=\d+/);
  await expect(page.locator('#bootFailed')).toHaveCount(0);
});

test('ไฟล์ยังไม่ครบหลังโหลดใหม่ — ขึ้นข้อความให้กด Ctrl+F5 ห้ามวนโหลดไม่รู้จบ', async ({ page }) => {
  const hits = await patchAppSource(page, ANCHOR, '');   // ขาดทุกรอบ = ไม่ใช่เรื่องแคช
  const navs = trackNavigations(page);
  await page.goto(APP);

  await expect(page.locator('#bootFailed')).toBeVisible();
  await expect(page.locator('#bootFailed')).toContainText('Ctrl+F5');
  await expect(page.locator('#bootFailed'), 'ต้องบอกว่าข้อมูลไม่หาย คนหน้างานจะได้ไม่ตกใจ').toContainText('ไม่หาย');
  expect(hits(), 'ต้องถอดได้จริง ไม่งั้นเทสนี้ไม่ได้ตรวจอะไร').toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  expect(navs.length, 'โหลดใหม่ได้ครั้งเดียว').toBe(2);
  expect(await page.evaluate(() => document.documentElement.dataset.stateReady),
    'ก่อนโหลดเสร็จห้ามบันทึกและห้ามซิงค์ (E4)').toBeUndefined();
});

test('เปิดหน้าปกติ — ตัวกันต้องไม่ทำอะไรเลย', async ({ page }) => {
  const navs = trackNavigations(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(APP);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.stateReady)).toBe('1');
  await page.waitForTimeout(500);
  expect(navs.length).toBe(1);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem('tue_order_tracker_v1:bootReload'))).toBeNull();
  await expect(page.locator('#bootFailed')).toHaveCount(0);
});

test('ข้อผิดพลาดหลังโหลดเสร็จ — ต้องไม่เด้งโหลดใหม่กลางที่คนกำลังคีย์', async ({ page }) => {
  const navs = trackNavigations(page);
  await page.goto(APP);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.stateReady)).toBe('1');
  await page.evaluate(() => setTimeout(() => { notDefinedAnywhere(); }, 0));
  await page.waitForTimeout(800);
  expect(navs.length).toBe(1);
  await expect(page.locator('#bootFailed')).toHaveCount(0);
});

/* ---------- ไฟล์ขาดที่โผล่ "ตอนวาดจอ" ไม่ใช่ตอนโหลดสคริปต์ (ผู้ตรวจ #140 ทัก) ----------
 * ฟังก์ชันที่ถูกเรียกเฉพาะใน renderAll() พังหลัง state โหลดแล้ว · openState() ติดป้ายโหลดเสร็จใน finally
 * ก่อนที่ error จะหลุดออกไป ตัวกันจึงเคยถอยแล้วปล่อยหน้าครึ่งเดียว
 * ใช้ buildCumMap เพราะถูกเรียกเฉพาะในฟังก์ชันวาดจอ (renderEntryTable บรรทัดต้น ๆ ไม่มีทางออกก่อน)
 * และเป็นก้อนที่จะย้ายไป core/cumulative ในใบถัดไป = ฉากจริงของใบนั้นพอดี
 * เปลี่ยนชื่อแทนการลบทั้งก้อน — ผลเหมือนไฟล์ไม่ถูกโหลด และไฟล์ยัง parse ได้ */
const RENDER_ANCHOR = 'function buildCumMap(records){';
const RENDER_GONE = 'function buildCumMap_ไม่ได้โหลด(records){';

test('ไฟล์ขาดที่โผล่ตอนวาดจอ — โหลดใหม่แบบข้ามแคชเองครั้งเดียว แล้วใช้งานได้', async ({ page }) => {
  let served = 0;
  await page.route(url => url.hostname === '127.0.0.1' && /\.(html|js)$/.test(url.pathname), async route => {
    const res = await route.fetch();
    const body = await res.text();
    if (!body.includes(RENDER_ANCHOR) || served++ > 0) return route.fulfill({ response: res });
    return route.fulfill({ response: res, body: body.replace(RENDER_ANCHOR, RENDER_GONE) });
  });
  const navs = trackNavigations(page);
  await page.goto(APP);

  await expect.poll(() => navs.length, { message: 'ต้องโหลดใหม่เอง ไม่ใช่ค้างหน้าครึ่งเดียว' }).toBe(2);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.stateReady)).toBe('1');
  expect(served, 'ไฟล์ที่ขาดต้องถูกขอใหม่ในรอบที่สอง').toBe(2);
  expect(navs[1]).toMatch(/\?_v=\d+/);
  await expect(page.locator('#bootFailed')).toHaveCount(0);
  expect(await page.locator('#entryTable').innerHTML(), 'รอบที่สองต้องวาดจอได้จริง').not.toBe('');
});

test('ไฟล์ขาดตอนวาดจอทุกรอบ — ขึ้นข้อความให้กด Ctrl+F5 ห้ามวนโหลดไม่รู้จบ', async ({ page }) => {
  const hits = await patchAppSource(page, RENDER_ANCHOR, RENDER_GONE);
  const navs = trackNavigations(page);
  await page.goto(APP);

  await expect(page.locator('#bootFailed')).toBeVisible();
  await expect(page.locator('#bootFailed')).toContainText('Ctrl+F5');
  expect(hits(), 'ต้องเปลี่ยนชื่อได้จริง ไม่งั้นเทสนี้ไม่ได้ตรวจอะไร').toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  expect(navs.length, 'โหลดใหม่ได้ครั้งเดียว').toBe(2);
});
