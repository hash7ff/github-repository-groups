// Tiny element builder. Children that are strings become text nodes, so GitHub-derived strings can never be parsed as HTML.
export type Child = Node | string | null | undefined | false;

export type Props = {
  className?: string;
  id?: string;
  title?: string;
  href?: string;
  type?: string;
  hidden?: boolean;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  onClick?: (event: MouseEvent) => void;
  onInput?: (event: Event) => void;
  dataset?: Record<string, string>;
};

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.className) el.className = props.className;
  if (props.id) el.id = props.id;
  if (props.title) el.title = props.title;
  if (props.hidden) el.hidden = true;
  if (props.ariaLabel) el.setAttribute("aria-label", props.ariaLabel);
  if (props.href && el instanceof HTMLAnchorElement) el.href = props.href;
  if (props.type && (el instanceof HTMLButtonElement || el instanceof HTMLInputElement)) el.type = props.type;
  if (props.placeholder && el instanceof HTMLInputElement) el.placeholder = props.placeholder;
  if (props.disabled && (el instanceof HTMLButtonElement || el instanceof HTMLInputElement)) el.disabled = true;
  if (props.onClick) el.addEventListener("click", props.onClick as EventListener);
  if (props.onInput) el.addEventListener("input", props.onInput);
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) el.dataset[k] = v;
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
