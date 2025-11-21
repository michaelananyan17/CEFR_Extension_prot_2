// Content script for text rewriting and summarization
let originalTexts = new Map();
let isRewritten = false;

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'rewritePage') {
        rewritePageContent(request.apiKey, request.targetLevel)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    
    if (request.action === 'summarizePage') {
        summarizePageContent(request.apiKey, request.targetLevel)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    
    if (request.action === 'resetPage') {
        resetPageContent();
        sendResponse({ success: true });
    }
});

// ========== REWRITE PAGE FUNCTIONALITY ==========

// Main function to rewrite page content
async function rewritePageContent(apiKey, targetLevel) {
    try {
        // Store original texts if not already stored
        if (!isRewritten) {
            storeOriginalTexts();
        }
        
        // Extract main content from the page
        const textContent = extractMainContent();
        
        if (!textContent.trim()) {
            throw new Error('No readable text content found on this page');
        }
        
        // Process text in chunks to handle large pages
        const rewrittenContent = await processTextChunks(textContent, targetLevel, apiKey, 'rewrite');
        
        // Replace the content on the page with proper text replacement
        replacePageContentWithRewrittenText(rewrittenContent);
        
        isRewritten = true;
        return { success: true, originalLength: textContent.length, newLength: rewrittenContent.length };
        
    } catch (error) {
        console.error('Content rewriting error:', error);
        return { success: false, error: error.message };
    }
}

// Process text in chunks for better rewriting
async function processTextChunks(text, targetLevel, apiKey, mode) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const chunks = [];
    let currentChunk = '';
    
    // Group sentences into chunks of 3-5 sentences each
    for (let i = 0; i < sentences.length; i++) {
        currentChunk += sentences[i] + '. ';
        if ((i + 1) % 4 === 0 || i === sentences.length - 1) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
        }
    }
    
    // Process each chunk
    const processedChunks = [];
    for (const chunk of chunks) {
        if (chunk.length > 50) { // Only process substantial chunks
            const processed = mode === 'rewrite' 
                ? await rewriteTextWithOpenAI(chunk, targetLevel, apiKey)
                : await summarizeTextWithOpenAI(chunk, targetLevel, apiKey);
            processedChunks.push(processed);
        } else {
            processedChunks.push(chunk);
        }
    }
    
    return processedChunks.join(' ');
}

// Enhanced text rewriting with better error handling
async function rewriteTextWithOpenAI(text, targetLevel, apiKey) {
    const prompt = `Rewrite the following text to match CEFR level ${targetLevel} English. 
    
IMPORTANT INSTRUCTIONS:
- Keep the exact same meaning and context
- Change only vocabulary and sentence structure to match ${targetLevel} level
- Maintain the original tone and style
- Return ONLY the rewritten text, no explanations

CEFR ${targetLevel} Guidelines: ${getLevelGuidelines(targetLevel)}

Original text: "${text}"

Rewritten text:`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a professional text rewriter that adapts content to specific CEFR English levels while preserving exact meaning.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: Math.min(2000, text.length * 2),
                temperature: 0.3 // Lower temperature for more consistent rewriting
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${errorData.error?.message || 'Unknown error'}`);
        }
        
        const data = await response.json();
        const rewrittenText = data.choices[0].message.content.trim();
        
        if (!rewrittenText) {
            throw new Error('OpenAI returned empty response');
        }
        
        return rewrittenText;
        
    } catch (error) {
        console.error('OpenAI API Error:', error);
        return text; // Return original text if API fails
    }
}

// Replace page content with rewritten text while preserving layout
function replacePageContentWithRewrittenText(rewrittenContent) {
    const paragraphs = rewrittenContent.split(/\n\n+/);
    let currentParagraph = 0;
    
    // Create smooth transition
    document.body.style.transition = 'opacity 0.3s ease';
    document.body.style.opacity = '0.8';
    
    setTimeout(() => {
        // Replace content in stored elements
        originalTexts.forEach((item, index) => {
            if (currentParagraph < paragraphs.length && item.originalText.length > 20) {
                const newText = paragraphs[currentParagraph] || paragraphs[paragraphs.length - 1];
                
                // Preserve HTML structure while replacing text content
                if (hasComplexHTML(item.originalHTML)) {
                    // For complex HTML, replace only text nodes
                    replaceTextNodes(item.element, newText);
                } else {
                    // For simple elements, replace entire text
                    item.element.textContent = newText;
                }
                
                currentParagraph++;
            }
        });
        
        document.body.style.opacity = '1';
    }, 300);
}

// Check if HTML has complex structure
function hasComplexHTML(html) {
    return html.includes('<') && html.includes('>') && !html.startsWith('<');
}

// Replace text nodes while preserving HTML structure
function replaceTextNodes(element, newText) {
    const textNodes = getTextNodes(element);
    if (textNodes.length > 0) {
        // Replace the first text node with new content
        textNodes[0].nodeValue = newText;
        // Remove other text nodes to avoid duplication
        for (let i = 1; i < textNodes.length; i++) {
            textNodes[i].parentNode.removeChild(textNodes[i]);
        }
    } else {
        element.textContent = newText;
    }
}

// ========== SUMMARIZE PAGE FUNCTIONALITY ==========

// Main function to summarize page content
async function summarizePageContent(apiKey, targetLevel) {
    try {
        // Extract main content from the page
        const textContent = extractMainContent();
        
        if (!textContent.trim()) {
            throw new Error('No readable text content found on this page');
        }
        
        // Create summary
        const summary = await createSummary(textContent, targetLevel, apiKey);
        
        // Download as PDF
        downloadSummaryAsPDF(summary, targetLevel);
        
        return { success: true, summaryLength: summary.length };
        
    } catch (error) {
        console.error('Content summarization error:', error);
        return { success: false, error: error.message };
    }
}

// Create summary using OpenAI
async function createSummary(textContent, targetLevel, apiKey) {
    const wordCount = textContent.split(/\s+/).length;
    const targetWordCount = wordCount > 500 ? '500-600' : 'maximum 100';
    
    const prompt = `Create a ${targetWordCount} word summary of the following text at CEFR ${targetLevel} level.

CEFR ${targetLevel} Guidelines: ${getLevelGuidelines(targetLevel)}

Text to summarize:
"${textContent.substring(0, 12000)}"

Summary (${targetLevel} level):`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a professional summarizer that creates concise summaries at specific CEFR English levels.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 800,
                temperature: 0.5
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${errorData.error?.message || 'Unknown error'}`);
        }
        
        const data = await response.json();
        return data.choices[0].message.content.trim();
        
    } catch (error) {
        console.error('OpenAI Summary Error:', error);
        throw new Error(`Failed to create summary: ${error.message}`);
    }
}

// Download summary as PDF
function downloadSummaryAsPDF(summary, targetLevel) {
    const websiteName = document.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
    const filename = `${websiteName}_summary.pdf`;
    
    // Create PDF content
    const pdfContent = `
        <html>
        <head>
            <title>${filename}</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; margin: 40px; }
                h1 { color: #333; border-bottom: 2px solid #6366f1; padding-bottom: 10px; }
                .meta { color: #666; font-size: 14px; margin-bottom: 20px; }
                .summary { background: #f8f9fa; padding: 20px; border-radius: 8px; }
                .footer { margin-top: 30px; font-size: 12px; color: #888; text-align: center; }
            </style>
        </head>
        <body>
            <h1>Page Summary</h1>
            <div class="meta">
                <strong>Source:</strong> ${document.title}<br>
                <strong>URL:</strong> ${window.location.href}<br>
                <strong>CEFR Level:</strong> ${targetLevel}<br>
                <strong>Generated:</strong> ${new Date().toLocaleString()}
            </div>
            <div class="summary">
                ${summary.replace(/\n/g, '<br>')}
            </div>
            <div class="footer">
                Generated by Text Level Rewriter Chrome Extension
            </div>
        </body>
        </html>
    `;
    
    // Create blob and download
    const blob = new Blob([pdfContent], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ========== UTILITY FUNCTIONS ==========

// Store original text content
function storeOriginalTexts() {
    originalTexts.clear();
    
    // Select elements that typically contain readable text
    const textElements = document.querySelectorAll(`
        h1, h2, h3, h4, h5, h6,
        p, span, div, article, section,
        li, td, th, figcaption,
        [class*="text"], [class*="content"],
        .content, .text, .article, .post,
        main, .main, .body, .story
    `);
    
    textElements.forEach((element, index) => {
        if (element.textContent && element.textContent.trim().length > 10) {
            originalTexts.set(index, {
                element: element,
                originalText: element.textContent,
                originalHTML: element.innerHTML
            });
        }
    });
}

// Extract main content from the page
function extractMainContent() {
    const contentSelectors = [
        'main',
        'article',
        '[role="main"]',
        '.content',
        '.main-content',
        '.post-content',
        '.article-content',
        '.story-content',
        '.entry-content'
    ];
    
    let mainContent = '';
    
    // Try to find main content containers first
    for (const selector of contentSelectors) {
        const element = document.querySelector(selector);
        if (element && getTextContentLength(element) > 100) {
            mainContent = element.textContent;
            break;
        }
    }
    
    // If no main content found, use body text but exclude navigation
    if (!mainContent || mainContent.length < 100) {
        const body = document.body.cloneNode(true);
        
        // Remove common navigation elements
        const navSelectors = ['nav', 'header', 'footer', '.nav', '.header', '.footer', '.menu', '.sidebar'];
        navSelectors.forEach(selector => {
            const elements = body.querySelectorAll(selector);
            elements.forEach(el => el.remove());
        });
        
        mainContent = body.textContent;
    }
    
    // Clean up the text
    return cleanTextContent(mainContent);
}

// Get text content length
function getTextContentLength(element) {
    return element.textContent.replace(/\s+/g, ' ').trim().length;
}

// Clean text content
function cleanTextContent(text) {
    return text
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, '\n')
        .trim()
        .substring(0, 12000); // Limit to avoid token limits
}

// Get CEFR level guidelines
function getLevelGuidelines(level) {
    const guidelines = {
        'A1': 'Use very basic phrases and simple vocabulary. Short sentences. Everyday expressions.',
        'A2': 'Use basic sentences and common vocabulary. Direct communication about familiar topics.',
        'B1': 'Use clear standard language. Can handle main points on familiar topics. Straightforward connected text.',
        'B2': 'Use more complex sentences and vocabulary. Can handle abstract and technical topics.',
        'C1': 'Use sophisticated language and complex structures. Fluent and precise expression.',
        'C2': 'Use highly sophisticated language with nuance and precision. Native-like fluency.'
    };
    
    return guidelines[level] || 'Use appropriate language for the specified level.';
}

// Get text nodes from an element
function getTextNodes(element) {
    const textNodes = [];
    
    function findTextNodes(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            textNodes.push(node);
        } else {
            node.childNodes.forEach(findTextNodes);
        }
    }
    
    findTextNodes(element);
    return textNodes;
}

// Reset page to original content
function resetPageContent() {
    if (!isRewritten) return;
    
    originalTexts.forEach(item => {
        item.element.innerHTML = item.originalHTML;
    });
    
    isRewritten = false;
    
    // Smooth transition
    document.body.style.transition = 'opacity 0.3s ease';
    document.body.style.opacity = '0.8';
    setTimeout(() => {
        document.body.style.opacity = '1';
    }, 300);
}