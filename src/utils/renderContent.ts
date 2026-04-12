import { marked } from 'marked';
import katex from 'katex';

const renderer = new marked.Renderer();
const externalLinkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="0.75em" height="0.75em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:baseline;margin-left:2px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;

renderer.link = ({ href, text }) => {
  return `<a href="${href}" class="underline" target="_blank" rel="noopener noreferrer">${text}${externalLinkSvg}</a>`;
};

marked.setOptions({ breaks: true, renderer });

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

  // Display math: $$...$$ and \[...\] — wrap in container with data-latex for copy button
  let text = raw.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => placeholder(
    `<div class="math-display" data-latex="${tex.trim().replace(/"/g, '&quot;')}" style="position:relative">${renderKatex(tex, true)}</div>`
  ));
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => placeholder(
    `<div class="math-display" data-latex="${tex.trim().replace(/"/g, '&quot;')}" style="position:relative">${renderKatex(tex, true)}</div>`
  ));
  // Inline math: $...$ and \(...\)
  text = text.replace(/\$([^\$\n]+?)\$/g, (_, tex) => placeholder(renderKatex(tex, false)));
  text = text.replace(/\\\((.+?)\\\)/g, (_, tex) => placeholder(renderKatex(tex, false)));

  let html = marked.parse(text) as string;

  html = html.replace(/%%MATH_(\d+)%%/g, (_, idx) => placeholders[parseInt(idx)]);

  return html;
}
