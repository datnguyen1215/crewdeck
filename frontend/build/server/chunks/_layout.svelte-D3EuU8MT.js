import './root-CKzQD30d.js';
import './state.svelte-7tx-nND4.js';
import { c as ensure_array_like, d as attr_class, f as stringify, h as escape_html, j as derived, k as store_get, l as attr, m as attr_style, n as getContext, o as unsubscribe_stores } from './index2-BGzPKYvd.js';

function html(value) {
  var html2 = String(value ?? "");
  var open = "<!---->";
  return open + html2 + "<!---->";
}
const getStores = () => {
  const stores$1 = getContext("__svelte__");
  return {
    /** @type {typeof page} */
    page: {
      subscribe: stores$1.page.subscribe
    },
    /** @type {typeof navigating} */
    navigating: {
      subscribe: stores$1.navigating.subscribe
    },
    /** @type {typeof updated} */
    updated: stores$1.updated
  };
};
const page = {
  subscribe(fn) {
    const store = getStores().page;
    return store.subscribe(fn);
  }
};
function Sidebar($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    var $$store_subs;
    const icons = {
      home: `<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
      issues: `<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>`,
      crew: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
      activity: `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
      settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>`
    };
    let projectId = derived(() => store_get($$store_subs ??= {}, "$page", page).params.projectId);
    let pathname = derived(() => store_get($$store_subs ??= {}, "$page", page).url.pathname);
    function isActive(href) {
      return pathname() === href || href !== "/" && pathname().startsWith(href + "/");
    }
    function navItem($$renderer3, href, label, icon, active) {
      $$renderer3.push(`<a${attr("href", href)}${attr_class(`flex items-center gap-3 px-3 py-2.5 rounded text-secondary hover:text-primary hover:bg-surface transition-colors whitespace-nowrap ${stringify(active ? "text-cyan bg-surface" : "")}`)}${attr_style(active ? "box-shadow: inset 2px 0 0 var(--color-cyan)" : "")}><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0">${html(icons[icon])}</svg> <span class="text-sm opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150 delay-75 overflow-hidden">${escape_html(label)}</span></a>`);
    }
    $$renderer2.push(`<nav class="group/sidebar flex flex-col w-14 hover:w-52 overflow-hidden transition-[width] duration-200 ease-in-out bg-base-hi border-r border-edge flex-shrink-0 h-full"><a href="/" class="flex items-center gap-3 px-4 py-5 border-b border-edge hover:bg-surface transition-colors flex-shrink-0"><span class="text-cyan font-bold text-sm tracking-wider flex-shrink-0 w-6 text-center">CD</span> <span class="text-cyan font-bold uppercase tracking-widest text-xs whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150 delay-75">CREWDECK</span></a> <div class="flex flex-col gap-1 p-2 flex-1 overflow-hidden">`);
    if (projectId()) {
      $$renderer2.push("<!--[0-->");
      navItem($$renderer2, `/projects/${projectId()}`, "Issues", "issues", isActive(`/projects/${projectId()}`));
      $$renderer2.push(`<!----> `);
      navItem($$renderer2, "/crew", "Agents", "crew", isActive("/crew"));
      $$renderer2.push(`<!----> `);
      navItem($$renderer2, `/projects/${projectId()}/activity`, "Activity", "activity", isActive(`/projects/${projectId()}/activity`));
      $$renderer2.push(`<!----> `);
      navItem($$renderer2, `/projects/${projectId()}/settings`, "Settings", "settings", isActive(`/projects/${projectId()}/settings`));
      $$renderer2.push(`<!----> <div class="border-t border-edge my-1"></div> `);
      navItem($$renderer2, "/", "All Projects", "home", isActive("/"));
      $$renderer2.push(`<!---->`);
    } else {
      $$renderer2.push("<!--[-1-->");
      navItem($$renderer2, "/", "Projects", "home", isActive("/"));
    }
    $$renderer2.push(`<!--]--> <div class="mt-auto"><div class="border-t border-edge my-1"></div> `);
    navItem($$renderer2, "/settings", "Settings", "settings", isActive("/settings"));
    $$renderer2.push(`<!----></div></div></nav>`);
    if ($$store_subs) unsubscribe_stores($$store_subs);
  });
}
class ToastStore {
  items = [];
  #timers = /* @__PURE__ */ new Map();
  add(message, type = "info", duration = 5e3) {
    const id = crypto.randomUUID();
    this.items = [...this.items, { id, type, message }];
    this.#timers.set(id, setTimeout(() => this.remove(id), duration));
  }
  remove(id) {
    clearTimeout(this.#timers.get(id));
    this.#timers.delete(id);
    this.items = this.items.filter((t) => t.id !== id);
  }
}
const toastStore = new ToastStore();
function Toast($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const STYLES = {
      info: {
        border: "border-cyan",
        text: "text-cyan",
        bg: "bg-cyan/5",
        label: "INFO"
      },
      success: {
        border: "border-green",
        text: "text-green",
        bg: "bg-green/5",
        label: "OK"
      },
      warning: {
        border: "border-amber",
        text: "text-amber",
        bg: "bg-amber/5",
        label: "WARN"
      },
      error: {
        border: "border-red",
        text: "text-red",
        bg: "bg-red/5",
        label: "ERR"
      }
    };
    $$renderer2.push(`<div class="fixed bottom-4 right-4 z-[200] flex flex-col-reverse gap-2 pointer-events-none w-80 max-w-[calc(100vw-2rem)]"><!--[-->`);
    const each_array = ensure_array_like(toastStore.items);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let toast = each_array[$$index];
      const s = STYLES[toast.type];
      $$renderer2.push(`<div${attr_class(`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded border ${stringify(s.border)} ${stringify(s.bg)} bg-surface shadow-lg`)} role="status"><span${attr_class(`text-xs font-bold font-mono ${stringify(s.text)} flex-shrink-0 mt-0.5 tracking-wider`)}>[${escape_html(s.label)}]</span> <span class="text-sm text-secondary flex-1 leading-snug">${escape_html(toast.message)}</span> <button class="text-muted hover:text-primary transition-colors flex-shrink-0 leading-none ml-1" aria-label="Dismiss notification">✕</button></div>`);
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
function _layout($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { children } = $$props;
    $$renderer2.push(`<div class="flex h-screen bg-base overflow-hidden">`);
    Sidebar($$renderer2);
    $$renderer2.push(`<!----> <main class="flex-1 overflow-auto">`);
    children($$renderer2);
    $$renderer2.push(`<!----></main></div> `);
    Toast($$renderer2);
    $$renderer2.push(`<!---->`);
  });
}

export { _layout as default };
//# sourceMappingURL=_layout.svelte-D3EuU8MT.js.map
