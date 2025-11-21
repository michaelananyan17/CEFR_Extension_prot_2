// Background service worker
chrome.runtime.onInstalled.addListener(() => {
    console.log('Text Level Rewriter extension installed');
});

// Handle API requests if needed
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'openaiRequest') {
        // Could handle API requests here for additional security
        sendResponse({ success: true });
    }
});