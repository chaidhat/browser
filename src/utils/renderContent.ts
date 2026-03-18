import { marked } from 'marked';
import katex from 'katex';

marked.setOptions({ breaks: true });

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex.trim(), { displayMode, throwOnError: false });
  } catch {
    return `<span class="math-error">${tex}</span>`;
  }
}

export function renderContent(raw: string): string {
  const placeholders: string[] = [];
  function placeholder(html: string): string {
    const idx = placeholders.length;
    placeholders.push(html);
    return `%%MATH_${idx}%%`;
  }

  // Display math: $$...$$ and \[...\]
  let text = raw.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => placeholder(renderKatex(tex, true)));
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => placeholder(renderKatex(tex, true)));
  // Inline math: $...$ and \(...\)
  text = text.replace(/\$([^\$\n]+?)\$/g, (_, tex) => placeholder(renderKatex(tex, false)));
  text = text.replace(/\\\((.+?)\\\)/g, (_, tex) => placeholder(renderKatex(tex, false)));

  let html = marked.parse(text) as string;

  html = html.replace(/%%MATH_(\d+)%%/g, (_, idx) => placeholders[parseInt(idx)]);

  return html;
}
