// Run after npm run build. Uses installed Chrome; set PLAYWRIGHT_BROWSER=chromium
// to use a Playwright-managed Chromium installation instead.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const port = 14175;
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['scripts/serve.mjs'], {
  env: { ...process.env, PORT: String(port), LLM_API_KEY: '', MAIA_API_URL: '' },
  stdio: 'ignore',
});
let browser;
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (server.exitCode !== null) throw new Error('UI test server could not start');
    try { if ((await fetch(`${url}/api/health`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForSelector('.sq');
  assert.equal(await page.locator('.sq').count(), 64);
  assert.equal(await page.locator('html').getAttribute('data-board-style'), 'chalkboard', 'Fresh sessions default to Chalkboard');

  for (const [width, height] of [[1920,1080], [1728,900], [1512,820], [1440,700], [1440,1100], [1180,820], [1366,1024], [400,850], [320,700]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100);
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      actions: document.querySelector('#boardActions').getBoundingClientRect().toJSON(),
      ask: document.querySelector('#askForm').getBoundingClientRect().toJSON(),
      board: document.querySelector('.board-frame').getBoundingClientRect().toJSON(),
      panel: document.querySelector('#coachPanel').getBoundingClientRect().toJSON(),
    }));
    assert.ok(dimensions.width <= width, `No horizontal overflow at ${width}px`);
    if (width >= 900) assert.ok(dimensions.board.width > dimensions.panel.width, 'Board dominates the layout');
    if (width > 1400) {
      assert.ok(dimensions.height <= height + 1, `Desktop fits vertically at ${width}×${height}`);
      assert.ok(dimensions.actions.bottom <= height, 'Desktop game controls stay in view');
      assert.ok(dimensions.ask.bottom <= height, 'Desktop ask box stays in view');
    }
    if (width === 1180 || width === 1366) {
      assert.ok(dimensions.panel.y < 30 && dimensions.panel.bottom <= height + 1, 'Tablet panel fits the viewport');
      assert.ok(dimensions.board.bottom <= height, 'Tablet board fits the viewport');
    }
  }

  await page.setViewportSize({ width: 1180, height: 820 });
  await page.locator('.sq[data-sq=e2]').click();
  await page.locator('.sq[data-sq=e4]').click();
  await page.waitForFunction(() => document.querySelector('#coachCardMove').textContent);
  await page.waitForTimeout(800);
  const savedGame = await page.evaluate(() => localStorage.getItem('chesscoach.v1'));
  await page.locator('#settingsBtn').click();
  await page.locator('#colorSel').selectOption('b');
  await page.locator('#levelSel').selectOption('club');
  await page.locator('[data-layout-choice=board]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('chesscoach.v1')), savedGame);
  assert.match(await page.locator('#matchSummary').textContent(), /Beginner/);
  await page.locator('#settingsCloseBtn').click();
  await page.locator('#openCoachBtn').click();
  assert.equal(await page.locator('#coachPanel').getAttribute('aria-modal'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#coachPanel').isVisible(), false);

  await page.setViewportSize({ width: 400, height: 850 });
  await page.locator('#openCoachBtn').click();
  assert.ok((await page.locator('#coachPanel').boundingBox()).y > 0, 'Phone coach opens as a bottom sheet');
  await page.locator('#closeCoachBtn').click();
  await page.locator('#settingsBtn').click();
  for (const style of ['classic','aether','neon','wildwood','spell','chalkboard']) {
    await page.locator(`[data-board-choice=${style}]`).click();
    for (const theme of ['light','dark','system']) {
      await page.locator(`[data-theme-choice=${theme}]`).click();
      assert.equal(await page.locator('html').getAttribute('data-board-style'), style);
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme === 'system' ? null : theme);
    }
    await page.waitForTimeout(100);
    assert.equal(await page.locator('html').getAttribute('data-board-style'), style, 'Theme artwork loaded');
  }
  await page.locator('#settingsCloseBtn').click();
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-layout'), 'board');
  assert.equal(await page.locator('html').getAttribute('data-board-style'), 'chalkboard');
  await page.locator('#tabLessons').click();
  assert.equal(await page.locator('#lessonPanel').isVisible(), true);
  assert.equal(await page.locator('#coachPanelTitle').innerText(), 'Lessons');
  await page.locator('#closeCoachBtn').click();
  assert.equal(await page.locator('#openCoachBtn').innerText(), 'Lesson details');
  await page.locator('#lessonDetailsBtn').click();
  assert.equal(await page.locator('#lessonPanel').isVisible(), true, 'Board button reopens lesson drawer');
  await page.locator('#closeCoachBtn').click();
  await page.locator('#tabLessons').click();
  assert.equal(await page.locator('#lessonPanel').isVisible(), true, 'Active Lessons tab reopens drawer');
  await page.locator('#closeCoachBtn').click();
  await page.locator('#openCoachBtn').click();
  assert.equal(await page.locator('#lessonPanel').isVisible(), true, 'Floating Lesson details button reopens drawer');

  assert.equal(await page.locator('#lessonList').isVisible(), false, 'Lesson catalog stays out of the practice sidebar');
  await page.locator('#chooseLessonBtn').click();
  assert.equal(await page.locator('#lessonBrowser').isVisible(), true);
  assert.equal(await page.locator('#lessonList .lesson').count(), 24);
  assert.equal(await page.locator('#lessonList').evaluate(el => getComputedStyle(el).overflowY), 'visible', 'Catalog has no nested scroller');
  await page.locator('#lessonFilters').getByRole('button', { name: 'Tactics', exact: true }).click();
  await page.locator('#lessonList').getByRole('button', { name: /Knight fork/ }).click();
  assert.equal(await page.locator('#lessonBrowser').isVisible(), false);
  assert.equal(await page.locator('#lessonTitle').innerText(), 'Knight fork');
  assert.equal(await page.locator('#log').innerText(), '', 'Instructions are not duplicated in the feed');
  await page.locator('#lHint').click();
  assert.match(await page.locator('#log').innerText(), /Knights/);
  await page.locator('#chooseLessonBtn').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#lessonBrowser').isVisible(), false);
  await page.locator('#chooseLessonBtn').click();
  await page.locator('#lessonFilters').getByRole('button', { name: 'All', exact: true }).click();
  await page.locator('#lessonList').getByRole('button', { name: /Back-rank mate/ }).click();
  await page.locator('#lReveal').click();
  assert.equal(await page.locator('#lessonTitle').innerText(), 'Back-rank mate');
  await page.locator('#closeCoachBtn').click();
  await page.locator('#tabPlay').click();
  assert.match(await page.locator('#sheet').innerText(), /e4/);

  await page.locator('#moreActions summary').click();
  await page.locator('#resignBtn').click();
  await page.locator('#cancelResignBtn').click();
  assert.doesNotMatch(await page.locator('#statusText').innerText(), /resigned/);
  await page.locator('#resignBtn').click();
  await page.locator('#confirmResignBtn').click();
  assert.match(await page.locator('#statusText').innerText(), /resigned/);
  await page.reload();
  assert.match(await page.locator('#statusText').innerText(), /resigned/);
  await page.locator('#settingsBtn').click();
  await page.locator('[data-layout-choice=coach]').click();
  await page.locator('[data-board-choice=classic]').click();
  await page.locator('#colorSel').selectOption('b');
  await page.locator('#settingsDoneBtn').click();
  await page.locator('#settingsBtn').click();
  assert.equal(await page.locator('#colorSel').inputValue(), 'b', 'Pending game options survive reopening settings');
  await page.locator('#settingsDoneBtn').click();
  await page.locator('#newTopBtn').click();
  assert.equal(await page.locator('#settingsBackdrop').isVisible(), false, 'New game starts without opening settings');
  assert.equal(await page.locator('#newBtn').count(), 0, 'No duplicate new-game action in settings');
  assert.equal(await page.locator('.sq').first().getAttribute('data-sq'), 'h1');
  assert.doesNotMatch(await page.locator('#statusText').innerText(), /resigned/);

  // A long bishop arrow must remain above the lower ranks, whose piece sprites
  // have increasing z-indices. Hit-test the visible arrowhead with SVG pointer
  // events temporarily enabled, without changing any stacking styles.
  const arrowPage = await browser.newPage();
  await arrowPage.addInitScript(() => {
    localStorage.setItem('chesscoach.v1', JSON.stringify({
      pgn: '1. e4 d6 2. d4 Nf6 3. Nc3 Bg4', player: 'w',
    }));
  });
  await arrowPage.goto(url);
  await arrowPage.waitForSelector('#moveArrow polygon');
  const arrowOnTop = await arrowPage.evaluate(() => {
    const svg = document.querySelector('#moveArrow');
    const head = svg.querySelector('polygon');
    const points = [...head.points];
    const center = new DOMPoint(
      points.reduce((sum, p) => sum + p.x, 0) / points.length,
      points.reduce((sum, p) => sum + p.y, 0) / points.length,
    ).matrixTransform(svg.getScreenCTM());
    svg.style.pointerEvents = 'auto';
    const top = document.elementFromPoint(center.x, center.y);
    svg.style.removeProperty('pointer-events');
    return top === head;
  });
  assert.ok(arrowOnTop, 'Long move arrowhead paints above every board rank');

  const savedStylePage = await browser.newPage();
  await savedStylePage.addInitScript(() => localStorage.setItem('chesscoach.boardStyle', 'classic'));
  await savedStylePage.goto(url);
  await savedStylePage.waitForSelector('.sq');
  assert.equal(await savedStylePage.locator('html').getAttribute('data-board-style'), 'classic', 'Existing style preferences override the new default');

  const togetherPage = await browser.newPage({ viewport: { width: 393, height: 852 } });
  togetherPage.on('pageerror', error => errors.push(error.message));
  let automaticAnalysis = 0;
  await togetherPage.route('**/api/analyze', route => { automaticAnalysis++; return route.abort(); });
  await togetherPage.goto(url);
  await togetherPage.locator('#tabTogether').click();
  assert.equal(await togetherPage.locator('#togetherSetup').isVisible(), true);
  assert.equal(await togetherPage.locator('#togetherOrientation').inputValue(), 'fixed');
  await togetherPage.locator('#togetherForm button[type=submit]').click();
  const playTogetherMove = async (from,to) => {
    await togetherPage.locator(`.sq[data-sq=${from}]`).click();
    await togetherPage.locator(`.sq[data-sq=${to}]`).click();
  };
  await playTogetherMove('e2','e4');
  assert.match(await togetherPage.locator('#statusText').innerText(), /Oliver/);
  assert.equal(await togetherPage.locator('.sq').first().getAttribute('data-sq'), 'a8');
  assert.equal(await togetherPage.locator('#hintBtn').isEnabled(), true);
  await playTogetherMove('e7','e5');
  assert.match(await togetherPage.locator('#statusText').innerText(), /Cory/);
  assert.equal(automaticAnalysis, 0, 'Neither human move triggers an engine opponent');
  await togetherPage.locator('#undoBtn').click();
  await togetherPage.locator('#declineUndo').click();
  assert.match(await togetherPage.locator('#sheet').innerText(), /e5/);
  await togetherPage.locator('#undoBtn').click();
  await togetherPage.locator('#approveUndo').click();
  assert.doesNotMatch(await togetherPage.locator('#sheet').innerText(), /e5/);
  await togetherPage.locator('#tabPlay').click();
  assert.match(await togetherPage.locator('#sheet').innerText(), /No moves/);
  await togetherPage.locator('#tabLessons').click();
  await togetherPage.locator('#tabTogether').click();
  assert.match(await togetherPage.locator('#sheet').innerText(), /e4/);
  await togetherPage.reload();
  assert.equal(await togetherPage.locator('#tabTogether').getAttribute('aria-selected'), 'true');
  assert.match(await togetherPage.locator('#sheet').innerText(), /e4/);
  await togetherPage.locator('#newTopBtn').click();
  await togetherPage.locator('#togetherOrientation').selectOption('flip');
  await togetherPage.locator('#togetherCoaching').selectOption('off');
  await togetherPage.locator('#togetherForm button[type=submit]').click();
  await playTogetherMove('f2','f3');
  assert.equal(await togetherPage.locator('.sq').first().getAttribute('data-sq'), 'h1');
  assert.equal(await togetherPage.locator('#hintBtn').isVisible(), false);
  assert.equal(await togetherPage.locator('#askForm').isVisible(), false);
  await playTogetherMove('e7','e5');
  await playTogetherMove('g2','g4');
  await playTogetherMove('d8','h4');
  assert.match(await togetherPage.locator('#statusText').innerText(), /Checkmate.*Oliver wins/);
  assert.match(await togetherPage.evaluate(() => JSON.parse(localStorage.getItem('chesscoach.together')).game.pgn), /0-1/);
  await togetherPage.locator('#settingsBtn').click();
  assert.equal(await togetherPage.locator('#soloSettingsFields').isVisible(), false);
  await togetherPage.locator('#settingsTogetherBtn').click();
  await togetherPage.locator('#togetherCoaching').selectOption('learn');
  await togetherPage.locator('#swapNames').click();
  await togetherPage.locator('#togetherForm button[type=submit]').click();
  assert.match(await togetherPage.locator('#statusText').innerText(), /Oliver/);
  for (const [from,to] of [['f2','f3'],['e7','e5'],['g2','g4'],['d8','h4']]) await playTogetherMove(from,to);
  await togetherPage.locator('#reviewBtn').click();
  assert.match(await togetherPage.locator('#log').innerText(), /Local shared review.*Oliver.*Cory/s);
  await togetherPage.locator('#undoBtn').click();
  await togetherPage.locator('#approveUndo').click();
  await togetherPage.locator('#moreActions summary').click();
  await togetherPage.locator('#resignBtn').click();
  await togetherPage.locator('#confirmResignBtn').click();
  assert.match(await togetherPage.locator('#statusText').innerText(), /Cory resigned.*Oliver wins/);

  assert.equal(await togetherPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  // Finished games must still produce a review when the AI returns no answer.
  const reviewPage = await browser.newPage();
  await reviewPage.addInitScript(() => localStorage.setItem('chesscoach.v1', JSON.stringify({
    pgn: '1. f3 e5 2. g4 Qh4#', player: 'w', level: 'beginner', tier: 'deep', solved: [], moveGrades: [],
  })));
  await reviewPage.route('**/api/health', route => route.fulfill({ json: { status: 'ok', coach: 'akashml', model_configured: true } }));
  let reviewResponse = { status: 502, json: { error: 'empty_response' } };
  await reviewPage.route('**/api/coach', route => {
    const request = route.request().postDataJSON();
    assert.equal(request.purpose, 'review');
    assert.match(request.prompt, /Qh4#/);
    return route.fulfill(reviewResponse);
  });
  await reviewPage.goto(url);
  await reviewPage.waitForFunction(() => document.querySelector('#coachAvail').textContent.includes('AkashML'));
  for (const response of [
    { status: 502, json: { error: 'empty_response' } },
    { status: 502, json: { error: 'upstream_error' } },
    { status: 200, json: { text: '' } },
    { status: 200, json: { text: 'Protect your king before pushing flank pawns.' } },
  ]) {
    reviewResponse = response;
    await reviewPage.locator('#reviewBtn').click();
    await reviewPage.waitForFunction(() => !document.querySelector('#reviewBtn').disabled);
    const text = await reviewPage.locator('#log').innerText();
    assert.match(text, response.json.text ? /Protect your king/ : /Local review.*You played 2 moves/s);
    assert.doesNotMatch(text, /Thinking…|didn’t answer/);
  }

  // Finish the opening goals: the plan must continue and past turns must not
  // crowd the current position out of the panel.
  const longGame = await browser.newPage({ viewport: { width: 1512, height: 820 } });
  longGame.on('pageerror', error => errors.push(error.message));
  const replies = ['a7a6','h7h6','g7g6','a6a5','h6h5','c7c6','b8a6'];
  await longGame.route('**/api/analyze', route => route.fulfill({ json: {
    coachMove: replies.shift(), assessment: 'good', lossCp: 0,
  } }));
  await longGame.goto(url);
  await longGame.waitForFunction(() => document.querySelector('#coachAvail').textContent.includes('Stockfish analysis'));
  const moves = [['e2','e4'],['d2','d4'],['c1','e3'],['f1','d3'],['b1','c3'],['g1','f3'],['e1','g1']];
  for (const [index, [from,to]] of moves.entries()) {
    await longGame.locator(`.sq[data-sq=${from}]`).click();
    await longGame.locator(`.sq[data-sq=${to}]`).click();
    await longGame.waitForFunction(ply => document.querySelectorAll('.sheet-move').length === ply && !document.querySelector('#hintBtn').disabled, (index + 1) * 2);
  }
  assert.ok(await longGame.locator('#planList li').count() > 0, 'Plan continues after all opening goals are met');
  assert.ok(await longGame.locator('#historyLog .msg').count() >= 10);
  assert.equal(await longGame.locator('#coachHistory').getAttribute('open'), null);
  assert.equal(await longGame.locator('#log .turn-summary').count(), 0);
  await longGame.locator('#planList li').last().scrollIntoViewIfNeeded();
  assert.ok(await longGame.locator('#planPanel').evaluate(el => {
    const feed = document.querySelector('#coachFeed').getBoundingClientRect();
    const last = el.querySelector('li:last-child').getBoundingClientRect();
    return last.top >= feed.top && last.bottom <= feed.bottom + 1;
  }), 'Plan remains reachable inside the panel');
  await longGame.locator('#coachHistory summary').click();
  assert.equal(await longGame.locator('#historyLog').isVisible(), true);
  await longGame.locator('#hintBtn').click();
  assert.ok((await longGame.locator('#log').innerText()).includes('Can I have a hint?'));
  for (const width of [320, 393, 430]) {
    await longGame.setViewportSize({ width, height: 852 });
    const moves = await longGame.locator('#sheet').evaluate(el => {
      const children = [...el.children];
      return {
        scrolls: el.scrollWidth > el.clientWidth,
        fitsPage: document.documentElement.scrollWidth <= innerWidth,
        separated: children.every((child, i) => !i || child.getBoundingClientRect().left >= children[i - 1].getBoundingClientRect().right),
        unclipped: children.every(child => child.scrollWidth <= child.clientWidth + 1),
      };
    });
    assert.ok(moves.scrolls && moves.fitsPage, `Move list scrolls within phone width ${width}`);
    assert.ok(moves.separated && moves.unclipped, `Moves retain their full width at ${width}px`);
  }
  await longGame.setViewportSize({ width: 1180, height: 820 });
  assert.equal(await longGame.locator('#planPanel').isVisible(), true, 'Plan is also available on smaller iPads');

  const restartPage = await browser.newPage();
  restartPage.on('pageerror', error => errors.push(error.message));
  let releaseAnalysis;
  let analysisStarted;
  const started = new Promise(resolve => { analysisStarted = resolve; });
  const release = new Promise(resolve => { releaseAnalysis = resolve; });
  await restartPage.route('**/api/analyze', async route => {
    analysisStarted();
    await release;
    await route.fulfill({ json: { coachMove: 'e7e5', assessment: 'good', lossCp: 0 } });
  });
  await restartPage.goto(url);
  await restartPage.waitForFunction(() => document.querySelector('#coachAvail').textContent.includes('Stockfish analysis'));
  await restartPage.locator('.sq[data-sq=e2]').click();
  await restartPage.locator('.sq[data-sq=e4]').click();
  await started;
  await restartPage.locator('#newTopBtn').click();
  releaseAnalysis();
  await restartPage.waitForTimeout(500);
  assert.equal(await restartPage.locator('#settingsBackdrop').isVisible(), false);
  assert.match(await restartPage.locator('#sheet').innerText(), /No moves yet/);
  assert.equal(await restartPage.locator('.sq[data-sq=e2]').getAttribute('aria-label'), 'e2 white pawn');
  assert.match(await restartPage.locator('#statusText').innerText(), /Your move/);

  const fallback = await browser.newPage();
  await fallback.addInitScript(() => {
    localStorage.setItem('chesscoach.boardStyle', 'wildwood');
    Storage.prototype.getItem = function () { throw new Error('Storage unavailable'); };
    Storage.prototype.setItem = function () { throw new Error('Storage unavailable'); };
  });
  await fallback.goto(url);
  await fallback.waitForSelector('.sq');
  assert.equal(await fallback.locator('.sq').count(), 64, 'App works without storage');
  await fallback.route('**/board-styles/aether-*', route => route.abort());
  await fallback.locator('#settingsBtn').click();
  await fallback.locator('[data-board-choice=aether]').click();
  await fallback.waitForFunction(() => document.documentElement.dataset.boardStyle === 'classic');
  assert.deepEqual(errors, []);
  console.log('UI checks passed: responsive layouts, play, pending settings, themes, sheets, persistence, lessons, resignation, Black orientation, storage and image fallbacks.');
} finally {
  await browser?.close();
  server.kill();
  if (server.exitCode === null) await once(server, 'exit');
}
