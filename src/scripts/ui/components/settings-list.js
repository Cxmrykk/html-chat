import { escapeHTML } from '../../core/format.js';
import { groupByCategory } from '../../core/settings-schema.js';

/**
 * The category-grouped list of settings buttons. `describe(key)` gives the
 * summary shown on the right, so the same list serves the defaults and a
 * model's overrides.
 */
export function settingsListHTML({ schema, activeKey, describe }) {
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

    html += '</div>';
  }

  return html;
}
