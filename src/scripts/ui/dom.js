/** DOM lookup helpers. The only place `document.querySelector` is idiomatic. */

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

export function setHidden(element, hidden) {
  if (element) element.classList.toggle('hidden', hidden);
}

export function setText(element, text) {
  if (element && element.textContent !== text) element.textContent = text;
}

export function setDisabled(element, disabled) {
  if (element) element.disabled = disabled;
}

/** Build an element from an HTML string. */
export function fromHTML(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}
