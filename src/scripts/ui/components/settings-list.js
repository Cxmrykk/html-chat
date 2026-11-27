import { escapeHTML } from '../../core/format.js';
import { groupByCategory } from '../../core/settings-schema.js';

/**
 * The category-grouped list of settings buttons. `describe(key)` gives the
 * summary shown on the right. `leadRows` maps a category to markup placed at
 * the top of its group, before its settings (the model selector of LLM
 * Behavior, say); `trailRows` to markup placed after them (the image tool
 * model checklist of Image Generation).
 */
export function settingsListHTML({ schema, activeKey, describe, leadRows = {}, trailRows = {} }) {
  const groups = groupByCategory(schema);
  let html = '';

  for (const [category, keys] of groups) {
    html += `
      <div class="settings-category">
        <h3>${escapeHTML(category)}</h3>
      </div>
      <div class="settings-group">`;

    html += leadRows[category] || '';

    html += keys
      .map((key) => {
        const entry = schema[key];
        const summary = describe(key);
        return `
          <button class="setting-row${activeKey === key ? ' active-setting' : ''}"
                  data-command="settings.select" data-key="${escapeHTML(key)}"
                  title="${escapeHTML(entry.tooltip)}">
            <span>${escapeHTML(entry.label)}</span>
            <span class="setting-value">${escapeHTML(summary)}</span>
          </button>`;
      })
      .join('');

    html += trailRows[category] || '';

    html += '</div>';
  }

  return html;
}
