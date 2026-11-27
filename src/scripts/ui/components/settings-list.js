import { escapeHTML } from '../../core/format.js';
import { groupByCategory } from '../../core/settings-schema.js';

/**
 * The category-grouped list of settings buttons. `describe(key)` gives the
 * summary shown on the right, and `read(key)` the stored value of a dropdown
 * setting. `leadRows` maps a category to markup placed at the top of its
 * group, before its settings (the model selector of LLM Behavior, say);
 * `trailRows` to markup placed after them.
 *
 * A `select` setting is drawn as a dropdown row (`selectRowHTML`) that saves
 * as soon as a choice is made; every other setting is a button that opens it
 * in the editor.
 */

/**
 * A setting row with a transparent native `<select>` laid over it: the row
 * shows the chosen option's label, the select takes every click and key, so
 * the browser's own list still opens. `fallback` is the value shown when
 * `value` is none of the options.
 */
export function selectRowHTML({
  label,
  value,
  options,
  command,
  key = '',
  id = '',
  hint = '',
  ariaLabel = '',
  fallback,
}) {
  const current =
    options.find((option) => option.value === value) ||
    options.find((option) => option.value === fallback) ||
    options[0] || { value: '', label: '' };

  const optionsHTML = options
    .map(
      (option) =>
        `<option value="${escapeHTML(option.value)}"${option.value === current.value ? ' selected' : ''}>${escapeHTML(option.label)}</option>`,
    )
    .join('');

  return `
    <div class="setting-select"${hint ? ` title="${escapeHTML(hint)}"` : ''}>
      <button class="setting-row" type="button" tabindex="-1" aria-hidden="true">
        <span>${escapeHTML(label)}</span>
        <span class="setting-value">${escapeHTML(current.label)}</span>
      </button>
      <select${id ? ` id="${escapeHTML(id)}"` : ''} data-command="${escapeHTML(command)}"${
        key ? ` data-key="${escapeHTML(key)}"` : ''
      } aria-label="${escapeHTML(ariaLabel || label)}">${optionsHTML}</select>
    </div>`;
}

function buttonRowHTML(key, entry, activeKey, summary) {
  return `
    <button class="setting-row${activeKey === key ? ' active-setting' : ''}"
            data-command="settings.select" data-key="${escapeHTML(key)}"
            title="${escapeHTML(entry.tooltip)}">
      <span>${escapeHTML(entry.label)}</span>
      <span class="setting-value">${escapeHTML(summary)}</span>
    </button>`;
}

export function settingsListHTML({
  schema,
  activeKey,
  describe,
  read = () => undefined,
  leadRows = {},
  trailRows = {},
}) {
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
        if (entry.type === 'select' && Array.isArray(entry.options)) {
          return selectRowHTML({
            label: entry.label,
            value: read(key),
            fallback: entry.default,
            options: entry.options,
            command: 'settings.choose',
            key,
            hint: entry.tooltip,
          });
        }
        return buttonRowHTML(key, entry, activeKey, describe(key));
      })
      .join('');

    html += trailRows[category] || '';

    html += '</div>';
  }

  return html;
}
