import type { Terminal } from "@xterm/xterm";

const TOOLTIP_OFFSET = 12;

export class TerminalLinkTooltip {
  private element: HTMLDivElement | null = null;

  constructor(private readonly terminal: Terminal) {}

  show(event: MouseEvent, text: string, hint: string): void {
    const host = this.terminal.element;
    if (!host) return;

    const element = this.ensureElement(host);
    element.replaceChildren();

    const target = document.createElement("span");
    target.className = "terminal-link-tooltip-target";
    target.textContent = text;
    const hintElement = document.createElement("span");
    hintElement.className = "terminal-link-tooltip-hint";
    hintElement.textContent = hint;
    element.append(target, hintElement);

    const hostRect = host.getBoundingClientRect();
    const left = Math.max(0, event.clientX - hostRect.left + TOOLTIP_OFFSET);
    const top = Math.max(0, event.clientY - hostRect.top + TOOLTIP_OFFSET);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.hidden = false;

    const overflow = left + element.offsetWidth - host.clientWidth;
    if (overflow > 0) element.style.left = `${Math.max(0, left - overflow - TOOLTIP_OFFSET)}px`;
  }

  hide(): void {
    if (this.element) this.element.hidden = true;
  }

  dispose(): void {
    this.element?.remove();
    this.element = null;
  }

  private ensureElement(host: HTMLElement) {
    if (this.element && this.element.parentElement === host) return this.element;

    this.element?.remove();
    const element = document.createElement("div");
    element.className = "xterm-hover terminal-link-tooltip";
    element.setAttribute("role", "tooltip");
    element.hidden = true;
    host.appendChild(element);
    this.element = element;
    return element;
  }
}
