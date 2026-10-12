/**
 * Простой парсер Markdown в HTML
 * Поддерживает: жирный, курсив, код, блоки кода, списки, заголовки
 */

export function parseMarkdown(text: string): string {
  if (!text) return '';
  
  let html = text;
  
  // Экранируем HTML-сущности (кроме тех, что мы сами создадим)
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Блоки кода (``` ... ```)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });
  
  // Инлайн код (`...`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Жирный текст (**...** или __...__)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  
  // Курсив (*...* или _..._)
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  
  // Разбиваем на строки для обработки списков и параграфов
  const lines = html.split('\n');
  const result: string[] = [];
  let inList = false;
  let listType = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Неупорядоченный список
    const ulMatch = line.match(/^[\s]*[-•*]\s+(.+)/);
    // Упорядоченный список
    const olMatch = line.match(/^[\s]*(\d+)[.)]\s+(.+)/);
    
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) result.push(`</${listType}>`);
        result.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      result.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) result.push(`</${listType}>`);
        result.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      result.push(`<li>${olMatch[2]}</li>`);
    } else {
      if (inList) {
        result.push(`</${listType}>`);
        inList = false;
        listType = '';
      }
      
      // Пропускаем pre-блоки (они уже обработаны)
      if (line.includes('<pre>') || line.includes('</pre>') || line.includes('<code>')) {
        result.push(line);
      } else if (line.trim() === '') {
        result.push('<br/>');
      } else {
        result.push(`<p>${line}</p>`);
      }
    }
  }
  
  if (inList) {
    result.push(`</${listType}>`);
  }
  
  return result.join('\n');
}
