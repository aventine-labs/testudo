import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  testudo,
  concierge,
  getLauncherIconSvg,
  SIR_TESTUDO_PORTRAIT_SVG,
  MAGIC_CURSOR_SVG,
  HELP_ICON_SVG
} from '../dist/index.js';

describe('Sir Testudo Launcher, Magic Cursor & Configurable Attribution Suite', () => {
  it('defaults to launcher: "mascot" and attribution: true out of the box', () => {
    const cfg = testudo.init();
    assert.equal(cfg.launcher, 'mascot');
    assert.equal(cfg.attribution, true);
    assert.equal(cfg.mascotName, 'Sir Testudo');
    assert.match(concierge.getAttributionText(), /Powered by Testudo-JS · Aventine Labs/);
    assert.match(concierge.getAttributionHtml(), /https:\/\/github\.com\/aventine-labs\/testudo/);
  });

  it('supports switching launcher icon between mascot, magic-cursor, and help and allows attribution: false', () => {
    assert.equal(getLauncherIconSvg('mascot'), SIR_TESTUDO_PORTRAIT_SVG);
    assert.equal(getLauncherIconSvg('magic-cursor'), MAGIC_CURSOR_SVG);
    assert.equal(getLauncherIconSvg('help'), HELP_ICON_SVG);

    const customCfg = testudo.init({ launcher: 'magic-cursor', attribution: false });
    assert.equal(customCfg.launcher, 'magic-cursor');
    assert.equal(customCfg.attribution, false);
    assert.equal(concierge.getAttributionText(), '');
    assert.equal(concierge.getAttributionHtml(), '');

    // Reset back to default
    testudo.init({ launcher: 'mascot', attribution: true });
  });

  it('explains documented elements, admits undocumented elements, and triggers the 50-contract CLUNK Easter egg', () => {
    // 1. Documented element
    const docEl = {
      tagName: 'BUTTON',
      innerText: 'BUY MKT',
      getAttribute: (attr) => {
        if (attr === 'data-testudo-title') return 'Market Buy Button';
        if (attr === 'data-testudo-help') return 'Submits an immediate market buy order against bestAsk.';
        if (attr === 'data-demo-id') return 'order-buy-btn';
        return null;
      }
    };
    const docExpl = concierge.explainElement(docEl);
    assert.equal(docExpl.isDocumented, true);
    assert.equal(docExpl.title, 'Market Buy Button');
    assert.match(docExpl.quip, /Unlike the developer, I actually documented this control/);

    // 2. Undocumented element
    const undocEl = {
      tagName: 'DIV',
      innerText: 'Mystery Widget',
      getAttribute: () => null
    };
    const undocExpl = concierge.explainElement(undocEl);
    assert.equal(undocExpl.isDocumented, false);
    assert.match(undocExpl.quip, /Apparently the developer has not explained that one/);

    // 3. 50-Contract Combine Risk Guard Easter Egg
    const fiftyEl = {
      tagName: 'BUTTON',
      innerText: '50 Contracts',
      getAttribute: (attr) => (attr === 'data-demo-id' ? 'qty-50-btn' : null)
    };
    const fiftyExpl = concierge.explainElement(fiftyEl);
    assert.equal(fiftyExpl.isRiskLimitEasterEgg, true);
    assert.match(fiftyExpl.quip, /CLUNK/);
  });

  it('resolves structured liveReadings via getLiveReading callback and data-testudo-prereq', () => {
    const domEl = {
      tagName: 'DIV',
      innerText: 'DOM Ladder',
      getAttribute: (attr) => {
        if (attr === 'data-demo-id') return 'dom-best-bid-cell';
        if (attr === 'data-testudo-title') return 'CME L3 FIFO DOM Ladder';
        if (attr === 'data-testudo-prereq') return '[data-demo-id="header-chip-ESZ6"]';
        return null;
      }
    };
    const expl = concierge.explainElement(domEl, () => [
      { label: 'Micro-Price', value: '$5,981.18' },
      { label: 'Best Bid Queue', value: '91 contracts' }
    ]);
    assert.equal(expl.isDocumented, true);
    assert.equal(expl.prereqSelector, '[data-demo-id="header-chip-ESZ6"]');
    assert.equal(expl.liveReadings.length, 2);
    assert.deepEqual(expl.liveReadings[0], { label: 'Micro-Price', value: '$5,981.18' });
    assert.deepEqual(expl.liveReadings[1], { label: 'Best Bid Queue', value: '91 contracts' });
  });

  it('blocks sensitive DOM elements in isSensitiveDomNode (passwords, hidden inputs, data-sensitive, cc-number)', () => {
    const mkNode = (attrs) => ({
      getAttribute: (k) => attrs[k] || null
    });
    assert.equal(concierge.isSensitiveDomNode(mkNode({ type: 'password' })), true);
    assert.equal(concierge.isSensitiveDomNode(mkNode({ type: 'hidden' })), true);
    assert.equal(concierge.isSensitiveDomNode(mkNode({ 'data-sensitive': 'true' })), true);
    assert.equal(concierge.isSensitiveDomNode(mkNode({ 'data-testudo-ignore': 'true' })), true);
    assert.equal(concierge.isSensitiveDomNode(mkNode({ autocomplete: 'cc-number' })), true);
    assert.equal(concierge.isSensitiveDomNode(mkNode({ id: 'safe-price-badge' })), false);
  });
});


