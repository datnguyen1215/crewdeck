function esc(s: string) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Minimal markdown renderer — handles the common subset */
export function md(text: string): string {
	if (!text) return '';

	// Apply inline transforms to a single line (HTML already escaped via esc)
	function inline(s: string): string {
		return esc(s)
			.replace(/`([^`]+)`/g, '<code>$1</code>')
			.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
			.replace(/\*([^*]+)\*/g, '<em>$1</em>');
	}

	// Process line by line so fenced code blocks are never torn apart
	const lines = text.split('\n');
	const result: string[] = [];
	let inList: 'ul' | 'ol' | false = false;
	let inCodeBlock = false;
	const codeLines: string[] = [];

	for (const line of lines) {
		if (/^```/.test(line)) {
			if (inCodeBlock) {
				if (inList) { result.push(`</${inList}>`); inList = false; }
				result.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
				codeLines.length = 0;
				inCodeBlock = false;
			} else {
				inCodeBlock = true;
			}
			continue;
		}
		if (inCodeBlock) {
			codeLines.push(esc(line));
			continue;
		}
		if (/^### /.test(line)) {
			if (inList) { result.push(`</${inList}>`); inList = false; }
			result.push(`<h3>${inline(line.slice(4))}</h3>`);
		} else if (/^## /.test(line)) {
			if (inList) { result.push(`</${inList}>`); inList = false; }
			result.push(`<h2>${inline(line.slice(3))}</h2>`);
		} else if (/^# /.test(line)) {
			if (inList) { result.push(`</${inList}>`); inList = false; }
			result.push(`<h1>${inline(line.slice(2))}</h1>`);
		} else if (/^\d+\. /.test(line)) {
			if (!inList) { result.push('<ol>'); inList = 'ol'; }
			result.push(`<li>${inline(line.replace(/^\d+\. /, ''))}</li>`);
		} else if (/^- /.test(line)) {
			if (!inList) { result.push('<ul>'); inList = 'ul'; }
			result.push(`<li>${inline(line.slice(2))}</li>`);
		} else {
			if (inList) { result.push(`</${inList}>`); inList = false; }
			if (line.trim() === '') {
				result.push('<br>');
			} else {
				result.push(`<p>${inline(line)}</p>`);
			}
		}
	}
	if (inCodeBlock) result.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
	if (inList) result.push(`</${inList}>`);
	return result.join('');
}

/** Strip markdown syntax to produce plain text for previews */
export function stripMarkdown(text: string): string {
	if (!text) return '';
	return text
		// Fenced code blocks → single newline
		.replace(/```[\s\S]*?```/g, '')
		// ATX headings
		.replace(/^#{1,6}\s+/gm, '')
		// Bold/italic
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/__([^_]+)__/g, '$1')
		.replace(/_([^_]+)_/g, '$1')
		// Inline code
		.replace(/`([^`]+)`/g, '$1')
		// Links: [text](url) → text
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		// Images: ![alt](url) → (remove)
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
		// List markers
		.replace(/^[\s]*[-*+]\s+/gm, '')
		.replace(/^\d+\.\s+/gm, '')
		// Blockquotes
		.replace(/^>\s+/gm, '')
		// Horizontal rules
		.replace(/^[-*_]{3,}\s*$/gm, '')
		// Collapse whitespace
		.replace(/\n{2,}/g, '\n')
		.trim();
}
