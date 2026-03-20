import { h as escape_html, c as ensure_array_like, m as attr_style, f as stringify } from './index2-BGzPKYvd.js';
import { o as onDestroy } from './index-server-B3_fMyPJ.js';

function GitHubConnect($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const { inline = false } = $$props;
    onDestroy(() => {
    });
    if (
      // Auto-start when inline (used in wizard)
      !inline
    ) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<button class="px-3 py-1.5 bg-cyan/10 border border-cyan text-cyan text-xs font-medium rounded hover:bg-cyan/20 transition-colors uppercase tracking-wide flex-shrink-0">+ Connect GitHub Account</button>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]-->`);
  });
}
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let accounts = [];
    $$renderer2.push(`<div class="p-6 h-full overflow-auto"><div class="flex items-start justify-between mb-8"><div><h1 class="text-xs text-muted uppercase tracking-widest mb-1">Settings</h1> <p class="text-xl font-bold text-primary">GitHub Accounts</p> <p class="text-muted text-xs mt-1">${escape_html(accounts.length)} account${escape_html(accounts.length !== 1 ? "s" : "")} connected</p></div> `);
    GitHubConnect($$renderer2, {});
    $$renderer2.push(`<!----></div> `);
    {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl"><!--[-->`);
      const each_array = ensure_array_like(Array(3));
      for (let i = 0, $$length = each_array.length; i < $$length; i++) {
        each_array[i];
        $$renderer2.push(`<div class="flex flex-col p-4 bg-surface border border-edge rounded fade-up"${attr_style(`animation-delay: ${stringify(i * 50)}ms`)}><div class="skeleton h-4 w-3/5 rounded mb-2"></div> <div class="skeleton h-3 w-2/5 rounded mb-3"></div> <div class="skeleton h-3 w-4/5 rounded mb-3"></div> <div class="skeleton h-7 w-24 rounded mt-auto"></div></div>`);
      }
      $$renderer2.push(`<!--]--></div>`);
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}

export { _page as default };
//# sourceMappingURL=_page.svelte-CX81g_50.js.map
