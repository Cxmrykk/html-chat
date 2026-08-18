import { escapeHTML } from '../../core/format.js';
import { groupByCategory, describeSetting } from '../../core/settings-schema.js';

/** The category-grouped list of settings buttons, shared by both scopes. */
export function settingsListHTML({ schema, activeKey, readValue }) {
  const groups = groupByCategory(schema);
  let html = '';

  for (const [category, keys] of groups) {
    html += `
      <div class="settings-category">
        <h3>${escapeHTML(category)}</h3>
      </div>
      <div class="settings-group">`;

    html += keys
      .map((key) => {
        const entry = schema[key];
        const summary = describeSetting(schema, key, readValue(key));
        return `
          <button class="setting-row${activeKey === key ? ' active-setting' : ''}"
                  data-command="settings.select" data-key="${escapeHTML(key)}"
                  title="${escapeHTML(entry.tooltip)}">
            <span>${escapeHTML(entry.label)}</span>
            <span class="setting-value">${escapeHTML(summary)}</span>
          </button>`;
      })
      .join('');

    html += '</div>';
  }

  return html;
}
