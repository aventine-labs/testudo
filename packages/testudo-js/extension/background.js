/**
 * @aventine/testudo - Side-Loaded MV3 Assistive Bridge Service Worker (background.js)
 *
 * Connects outbound to ws://127.0.0.1:3851 (TestudoAssistiveBridge) so local Node workflows
 * can attach to existing open tabs in-place without reloading, open isolated background tab
 * groups without stealing focus, and pause/resume on CAPTCHA or 2FA challenges.
 */

const DEFAULT_BRIDGE_PORT = 3851;
const KEEPALIVE_ALARM = 'testudo-bridge-keepalive';
const attachedTabIds = new Set();
const focusOnChallengeTabs = new Set();
const debuggerAttachedTabIds = new Set();

let ws = null;
let reconnectTimer = null;

function detachAllDebuggers() {
  if (!chrome.debugger || typeof chrome.debugger.detach !== 'function') {
    debuggerAttachedTabIds.clear();
    return;
  }
  for (const tabId of Array.from(debuggerAttachedTabIds)) {
    debuggerAttachedTabIds.delete(tabId);
    chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

function sanitizeChallengeDetail(rawDetail) {
  if (!rawDetail || typeof rawDetail !== 'object') {
    return {};
  }
  const safe = {};
  if (typeof rawDetail.challengeType === 'string') {
    safe.challengeType = rawDetail.challengeType.slice(0, 128);
  }
  if (typeof rawDetail.selector === 'string') {
    safe.selector = rawDetail.selector.slice(0, 256);
  }
  if (typeof rawDetail.reason === 'string') {
    safe.reason = rawDetail.reason.slice(0, 512);
  }
  return safe;
}

async function resolveBridgeWsUrl() {
  let port = DEFAULT_BRIDGE_PORT;
  let token = '';
  try {
    if (chrome.storage && chrome.storage.local) {
      const cfg = await chrome.storage.local.get(['bridgePort', 'bridgeToken']);
      if (cfg && Number.isInteger(cfg.bridgePort) && cfg.bridgePort > 0 && cfg.bridgePort <= 65535) {
        port = cfg.bridgePort;
      }
      if (cfg && typeof cfg.bridgeToken === 'string') {
        token = cfg.bridgeToken.trim();
      }
    }
  } catch {
    // ignore storage lookup errors
  }
  if (!token) {
    return null;
  }
  return `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`;
}

async function connectBridge() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const wsUrl = await resolveBridgeWsUrl();
  if (!wsUrl) {
    scheduleReconnect();
    return;
  }

  try {
    ws = new WebSocket(wsUrl);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    try {
      ws.send(
        JSON.stringify({
          type: 'event',
          event: 'extension-ready',
          payload: { timestamp: new Date().toISOString(), version: '0.6.0' }
        })
      );
    } catch {
      // ignore
    }
  };

  ws.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (typeof msg.id !== 'number' || !msg.command) {
      return;
    }

    try {
      const result = await handleCommand(msg.command, msg.params || {});
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id: msg.id, result }));
      }
    } catch (err) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            id: msg.id,
            error: err && err.message ? err.message : String(err)
          })
        );
      }
    }
  };

  ws.onclose = () => {
    ws = null;
    detachAllDebuggers();
    scheduleReconnect();
  };

  ws.onerror = () => {
    try {
      if (ws) ws.close();
    } catch {
      // ignore
    }
    ws = null;
    detachAllDebuggers();
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectBridge();
  }, 2500);
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const tab = await chrome.tabs.get(tabId);
  if (tab && tab.status === 'complete') return tab;

  return new Promise((resolve) => {
    const timer = setTimeout(async () => {
      chrome.tabs.onUpdated.removeListener(listener);
      const current = await chrome.tabs.get(tabId).catch(() => tab);
      resolve(current);
    }, timeoutMs);

    function listener(updatedTabId, changeInfo, updatedTab) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(updatedTab);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function injectTestudoIntoTab(tabId, options = {}) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    files: ['testudo.iife.js']
  });

  if (options.mountWidget) {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        if (window.$T && typeof window.$T.mountWidget === 'function') {
          window.$T.mountWidget({ initialOpen: false });
        }
      }
    });
  }
}

function registerManagedTab(tabId, focusOnChallenge = true) {
  if (!Number.isInteger(tabId)) return;
  attachedTabIds.add(tabId);
  if (focusOnChallenge) {
    focusOnChallengeTabs.add(tabId);
  } else {
    focusOnChallengeTabs.delete(tabId);
  }
}

async function handleCommand(command, params) {
  switch (command) {
    case 'LIST_TABS': {
      const tabs = await chrome.tabs.query({});
      return tabs.map((t) => ({
        id: t.id,
        windowId: t.windowId,
        title: t.title || '',
        url: t.url || '',
        active: Boolean(t.active),
        groupId: t.groupId,
        status: t.status
      }));
    }

    case 'INJECT_TAB_NO_RELOAD': {
      const tabId = Number(params.tabId);
      const tab = await chrome.tabs.get(tabId);
      registerManagedTab(tabId, params.focusOnChallenge !== false);
      await injectTestudoIntoTab(tabId, { mountWidget: params.mountWidget });
      return {
        tabId,
        url: tab.url || '',
        title: tab.title || '',
        reloaded: false,
        injected: true
      };
    }

    case 'INJECT_ISOLATED_PROBE': {
      const tabId = Number(params.tabId);
      const tab = await chrome.tabs.get(tabId);
      registerManagedTab(tabId, false);
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'ISOLATED',
        func: (nonce) => {
          const safeN = String(nonce || '').slice(0, 64);
          return { isolatedWorldReady: true, nonceLen: safeN.length, href: location.href };
        },
        args: [String(params.nonce || '')]
      });
      return {
        tabId,
        url: tab.url || '',
        world: 'ISOLATED',
        mainWorldPolluted: false
      };
    }

    case 'RELOAD_AND_INJECT_TAB': {
      const tabId = Number(params.tabId);
      registerManagedTab(tabId, params.focusOnChallenge !== false);
      await chrome.tabs.reload(tabId);
      const updatedTab = await waitForTabComplete(tabId, params.timeoutMs || 15000);
      await injectTestudoIntoTab(tabId, { mountWidget: params.mountWidget });
      return {
        tabId,
        url: updatedTab?.url || '',
        title: updatedTab?.title || '',
        reloaded: true,
        injected: true
      };
    }

    case 'OPEN_BACKGROUND_TAB_GROUP': {
      const created = await chrome.tabs.create({
        url: params.url || 'about:blank',
        active: Boolean(params.active ?? false)
      });
      const tabId = created.id;
      registerManagedTab(tabId, Boolean(params.focusOnChallenge ?? false));
      let groupId;

      if (chrome.tabs.group && chrome.tabGroups) {
        try {
          const groupTitle = params.groupTitle || '[Testudo Agent]';
          const existingGroups = await chrome.tabGroups.query({
            windowId: created.windowId,
            title: groupTitle
          });
          if (existingGroups && existingGroups.length > 0) {
            groupId = await chrome.tabs.group({ groupId: existingGroups[0].id, tabIds: [tabId] });
          } else {
            groupId = await chrome.tabs.group({ tabIds: [tabId] });
            await chrome.tabGroups.update(groupId, {
              title: groupTitle,
              color: params.groupColor || 'orange',
              collapsed: Boolean(params.collapsed ?? true)
            });
          }
        } catch {
          // tabGroups API may be unavailable on some window types
        }
      }

      const loadedTab = await waitForTabComplete(tabId, params.timeoutMs || 15000);
      if (params.injectTestudo !== false) {
        await injectTestudoIntoTab(tabId, { mountWidget: params.mountWidget }).catch(() => {});
      }

      return {
        tabId,
        groupId,
        url: loadedTab?.url || params.url
      };
    }

    case 'EVALUATE_TESTUDO': {
      const tabId = Number(params.tabId);
      registerManagedTab(tabId, params.focusOnChallenge !== false);
      await injectTestudoIntoTab(tabId).catch(() => {});
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (expr) => {
          const fn = new Function(`return (${expr});`);
          return await fn();
        },
        args: [String(params.expression)]
      });
      return results && results[0] ? results[0].result : undefined;
    }

    case 'RUN_WORKFLOW': {
      const tabId = Number(params.tabId);
      registerManagedTab(tabId, params.focusOnChallenge !== false);
      await injectTestudoIntoTab(tabId);
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (wfName, wfSteps, wfOptions) => {
          if (!window.$T || typeof window.$T.workflow !== 'function') {
            throw new Error('[Testudo] window.$T.workflow is not available in tab');
          }
          return await window.$T.workflow(wfName, wfSteps).run(wfOptions || {});
        },
        args: [params.name || 'assistive-workflow', params.steps || [], params.options || {}]
      });
      return results && results[0] ? results[0].result : null;
    }

    case 'CLOSE_TAB': {
      const tabId = Number(params.tabId);
      attachedTabIds.delete(tabId);
      focusOnChallengeTabs.delete(tabId);
      if (debuggerAttachedTabIds.has(tabId) && chrome.debugger) {
        debuggerAttachedTabIds.delete(tabId);
        await chrome.debugger.detach({ tabId }).catch(() => {});
      }
      await chrome.tabs.remove(tabId);
      return { closed: true, tabId };
    }

    case 'ATTACH_DEBUGGER': {
      const tabId = Number(params.tabId);
      if (!chrome.debugger || typeof chrome.debugger.attach !== 'function') {
        throw new Error('[Testudo Extension] chrome.debugger API is unavailable');
      }
      if (!debuggerAttachedTabIds.has(tabId)) {
        await chrome.debugger.attach({ tabId }, String(params.protocolVersion || '1.3'));
        debuggerAttachedTabIds.add(tabId);
      }
      registerManagedTab(tabId, params.focusOnChallenge !== false);
      return { attached: true, tabId, protocolVersion: String(params.protocolVersion || '1.3') };
    }

    case 'SEND_CDP_COMMAND': {
      const tabId = Number(params.tabId);
      const method = String(params.method || '');
      if (!method) {
        throw new Error('[Testudo Extension] SEND_CDP_COMMAND requires a non-empty method');
      }
      if (!chrome.debugger || typeof chrome.debugger.sendCommand !== 'function') {
        throw new Error('[Testudo Extension] chrome.debugger API is unavailable');
      }
      const autoDetach = Boolean(params.autoDetach);
      let attachedHere = false;
      if (!debuggerAttachedTabIds.has(tabId)) {
        await chrome.debugger.attach({ tabId }, '1.3');
        debuggerAttachedTabIds.add(tabId);
        attachedHere = true;
      }
      try {
        const cdpRes = await chrome.debugger.sendCommand({ tabId }, method, params.commandParams || {});
        return cdpRes ?? {};
      } finally {
        if (autoDetach && attachedHere) {
          debuggerAttachedTabIds.delete(tabId);
          await chrome.debugger.detach({ tabId }).catch(() => {});
        }
      }
    }

    case 'DETACH_DEBUGGER': {
      const tabId = Number(params.tabId);
      debuggerAttachedTabIds.delete(tabId);
      if (chrome.debugger && typeof chrome.debugger.detach === 'function') {
        await chrome.debugger.detach({ tabId }).catch(() => {});
      }
      return { detached: true, tabId };
    }

    default:
      throw new Error(`[Testudo Extension] Unknown command: ${command}`);
  }
}

if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    attachedTabIds.delete(tabId);
    focusOnChallengeTabs.delete(tabId);
    debuggerAttachedTabIds.delete(tabId);
  });
}

if (chrome.debugger && chrome.debugger.onDetach) {
  chrome.debugger.onDetach.addListener((source) => {
    if (source && typeof source.tabId === 'number') {
      debuggerAttachedTabIds.delete(source.tabId);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;
  const tabId = sender.tab ? sender.tab.id : undefined;
  if (tabId === undefined || !attachedTabIds.has(tabId)) {
    return false;
  }

  const safeDetail = sanitizeChallengeDetail(message.detail);

  if (message.type === 'testudo:human-assist-required') {
    if (focusOnChallengeTabs.has(tabId)) {
      chrome.tabs.update(tabId, { active: true }).catch(() => {});
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'event',
          event: 'human-assist-required',
          payload: {
            ...safeDetail,
            tabId,
            url: sender.tab ? sender.tab.url : ''
          }
        })
      );
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'testudo:human-assist-resolved') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'event',
          event: 'human-assist-resolved',
          payload: {
            ...safeDetail,
            tabId,
            url: sender.tab ? sender.tab.url : ''
          }
        })
      );
    }
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

if (chrome.alarms) {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEPALIVE_ALARM) {
      connectBridge();
    }
  });
}

connectBridge();
