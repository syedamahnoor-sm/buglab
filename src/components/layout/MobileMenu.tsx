"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FocusEvent } from "react";
import { CloseIcon, MenuIcon } from "@/components/ui/icons";
import type { AppSection, NavItem } from "./nav";

const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * The navigation below md: a disclosure button that opens the sections in a
 * panel under the header. It follows the disclosure pattern: the button says
 * whether it is expanded, the links follow it in tab order, and Escape, a
 * click outside, choosing a link or tabbing away closes it. Escape returns
 * focus to the button.
 */
export function MobileMenu({ items, current }: { items: NavItem[]; current: AppSection }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    // The panel is only for narrow layouts: close it if the window widens to the inline navigation.
    const wide = window.matchMedia("(min-width: 48rem)");
    const onWide = () => wide.matches && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && !event.currentTarget.contains(next)) setOpen(false);
  };

  const currentLabel = items.find((item) => item.section === current)?.label;

  return (
    <div ref={wrapper} onBlur={onBlur} className="md:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-9 items-center gap-2 rounded-lg border border-border bg-surface/60 px-3 text-sm font-medium text-foreground transition-colors duration-200 hover:border-border-strong hover:bg-surface-raised aria-expanded:border-border-strong aria-expanded:bg-surface-raised ${focus}`}
      >
        {open ? <CloseIcon width={16} height={16} /> : <MenuIcon width={16} height={16} />}
        <span>Menu</span>
        {currentLabel ? <span className="sr-only">, current section {currentLabel}</span> : null}
      </button>

      {open ? (
        <div
          id={panelId}
          className="absolute inset-x-0 top-full animate-rise border-b border-border bg-nav shadow-card-hover"
        >
          <ul className="mx-auto flex max-w-[1600px] flex-col gap-1 px-4 py-3 sm:px-6">
            {items.map((item) => (
              <li key={item.label}>
                <MenuEntry item={item} current={item.section === current} onChoose={() => setOpen(false)} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function MenuEntry({ item, current, onChoose }: { item: NavItem; current: boolean; onChoose: () => void }) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className={`h-8 w-1 shrink-0 rounded-full transition-colors ${current ? "bg-accent" : "bg-transparent group-hover:bg-border-strong"}`}
      />
      <span className="flex min-w-0 flex-col">
        <span className={`text-[0.9375rem] ${current ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>{item.label}</span>
        <span className="truncate text-xs text-muted">{item.detail}</span>
      </span>
    </>
  );
  const className = `group flex min-h-12 items-center gap-3 rounded-xl px-2 py-2 ${current ? "bg-nav-current" : "hover:bg-surface-raised"} ${focus}`;

  if (current && item.textWhenCurrent) {
    return (
      <span aria-current="page" className={className}>
        {body}
      </span>
    );
  }
  return (
    <Link href={item.href} aria-current={current ? "page" : undefined} onClick={onChoose} className={className}>
      {body}
    </Link>
  );
}
