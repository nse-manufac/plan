// แท็บแดชบอร์ด (ตารางราย P/N) ถูกลบทั้งแท็บเมื่อ 12 พ.ย. 2569 (เจ้าของสั่ง · PR #134)
//
// 🚨 **กติกาคำของไฟล์นี้ — เจ้าของสั่งเปลี่ยนชื่อแท็บเมื่อ 13 พ.ย. 2569**
//    · คำอังกฤษ `Dashboard` = **แท็บที่มีจริงบนจอ** (เดิมชื่อ "ยอดค้างรายวัน" · id ยังเป็น `wiptrend`)
//    · คำไทย "แดชบอร์ด"     = **หน้าที่ถูกลบ** (`renderDashTable` · `renderWipCards` · ตารางราย P/N)
//    เทสในไฟล์นี้จึง **ไม่แบนคำอังกฤษเปล่า ๆ อีกแล้ว** แต่แบนคำไทย และแบนประโยคที่ชี้ไป
//    หา Dashboard **ในฐานะหน้าอื่น** (`แท็บ Dashboard` · `ของ Dashboard` …) ซึ่งเป็นรูปของ
//    ประโยคที่ค้างมาจากหน้าเก่าทุกประโยคที่เคยเจอในเก้ารอบของการตรวจ
//
// ไฟล์นี้เคยมีเทสของหน้านั้น 57 ข้อ · ของที่ยังมีความหมายย้ายไปอยู่กับหน้าที่ยังอยู่แล้ว
//   · รายการใบย้อนแย้ง  → tests/anomaly-list.spec.js (แถบ #wtAnom ของหน้ายอดค้างรายวัน)
//   · รูปร่างของกราฟแท่ง → tests/chart-bars.spec.js  (กราฟยอดผลิตรายวันของหน้าเดียวกัน)
//
// ⚠️ **ไฟล์นี้ไม่ได้ถูกลบ และไม่ควรลบ** — มันเปลี่ยนหน้าที่จาก "ตรวจหน้าแดชบอร์ด"
//    เป็น "ตรวจว่าหน้าแดชบอร์ดไม่กลับมาเอง" ซึ่งเป็นกฎที่เจ้าของสั่งไว้ตรง ๆ และเป็นกฎ
//    ที่ไม่มีอะไรอื่นคุม · CLAUDE.md เขียนว่า "ห้ามเอาแท็บนี้กลับมาเองโดยไม่ได้สั่ง"
//    ถ้าวันหนึ่งเจ้าของสั่งให้เอากลับมาจริง ๆ ให้ลบเทสในไฟล์นี้ทิ้งพร้อมกับใบที่เอากลับมา
//    — ตอนนั้นจะมีคนสั่ง ไม่ใช่ agent ตัดสินเอง

const { test, expect } = require('@playwright/test');
const { waitReady } = require('./app-state');
const { appSources } = require('./app-source');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';
const PN = '9000000002';

const order = (poNo, qty) => ({
  id: poNo + '|' + PN, week: 'WK 34', poNo, pn: PN, subName: 'TUE-U', orderQty: qty,
  orderDate: '2026-08-03', status: 'active',
  importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});

async function open(page, orders = [order('AA-1', 1000)]) {
  await page.addInitScript(([k, o]) => localStorage.getItem(k) || localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' },
    orders: o, records: [], deliveryNotes: [], deltaWip: [], importHistory: []
  })), [K_STATE, orders]);
  await page.goto(APP);
  await waitReady(page);
}

test('แท็บแดชบอร์ดเดิมต้องไม่มีอยู่ — และชื่อ Dashboard ต้องเป็นของแท็บ wiptrend', async ({ page }) => {
  /* 🔒 เจ้าของสั่งลบทั้งแท็บเมื่อ 12 พ.ย. 2569 หลังถามยืนยันเรื่องของสามอย่างที่ไม่มีที่อื่นแทน
     (หัวเลขรวม · บัญชีของค้างรายขั้น · ตารางราย P/N) — "ลบทั้งแท็บไปเลยครับ"
     ข้อนี้คือสิ่งที่ทำให้คำสั่งนั้นมีผลต่อไป แม้คนที่มาทีหลังจะไม่ได้อ่าน CLAUDE.md */
  await open(page);
  await expect(page.locator('.tab-btn[data-tab="dashboard"]'), 'ปุ่มแท็บต้องไม่มี').toHaveCount(0);
  await expect(page.locator('#view-dashboard'), 'ตัวหน้าต้องไม่มี').toHaveCount(0);
  // และแท็บที่เหลือต้องครบเจ็ด ไม่ใช่หายตามไปด้วย
  expect(await page.locator('.tab-btn').evaluateAll(b => b.map(x => x.dataset.tab)))
    .toEqual(['import', 'entry', 'daily', 'delivery', 'fg', 'wiptrend', 'data']);
  /* 🔒 **เจ้าของสั่งย้ายชื่อ "Dashboard" มาให้แท็บนี้เมื่อ 13 พ.ย. 2569**
     ข้อนี้คือสิ่งที่ทำให้คำสั่งนั้นมีผลต่อไป และกันความสับสนที่แรงที่สุดของการเปลี่ยนชื่อ:
     คนที่เห็นปุ่มชื่อ Dashboard แล้วไปแก้โค้ดของ `renderDashTable` ซึ่งไม่มีอยู่แล้ว
     ⚠️ ต้องเทียบ **ป้ายของปุ่ม** กับ `data-tab` ของปุ่มเดียวกัน ไม่ใช่เทียบแยกกัน —
        เทียบแยกจะเขียวได้ทั้งที่ชื่อไปอยู่บนปุ่มผิดตัว */
  const dash = page.locator('.tab-btn', { hasText: 'Dashboard' });
  await expect(dash, 'ต้องมีปุ่มชื่อ Dashboard ปุ่มเดียว').toHaveCount(1);
  expect(await dash.getAttribute('data-tab'), 'ชื่อ Dashboard ต้องเป็นของแท็บ wiptrend').toBe('wiptrend');
  expect((await dash.innerText()).trim(), 'ป้ายต้องเป็น "📊 Dashboard" เป๊ะ').toBe('📊 Dashboard');
  await expect(page.locator('#view-wiptrend h2'), 'หัวข้อในหน้าต้องเปลี่ยนตามป้ายด้วย').toHaveText('Dashboard');
});

test('ของที่ย้ายบ้านต้องยังทำงานอยู่ — ไม่ได้ถูกลบตามแท็บไปด้วย', async ({ page }) => {
  /* ⚠️ สองอย่างนี้เคยอยู่บนแดชบอร์ดและถูก "ยืม" ไปใช้ที่หน้ายอดค้างรายวัน
     ตอนลบแท็บจึงเสี่ยงที่สุดที่จะถูกลบติดมือไปด้วย (anomalyListHtml · drawGroupedBars)
     เทสเต็มของทั้งสองอย่างอยู่ที่ tests/anomaly-list.spec.js กับ tests/chart-bars.spec.js
     ข้อนี้เป็นด่านหยาบ ๆ ว่ามันยังถูกวาดอยู่จริงหลังลบแท็บ */
  await open(page);
  await page.click('.tab-btn[data-tab="wiptrend"]');
  await page.waitForTimeout(350);
  await expect(page.locator('#wtDaily svg'), 'กราฟยอดผลิตรายวันต้องยังวาดอยู่').toBeVisible();
  await expect(page.locator('#wtPo svg'), 'กราฟ PO ต้องยังวาดอยู่').toBeVisible();
  expect(await page.evaluate(() => typeof anomalyListHtml),
    'ตัวสร้างรายการใบย้อนแย้งต้องยังอยู่ — แถบ #wtAnom เรียกใช้มัน').toBe('function');
});

test('ซอร์สต้องไม่เหลือซากของหน้าแดชบอร์ด — กันการเอากลับมาแบบครึ่ง ๆ', async ({ page }) => {
  /* 🚨 สิ่งที่กันคือ "เอากลับมาโดยไม่มีใครสั่ง" ซึ่งมักเริ่มจากคนก๊อปโค้ดเก่าบางส่วนกลับมา
     แล้วเหลือ id ที่ไม่มีใครวาด · ตัวจับ event ที่ชี้ไปที่ของที่ไม่มี · หรือฟังก์ชันตายที่
     อ่านแล้วเข้าใจว่าหน้านั้นยังอยู่ · ตรวจทุกไฟล์ที่หน้าโหลด ไม่ใช่แค่ HTML (tests/app-source.js)
     ⚠️ ค้นเฉพาะชื่อที่เป็นของหน้านั้นล้วน ๆ — ไม่เอาชื่อที่ใช้ร่วมกับหน้าอื่น
        เช่น `renderFilterOptions` (เดิมชื่อ renderDashFilterOptions) ยังเติมช่องเลือกให้สามหน้าที่เหลือ
     ⚠️ ข้ามคอมเมนต์ — ประวัติที่เขียนว่า "เคยมี X ของแดชบอร์ด" คือสิ่งที่อยากให้เหลือไว้ */
  const DEAD = ['view-dashboard', 'dashTable', 'wipCards', 'wipScopeNote', 'chartWrap', 'chartLegend',
    'chartRangeCaption', 'dashSubFilter', 'dashWeekFilter', 'dashStatusFilter', 'dashWipFilter',
    'dashHideDone', 'dashPresets', 'btnPrintDash', 'printHeader', 'printMeta',
    'renderWipCards', 'renderDashTable', 'renderDashScoped', 'dashFilteredRows', 'dashRangeRecords',
    'renderChartLegend', 'getChartRange', 'chartHiddenProcs', 'fillPrintHeader', 'buildCumSplitMap',
    /* ⚠️ สามตัวนี้ไม่ใช่ id บนจอ แต่เป็นคำที่แสดงผลของหัวคอลัมน์ · ตัวกรอง "ค้างอยู่ที่ขั้น"
       และแถวบัญชีของค้าง ซึ่งหายไปพร้อมแท็บเดียวกัน · ค้างอยู่สามรอบกว่าจะมีใครเก็บ
       (ผู้ตรวจ #134 รอบ 4) — ใส่ไว้ที่นี่เพื่อไม่ให้มีใครเติมกลับมาแบบไม่มีใครเรียก */
    'processHeadHtml', 'headHtml', 'waitCard'];
/* ⚠️ `waitCard` เขียนเปล่า ๆ **ห้ามเขียนเป็น `"'waitCard'"` ที่มีอัญประกาศ** — แบบมีอัญประกาศ
   จับได้แค่ "มีใครเรียก `ptext(p,'waitCard')`" ซึ่งไม่ใช่ฉากที่คอมเมนต์ข้างบนบอกว่าจะกัน
   ฉากจริงคือ "มีใครเติมฟิลด์ `waitCard:` กลับลงทะเบียนขั้นแบบไม่มีใครเรียก" ซึ่งรูปมีอัญประกาศ
   มองไม่เห็นเลย (ผู้ตรวจ #134 รอบ 6) · เขียนเปล่าคุมทั้งสองทางและยังเขียววันนี้
   เพราะคำนี้เหลือที่เดียวคือในคอมเมนต์ `app.js` ซึ่งเทสข้อนี้ลบคอมเมนต์ก่อนค้นอยู่แล้ว */
  /* ⚠️ ต้องลบคอมเมนต์ออกทั้งก้อน ไม่ใช่ดูแค่ตัวอักษรหน้าบรรทัด — คอมเมนต์ก้อนของ repo นี้
     ขึ้นบรรทัดต่อไปโดยไม่มี `*` นำ การดูแค่ตัวแรกจึงจับประวัติที่ตั้งใจเก็บไว้เป็นของจริง
     (เจอเองตอนรันครั้งแรก) · แทนที่ด้วยช่องว่างเพื่อให้เลขบรรทัดยังตรงของจริง */
  const strip = t => t
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, p) => p);
  /* 🚨 **คำที่คนอ่านเห็น ก็ต้องกวาดจากซอร์สด้วย ไม่ใช่กวาดแต่จากจอ**
     ข้อถัดไปอ่าน `innerText` ซึ่ง **ไม่รวมข้อความใน `prompt()` · `confirm()` · `toast()` · `title=`**
     ประโยคพวกนั้นคนอ่านเห็นเหมือนกัน แต่เห็นตอนกดเท่านั้น จึงรอดสายตาทั้งคนและเทส
     (ผู้ตรวจ #134 รอบ 2 เจอ `prompt('ชื่อสั้น — หัวตาราง Dashboard …')` ที่รอดมาแบบนี้
      ทั้งที่หัว commit ของรอบก่อนเขียนว่ากัน "ทั้งคลาสของปัญหานี้" — มันกันแค่ครึ่งเดียว) */
  /* 🚨 **คำอังกฤษ `Dashboard` เปล่า ๆ ใช้ได้แล้ว** ตั้งแต่ 13 พ.ย. 2569 เพราะเป็นป้ายของแท็บที่มีจริง
     ที่ยังห้ามคือ **คำไทย** (ใช้เรียกหน้าที่ถูกลบมาตลอด) และ **ประโยคที่ชี้ไปหา Dashboard
     ในฐานะหน้าอื่น** — รูปที่เจอจริงในเก้ารอบของการตรวจคือ `แท็บ Dashboard` · `ของแดชบอร์ด` ·
     `ใน Dashboard` · `หัวตาราง Dashboard` ซึ่งทุกอันเป็น "คำบอกที่ทาง + ชื่อ"
     ⚠️ ห้ามกลับไปแบนคำอังกฤษเปล่า ๆ — ป้ายปุ่มกับ `<h2>` จะทำให้ข้อนี้แดงทันที
        แล้วคนที่มาแก้จะ "แก้เทส" ด้วยการยกเว้นบรรทัดนั้น ซึ่งเปิดรูให้ของจริงหลุดไปด้วย */
  const DEAD_WORDS = ['แดชบอร์ด'];
  /* ⚠️ **ต้องมี `ที่` · `จาก` · `ไป` · `แถบ` ด้วย** — รอบแรกของ regex นี้มีแค่
     `แท็บ|หน้า|ใน|ของ|บน|หัวตาราง|กราฟ|ตาราง` แล้ว `ดูที่ Dashboard` · `ยอดที่ Dashboard ไม่ตรง`
     · `กดจาก Dashboard` · `แถบ Dashboard` **หลุดทั้งสี่** (ผู้ตรวจ #134 รอบ 11 ยิง regex พิสูจน์)
     `ที่` เป็นคำบอกที่ทางที่ใช้บ่อยที่สุดในไฟล์นี้ · ของเดิมแบนคำอังกฤษเปล่า ๆ จึงไม่มีรูนี้
     การเปลี่ยนมาเป็น regex ทำให้ **ความครบของรายการคำกลายเป็นเรื่องที่ต้องดูแล** */
  const STALE_POINTER = /(แท็บ|หน้า|ใน|ของ|บน|ที่|จาก|ไป|แถบ|หัวตาราง|กราฟ|ตาราง)\s*Dashboard/;
  const hits = [];
  for (const { file, text } of appSources()) {
    strip(text).split(/\r?\n/).forEach((line, i) => {
      for (const name of DEAD) if (line.includes(name)) hits.push(`${file}:${i + 1} ${name}`);
      /* ⚠️ `<title>` กับ `<h1>` เขียนว่า "Production & WIP Dashboard" โดยตั้งใจ — เป็นชื่อโปรแกรม
         ที่พนักงานคุ้นและบุ๊กมาร์กไว้ ไม่ใช่การชี้ไปที่แท็บ · เจ้าของตัดสินให้คงไว้ */
      if (/<title>|<h1>/.test(line)) return;
      for (const w of DEAD_WORDS) if (line.includes(w)) hits.push(`${file}:${i + 1} คำว่า "${w}"`);
      if (STALE_POINTER.test(line)) hits.push(`${file}:${i + 1} ประโยคชี้ไปหา Dashboard เหมือนเป็นหน้าอื่น`);
    });
  }
  expect(hits, 'ของพวกนี้ถูกลบไปพร้อมแท็บแล้ว เหลืออยู่ = มีคนเอากลับมาครึ่งเดียว').toEqual([]);
});

test('ข้อความบนจอต้องไม่อ้างถึงแท็บที่ถูกลบไปแล้ว', async ({ page }) => {
  /* 🚨 ของที่ลบยากที่สุดไม่ใช่โค้ด แต่คือ **ประโยคบนจอที่สัญญาถึงของที่ไม่มีแล้ว**
     ใบที่ลบแท็บนี้ตามไปแก้สามจุด แล้วยังตกอีกสองจุดที่อยู่ในกล่องพับ (ผู้ตรวจ #134 รันเจอ)
     — "Sub-Name … ไม่ใช่ตัวของแท็บ Dashboard" · "กราฟเดียวกับในแท็บ Dashboard"
     ทั้งสองส่งคนไปหาหน้าที่ไม่มีอยู่ และอ้างตัวกรองที่ไม่มีอยู่ที่ไหนอีกแล้ว
     ⚠️ ต้องกางกล่องพับทุกกล่องก่อนอ่าน — `innerText` ของของที่ซ่อนอยู่คืนค่าว่าง
        ตรวจแบบไม่กางจะเขียวเองทั้งที่ข้อความผิดยังอยู่ครบ
     ⚠️ ตรวจทุกแท็บ ไม่ใช่เฉพาะหน้ายอดค้างรายวัน — ประโยคแบบนี้อยู่ได้ทุกที่ */
  await open(page);
  /* ⚠️ `Dashboard` เปล่า ๆ ไม่อยู่ในรายการแล้ว — เป็นป้ายของแท็บนี้เองตั้งแต่ 13 พ.ย. 2569
     และ `<h2>` ของหน้าก็เขียนคำนี้ · ที่ยังห้ามคือคำไทยกับประโยคชี้ทาง (ดูข้อข้างบน) */
  const BAD = ['แดชบอร์ด', 'บัญชีของค้าง', 'ค้างอยู่ที่ขั้น', 'ยอดในช่วง'];
  const STALE_POINTER = /(แท็บ|หน้า|ใน|ของ|บน|ที่|จาก|ไป|แถบ|หัวตาราง|กราฟ|ตาราง)\s*Dashboard/;
  const tabs = await page.locator('.tab-btn').evaluateAll(b => b.map(x => x.dataset.tab));
  const hits = [];
  for (const tab of tabs) {
    await page.click(`.tab-btn[data-tab="${tab}"]`);
    await page.waitForTimeout(200);
    // กางกล่องพับทุกกล่องของแท็บนี้ก่อน ไม่งั้นข้อความข้างในไม่ถูกอ่าน
    await page.locator(`#view-${tab} details`).evaluateAll(ds => ds.forEach(d => { d.open = true; }));
    const txt = await page.locator(`#view-${tab}`).innerText();
    for (const w of BAD) if (txt.includes(w)) hits.push(`${tab}: ${w}`);
    if (STALE_POINTER.test(txt)) hits.push(`${tab}: ประโยคชี้ไปหา Dashboard เหมือนเป็นหน้าอื่น`);
  }
  /* ⚠️ หัวจอ (`<h1>`) ยังเขียนว่า "Production & WIP Dashboard" โดยตั้งใจ — เป็นชื่อโปรแกรม
     ที่พนักงานคุ้น ไม่ใช่การชี้ไปที่แท็บ · ข้อนี้จึงอ่านเฉพาะในตัวแท็บ ไม่รวมหัวจอ */
  expect(hits, 'ประโยคบนจอที่ยังอ้างของที่ถูกลบไปแล้ว').toEqual([]);
});
