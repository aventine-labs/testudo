/**
 * @aventine/testudo - Content Script Event Relay (content.js)
 *
 * Bridges custom DOM events dispatched by Sir Testudo ($T.concierge) in the MAIN world
 * ("testudo:human-assist-required" and "testudo:human-assist-resolved") back to the
 * MV3 background service worker and local Node.js TestudoAssistiveBridge.
 */

(function initTestudoContentRelay() {
  if (window.__TESTUDO_CONTENT_RELAY_INSTALLED__) return;
  window.__TESTUDO_CONTENT_RELAY_INSTALLED__ = true;

  function pickSafeDetail(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const safe = {};
    if (typeof raw.challengeType === 'string') safe.challengeType = raw.challengeType.slice(0, 128);
    if (typeof raw.selector === 'string') safe.selector = raw.selector.slice(0, 256);
    if (typeof raw.reason === 'string') safe.reason = raw.reason.slice(0, 512);
    return safe;
  }

  window.addEventListener('testudo:human-assist-required', (event) => {
    try {
      const detail = pickSafeDetail(event && event.detail);
      chrome.runtime.sendMessage({
        type: 'testudo:human-assist-required',
        detail
      });
    } catch {
      // ignore if extension context invalidated
    }
  });

  window.addEventListener('testudo:human-assist-resolved', (event) => {
    try {
      const detail = pickSafeDetail(event && event.detail);
      chrome.runtime.sendMessage({
        type: 'testudo:human-assist-resolved',
        detail
      });
    } catch {
      // ignore if extension context invalidated
    }
  });
})();
