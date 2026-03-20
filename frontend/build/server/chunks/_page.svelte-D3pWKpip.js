import { h as escape_html, c as ensure_array_like, m as attr_style, f as stringify } from './index2-BGzPKYvd.js';

function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let agents = [];
    $$renderer2.push(`<div class="p-6 h-full overflow-auto"><div class="mb-8"><h1 class="text-xl font-bold text-primary uppercase tracking-wide">Crew</h1> <p class="text-muted text-xs mt-1">${escape_html(agents.length)} member${escape_html(agents.length !== 1 ? "s" : "")}</p></div> `);
    {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl"><!--[-->`);
      const each_array = ensure_array_like(Array(5));
      for (let i = 0, $$length = each_array.length; i < $$length; i++) {
        each_array[i];
        $$renderer2.push(`<div class="flex flex-col p-4 bg-surface border border-edge rounded fade-up"${attr_style(`animation-delay: ${stringify(i * 50)}ms`)}><div class="skeleton h-4 w-3/5 rounded mb-1.5"></div> <div class="skeleton h-3 w-2/5 rounded mb-3"></div> <div class="skeleton h-3 w-4/5 rounded"></div></div>`);
      }
      $$renderer2.push(`<!--]--></div>`);
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}

export { _page as default };
//# sourceMappingURL=_page.svelte-D3pWKpip.js.map
