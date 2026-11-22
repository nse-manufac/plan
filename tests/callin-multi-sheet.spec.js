/* ติ๊กหลายชีตแล้วเทียบ/เก็บรอบเดียว
 *
 * ของจริงที่ใบนี้มาแก้ — ไฟล์ Call In ของบ้าน A มีสองชีตข้อมูล (Choke + X'FRM)
 * เจ้าของต้องก๊อปแถวของชีตโช้คไปใส่ชีตหลักด้วยมือทุกสัปดาห์ เพราะหน้านี้เลือกได้ทีละชีต
 * (ตรวจไฟล์จริงของ WK46 เมื่อ 22 พ.ย. 2569: ชีตโช้ค 47 ใบเป็นชุดย่อยของชีตหลัก 233 ใบ)
 */
const { test, expect } = require('@playwright/test');
const { readSaved, waitReady } = require('./app-state');
const { callInWorkbook } = require('./fixtures');
const JSZip = require('jszip');

const APP = '/production_plan_tracker.html';
const K_STATE = 'tue_order_tracker_v1';

const order = (poNo, pn) => ({
  id: poNo + '|' + pn, week: 'W46', poNo, pn, subName: 'TUE-A', orderQty: 300,
  orderDate: '2026-07-06', status: 'active',
  importedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', _dirty: false
});

/* รหัส PO ของเทสห้ามขึ้นต้น TM2… (F3 — repo นี้เป็น public) */
const A1 = order('TM52AA001', '9100000081');
const A2 = order('TM52AA002', '9100000082');
const A3 = order('TM52AA003', '9100000083');

const row = (o, wip) => ({ pn: o.pn, poNo: o.poNo, orderDate: '2026-07-06', qty: o.orderQty, wip });

const CHOKE = 'Choke  WK46';          // ชื่อจริงมีเว้นวรรคสองตัว
const XFRM = "X'FRM WK46";            // ชื่อจริงมีอัญประกาศเดี่ยวอยู่ในตัว

async function openWith(page, orders) {
  await page.addInitScript(([k, o]) => localStorage.setItem(k, JSON.stringify({
    version: 1, deviceName: 't',
    deadlineOffsets: { winding: 10, assembly: 17, support: null, inspection: 24, shipping: 28 },
    chartPref: { mode: '14', from: '', to: '' }, orders: o, records: [], importHistory: []
  })), [K_STATE, orders]);
  await page.goto(APP);
  await waitReady(page);
  await page.waitForSelector('.tab-btn[data-tab="data"]');
  await page.click('.tab-btn[data-tab="data"]');
}

/** เปิดไฟล์ที่มีชีตข้อมูลสองชีต (+ ชีตที่อ่านไม่ได้ ซึ่ง fixture แถมมาให้เสมอ) */
async function openFile(page, opts) {
  await page.setInputFiles('#callInFileInput', {
    name: 'callin.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await callInWorkbook(opts.main, { sheetName: opts.mainName, sheets: opts.extra })
  });
  await expect(page.locator('#btnCallInScan')).toBeEnabled();
}

/** ป้ายของทุกชีต พร้อมสถานะติ๊ก — อ่านจากจอจริง */
const sheetList = page => page.evaluate(() =>
  Array.from(document.querySelectorAll('#callInSheets .cisheet')).map(l => ({
    name: l.querySelector('b').textContent,
    checked: l.querySelector('input').checked,
    text: l.innerText
  })));

const liveWip = async page => (await readSaved(page, K_STATE)).deltaWip
  .filter(d => !d.voided).map(d => d.orderId + '@wk' + d.week + '=' + d.wip).sort();

const TWO = {
  mainName: CHOKE, main: [row(A1, 1170)],
  extra: [{ sheetName: XFRM, rows: [row(A1, 1170), row(A2, 222), row(A3, 333)] }]
};

test('ติ๊กมาให้เฉพาะชีตที่อ่านได้ — ชีตที่อ่านไม่ได้ต้องไม่ถูกติ๊ก และต้องบอกเหตุไว้ข้าง ๆ', async ({ page }) => {
  await openWith(page, [A1, A2, A3]);
  await openFile(page, TWO);

  const list = await sheetList(page);
  expect(list.map(s => s.name)).toEqual([CHOKE, XFRM, 'อีกชีตที่ห้ามแตะ']);
  expect(list.filter(s => s.checked).map(s => s.name),
    'สองชีตข้อมูลต้องถูกติ๊กมาให้ ชีตที่อ่านไม่ได้ต้องไม่ถูกติ๊ก').toEqual([CHOKE, XFRM]);
  expect(list[2].text, 'ต้องบอกเหตุว่าทำไมชีตนี้อ่านไม่ได้ ไม่ใช่เงียบ').toContain('P/N');
  expect(list[1].text, 'ชีตที่อ่านได้ต้องบอกงวดกับจำนวนใบ').toContain('wk46');
  expect(list[1].text).toContain('3 ใบ');
});

test('กดเทียบยอดรอบเดียวได้ครบทั้งสองชีต แล้วเก็บได้ในครั้งเดียว', async ({ page }) => {
  await openWith(page, [A1, A2, A3]);
  await openFile(page, TWO);
  await page.click('#btnCallInScan');
  await expect(page.locator('#callInPreviewPanel')).toBeVisible();

  /* ⚠️ ยุบช่องว่างก่อนเทียบ — ชื่อชีตจริงมีเว้นวรรคสองตัว ('Choke  WK46')
     แต่ HTML ยุบให้เหลือตัวเดียวตอนแสดงผล · ที่ต้องยืนยันคือชื่อชีตโผล่บนจอ ไม่ใช่จำนวนช่องว่าง */
  const flat = s => s.replace(/\s+/g, ' ');
  const sum = flat(await page.locator('#callInSummary').innerText());
  expect(sum, 'ต้องบอกว่าเทียบจากกี่ชีตและชีตไหน').toContain('เทียบจาก 2 ชีต');
  expect(sum).toContain(flat(CHOKE));
  expect(sum).toContain(XFRM);

  await page.click('#btnDeltaWipSave');
  await page.waitForTimeout(250);
  expect(await liveWip(page), 'ต้องเก็บครบทั้งสามใบจากสองชีตในการกดครั้งเดียว').toEqual([
    'TM52AA001|9100000081@wk46=1170',
    'TM52AA002|9100000082@wk46=222',
    'TM52AA003|9100000083@wk46=333'
  ]);
  await expect(page.locator('#toast')).toContainText('2 ชีต');
});

test('ใบที่อยู่ทั้งสองชีต ต้องใช้ค่าของชีตท้ายสุด — ผลเดียวกับนำเข้าทีละชีตตามลำดับ', async ({ page }) => {
  await openWith(page, [A1, A2]);
  /* ของจริงสองชีตใส่เลขตรงกันทุกใบ ที่นี่ตั้งให้ต่างกันโดยเจตนาเพื่อให้เห็นว่าใครชนะ */
  await openFile(page, {
    mainName: CHOKE, main: [row(A1, 111)],
    extra: [{ sheetName: XFRM, rows: [row(A1, 999), row(A2, 222)] }]
  });
  await page.click('#btnCallInScan');
  await expect(page.locator('#callInPreviewPanel')).toBeVisible();
  const sum = await page.locator('#callInSummary').innerText();
  expect(sum, 'ต้องบอกว่ามีใบซ้ำกันกี่ใบ และใช้ค่าของชีตไหน').toContain('ใบที่อยู่หลายชีต 1 ใบ');
  expect(sum, 'ค่าสองชีตไม่เท่ากันต้องฟ้องด้วย ไม่ใช่เงียบ').toContain('ไม่เท่ากัน 1 ใบ');

  await page.click('#btnDeltaWipSave');
  await page.waitForTimeout(250);
  expect(await liveWip(page)).toEqual([
    'TM52AA001|9100000081@wk46=999', 'TM52AA002|9100000082@wk46=222'
  ]);
});

test('ติ๊กชีตคนละงวด ต้องฟ้องและไม่เทียบอะไรเลย — saveDeltaWip เก็บได้งวดเดียวต่อครั้ง', async ({ page }) => {
  await openWith(page, [A1, A2]);
  await openFile(page, {
    mainName: 'Choke  WK46', main: [row(A1, 111)],
    extra: [{ sheetName: "X'FRM WK47", rows: [row(A2, 222)] }]
  });
  await page.click('#btnCallInScan');

  await expect(page.locator('#toast'), 'ต้องบอกว่าคนละงวด').toContainText('คนละงวด');
  await expect(page.locator('#toast')).toContainText('wk46');
  await expect(page.locator('#toast')).toContainText('wk47');
  await expect(page.locator('#callInPreviewPanel'),
    'ปนงวดแล้วห้ามเปิดหน้าผลเทียบให้กดเก็บต่อ').toBeHidden();
  expect(await liveWip(page), 'ต้องไม่เก็บอะไรเลย').toEqual([]);
});

test('ปลดติ๊กหมดแล้วกดเทียบ ต้องบอกให้ติ๊กก่อน', async ({ page }) => {
  await openWith(page, [A1, A2, A3]);
  await openFile(page, TWO);
  await page.evaluate(() => document.querySelectorAll('#callInSheets input')
    .forEach(b => { b.checked = false; }));
  await page.click('#btnCallInScan');
  await expect(page.locator('#toast')).toContainText('ติ๊กชีต');
  await expect(page.locator('#callInPreviewPanel')).toBeHidden();
});

test('ติ๊กด้วยการคลิกจริงต้องใช้งานได้ — ปลดติ๊กชีตโช้คแล้วต้องเทียบจากชีตเดียว', async ({ page }) => {
  /* ⚠️ เทสอื่นตั้งค่า checked ผ่าน evaluate ข้อนี้คลิกของจริง
     เพื่อพิสูจน์ว่า <label> ครอบ <input> ถูก และกดโดนจริงบนจอ */
  await openWith(page, [A1, A2, A3]);
  await openFile(page, TWO);
  await page.locator('#callInSheets .cisheet').first().locator('input').click();

  const list = await sheetList(page);
  expect(list.filter(s => s.checked).map(s => s.name)).toEqual([XFRM]);

  await page.click('#btnCallInScan');
  await expect(page.locator('#callInPreviewPanel')).toBeVisible();
  expect(await page.locator('#callInSummary').innerText()).toContain('เทียบจาก 1 ชีต');
});


/* ---------- ชีตที่ซ่อนไว้ (ผู้ตรวจ #146 รันพิสูจน์) ----------
 *
 * 🚨 ชีตที่ถูกซ่อนคือของเก่าที่เขาตั้งใจเก็บไว้ ห้ามดึงยอดออกมาใช้ (กฎเดียวกับ isHiddenSheet())
 *    ก่อนการติ๊กหลายชีต ชีตซ่อนก็อยู่ในรายการให้เลือกเหมือนกัน แต่คนต้องเลือกเองและเห็นชื่อ
 *    พอติ๊กให้เองแล้วยุบรวมกับชีตจริง จึงไม่มีจังหวะไหนให้คนเห็นเลย
 * 🚨 ฉากนี้คือ "ก๊อปชีตเก็บไว้ก่อนแก้" ซึ่งได้ชีตซ่อน **งวดเดียวกัน**
 *    ด่าน "ชีตคนละงวด" จึงช่วยไม่ได้ และยอดเก่าชนะเพราะการยุบใบซ้ำเอาค่าของชีตท้ายสุด
 *    เลขที่ชนะคือเลขที่ไปอยู่ช่อง Wip bal. บนกระดาษ FM-ST-07 ที่ส่งถึง Delta
 */
const WITH_HIDDEN = {
  mainName: XFRM, main: [row(A1, 111)],
  extra: [{ sheetName: 'ของเก่า WK46', rows: [row(A1, 7777)], hidden: true }]
};

test('🚨 ชีตที่ซ่อนไว้ต้องไม่ถูกติ๊กให้เอง และยอดเก่าของมันต้องไม่ทับยอดจริง', async ({ page }) => {
  await openWith(page, [A1]);
  await openFile(page, WITH_HIDDEN);

  const list = await sheetList(page);
  expect(list.filter(s => s.checked).map(s => s.name),
    'ติ๊กมาให้เฉพาะชีตจริง ชีตที่ซ่อนไว้ต้องไม่ถูกติ๊ก').toEqual([XFRM]);
  expect(list[1].text, 'ต้องมีคำว่า "ซ่อน" อยู่บนจอ ไม่ใช่ยุบรวมจนดูเหมือนชีตธรรมดา')
    .toContain('ซ่อน');
  expect(list[1].text, 'แต่ยังต้องบอกงวดกับจำนวนใบ คนที่ตั้งใจจะติ๊กต้องรู้ว่าข้างในมีอะไร')
    .toContain('wk46');

  await page.click('#btnCallInScan');
  await expect(page.locator('#callInPreviewPanel')).toBeVisible();
  await page.click('#btnDeltaWipSave');
  await page.waitForTimeout(250);
  expect(await liveWip(page), 'ต้องได้ยอดของชีตจริง ไม่ใช่ยอดของชีตที่ซ่อนไว้')
    .toEqual(['TM52AA001|9100000081@wk46=111']);
});

test('ชีตที่ซ่อนไว้ยังติ๊กได้เองถ้าคนตั้งใจ — ห้าม disabled (G1)', async ({ page }) => {
  /* คู่กับข้อข้างบน · กันการแก้เกินไปเป็นการตัดชีตซ่อนออกจากรายการหรือกดไม่ได้
     ไฟล์จริงเคยซ่อนชีตที่ยังใช้งานอยู่ได้ และคนที่รู้ว่าตัวเองทำอะไรต้องไปต่อได้ */
  await openWith(page, [A1]);
  await openFile(page, WITH_HIDDEN);
  await page.locator('#callInSheets .cisheet').nth(1).locator('input').click();

  expect((await sheetList(page)).filter(s => s.checked).map(s => s.name)).toEqual([XFRM, 'ของเก่า WK46']);
  await page.click('#btnCallInScan');
  await expect(page.locator('#callInPreviewPanel')).toBeVisible();
  await page.click('#btnDeltaWipSave');
  await page.waitForTimeout(250);
  expect(await liveWip(page), 'ติ๊กเองแล้วต้องได้ค่าของชีตท้ายสุดตามกฎเดิม')
    .toEqual(['TM52AA001|9100000081@wk46=7777']);
});

test('🚨 ชีตที่อ่านแล้วพัง ต้องไม่ทำให้ทั้งไฟล์ตาย — ชีตที่ดีต้องยังเทียบได้', async ({ page }) => {
  /* ฉากของจริง: ใครลบ entry ของชีตออกจากซิปโดยที่ workbook.xml ยังประกาศชีตนั้นไว้
     readCallInSheet() จะ throw และลูปอ่านชีตอยู่ "นอก" try ที่ครอบการโหลดซิป
     ผลคือปุ่มเทียบยอดยัง disabled · รายการชีตยังว่าง · toast ค้างที่ "กำลังอ่านไฟล์..."
     = ทางตันที่ไม่บอกเหตุ ซึ่งแย่กว่าชีตนั้นขึ้นว่าอ่านไม่ได้ (G1 · ผู้ตรวจ #146 รันพิสูจน์) */
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await openWith(page, [A1, A2]);

  const buf = await callInWorkbook([row(A1, 111)],
    { sheetName: XFRM, sheets: [{ sheetName: "X'FRM เก่า", rows: [row(A2, 222)] }] });
  const zip = await JSZip.loadAsync(buf);
  /* หา xml ของชีตที่สองจากเลขที่อยู่ในนั้นเอง แทนการเดาว่าเป็น sheet2.xml */
  for (const p of Object.keys(zip.files).filter(p => /worksheets\/sheet\d+\.xml$/.test(p))) {
    if ((await zip.file(p).async('string')).includes('>222<')) zip.remove(p);
  }
  await page.setInputFiles('#callInFileInput', {
    name: 'callin.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await zip.generateAsync({ type: 'nodebuffer' })
  });

  await expect(page.locator('#btnCallInScan'),
    'ชีตเดียวพังต้องไม่ทำให้เปิดไฟล์ไม่สำเร็จทั้งไฟล์').toBeEnabled();
  const list = await sheetList(page);
  expect(list.map(s => s.name)).toEqual([XFRM, "X'FRM เก่า", 'อีกชีตที่ห้ามแตะ']);
  expect(list[1].checked, 'ชีตที่อ่านไม่ได้ต้องไม่ถูกติ๊ก').toBe(false);
  expect(list[1].text, 'ต้องบอกว่าอ่านชีตนี้ไม่ได้ ไม่ใช่เงียบ').toContain('อ่านชีตนี้ไม่ได้');
  expect(errors, 'ต้องไม่มี error หลุดขึ้น console').toEqual([]);

  await page.click('#btnCallInScan');
  await expect(page.locator('#callInPreviewPanel'),
    'ชีตที่ดีต้องยังเทียบได้ตามปกติ').toBeVisible();
  expect(await page.locator('#callInSummary').innerText()).toContain('เทียบจาก 1 ชีต');
});


/* ---------- สองชีตให้ค่าของใบเดียวกันไม่เท่ากัน (ผู้ตรวจ #146 รอบ 3 รันพิสูจน์) ----------
 *
 * 🚨 การยุบใบซ้ำเกิด "ก่อน" planCallIn() ค่าของชีตแรกจึงไม่เคยถูกเทียบเลย
 *    ก่อนการติ๊กหลายชีตต้องนำเข้าทีละชีต คนจึงเห็นหน้าผลเทียบของทุกชีต ของผิดในชีตแรกถูกเห็น
 *    ที่หายคือ **คำเตือน** ไม่ใช่ข้อมูลที่เก็บ (ค่าที่เก็บยังเท่ากับการนำเข้าทีละชีตตามลำดับ)
 * 🚨 ฉากนี้เอื้อมถึงวันนี้ — ใบซ้ำ 47 ใบของไฟล์ WK46 มาจากการที่เจ้าของก๊อปมาเอง
 *    ถ้าแถวที่ก๊อปค้างไว้เก่ากว่าชีตที่ Delta อัปเดตทีหลัง ค่าเก่าจะชนะ (ชีตท้ายชนะ)
 */

test('🚨 สองชีตให้ยอด Delta ของใบเดียวกันไม่เท่ากัน ต้องฟ้องพร้อมชื่อชีต ห้ามกลืนเงียบ', async ({ page }) => {
  /* ฉากที่ผู้ตรวจรัน — ยอดเรา 300 · ชีตแรก 50 · ชีตท้าย 300
     แถวที่รอดตรงกับยอดเราพอดี จอจึงขึ้น "ยอดไม่ตรงกัน 0 แถว" และตาราง "ไม่มีอะไรต้องเปลี่ยน"
     ทั้งที่ในไฟล์มีเลขสองตัวที่ขัดกันอยู่ */
  await openWith(page, [A1]);
  await openFile(page, {
    mainName: CHOKE, main: [row(A1, 50)],
    extra: [{ sheetName: XFRM, rows: [row(A1, 300)] }]
  });
  await page.click('#btnCallInScan');
  await expect(page.locator('#callInPreviewPanel')).toBeVisible();

  const flat = s => s.replace(/\s+/g, ' ');
  const sum = flat(await page.locator('#callInSummary').innerText());
  expect(sum, 'ต้องฟ้องว่าไฟล์ให้ค่าไม่เท่ากัน').toContain('ไม่เท่ากัน 1 ใบ');
  expect(sum, 'ต้องบอกชื่อชีตที่ขัดกัน เพื่อให้ไปเปิดดูได้').toContain(flat(CHOKE));
  expect(sum).toContain(XFRM);
  expect(sum, 'ต้องบอกว่าใช้ค่าของชีตไหน').toContain('ชีตท้ายสุด');
});

test('🚨 PO QTY ที่ไม่ตรงกับยอดสั่ง ถ้าอยู่ในชีตแรก ต้องยังมีอะไรฟ้อง', async ({ page }) => {
  /* คำเตือน PO QTY ของ planCallIn() หายไปเลยเมื่อของผิดอยู่ในชีตแรก เพราะแถวนั้นถูกยุบทิ้งก่อน
     โค้ดเขียนเองว่าข้อนี้ "ร้ายแรงกว่ายอดค้างไม่ตรง ต้องหาว่าฝั่งไหนถูก"
     แถบค่าไม่เท่ากันคือสิ่งที่ปิดรูนี้ — ไม่ได้เอาคำเตือนเดิมกลับมา แต่ชี้ไปที่ใบและชีตที่ต้องดู */
  await openWith(page, [A1]);
  await openFile(page, {
    mainName: CHOKE, main: [{ ...row(A1, 1170), qty: 999 }],
    extra: [{ sheetName: XFRM, rows: [row(A1, 1170)] }]
  });
  await page.click('#btnCallInScan');
  const sum = await page.locator('#callInSummary').innerText();
  expect(sum, 'PO QTY ของสองชีตไม่เท่ากัน ต้องไม่เงียบ').toContain('ไม่เท่ากัน 1 ใบ');
});

test('ค่าตรงกันทุกชีต ต้องไม่ฟ้อง — ไฟล์ WK46 ของจริงเป็นแบบนี้ทั้ง 47 ใบ', async ({ page }) => {
  /* คู่กับสองข้อข้างบน · แถบที่ขึ้นทุกสัปดาห์คือแถบที่ไม่มีใครอ่าน */
  await openWith(page, [A1, A2]);
  await openFile(page, {
    mainName: CHOKE, main: [row(A1, 1170)],
    extra: [{ sheetName: XFRM, rows: [row(A1, 1170), row(A2, 222)] }]
  });
  await page.click('#btnCallInScan');
  const sum = await page.locator('#callInSummary').innerText();
  expect(sum, 'ใบซ้ำที่ค่าตรงกันต้องไม่ถูกฟ้อง').not.toContain('ไม่เท่ากัน');
  expect(sum, 'แต่ยังต้องบอกว่ามีใบซ้ำ').toContain('ใบที่อยู่หลายชีต 1 ใบ');
});

test('ใบเดียวอยู่สามชีต ต้องนับเป็น 1 ใบ ไม่ใช่ 2 — เลขนี้เป็นจำนวน "ใบ" ไม่ใช่ "แถวที่ยุบ"', async ({ page }) => {
  await openWith(page, [A1]);
  await openFile(page, {
    mainName: CHOKE, main: [row(A1, 1170)],
    extra: [{ sheetName: XFRM, rows: [row(A1, 1170)] },
             { sheetName: 'Choke 2  WK46', rows: [row(A1, 1170)] }]
  });
  await page.click('#btnCallInScan');
  const sum = await page.locator('#callInSummary').innerText();
  expect(sum).toContain('เทียบจาก 3 ชีต');
  expect(sum, 'สูตรเดิม (ผลรวมแถว − จำนวนใบ) ได้ 2 ซึ่งเป็นจำนวนแถวที่ถูกยุบ ไม่ใช่จำนวนใบ')
    .toContain('ใบที่อยู่หลายชีต 1 ใบ');
});

test('แถวซ้ำใน "ชีตเดียวกัน" ไม่ใช่ใบที่อยู่หลายชีต — ติ๊กชีตเดียวต้องไม่ขึ้นเลขนี้', async ({ page }) => {
  /* ของจริงเกิดได้เมื่อ Delta ใส่ใบเดียวกันสองแถวในชีตเดียว
     สูตรเดิมทำให้ขึ้น "เทียบจาก 1 ชีต … อยู่หลายชีต 1 ใบ" ซึ่งอ่านไม่ได้ความ */
  await openWith(page, [A1]);
  await openFile(page, { mainName: XFRM, main: [row(A1, 50), row(A1, 1170)], extra: [] });
  await page.evaluate(() => document.querySelectorAll('#callInSheets input')
    .forEach((b, i) => { b.checked = i === 0; }));
  await page.click('#btnCallInScan');
  const sum = await page.locator('#callInSummary').innerText();
  expect(sum).toContain('เทียบจาก 1 ชีต');
  expect(sum, 'ชีตเดียวจะ "อยู่หลายชีต" ไม่ได้').not.toContain('อยู่หลายชีต');
  expect(sum, 'แต่สองแถวที่ขัดกันในชีตเดียวกันยังต้องฟ้อง').toContain('ไม่เท่ากัน 1 ใบ');
});
