"use strict";
(() => {
  // src/background.ts
  chrome.action.onClicked.addListener((tab) => {
    if (tab.windowId !== void 0) {
      chrome.sidePanel.open({ windowId: tab.windowId });
    }
  });
})();
