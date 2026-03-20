import { c as ensure_array_like } from './index2-BGzPKYvd.js';
import './root-CKzQD30d.js';
import './state.svelte-7tx-nND4.js';

function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    $$renderer2.push(`<div class="p-8 h-full overflow-auto"><div class="max-w-xl"><h1 class="text-sm font-bold tracking-[0.3em] uppercase mb-8 fade-up" style="color: var(--color-cyan); text-shadow: var(--glow-cyan)">Project Settings</h1> `);
    {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="flex flex-col gap-4"><!--[-->`);
      const each_array = ensure_array_like(Array(3));
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        each_array[$$index];
        $$renderer2.push(`<div class="skeleton h-10 w-full rounded"></div>`);
      }
      $$renderer2.push(`<!--]--></div>`);
    }
    $$renderer2.push(`<!--]--></div></div>`);
  });
}

export { _page as default };
//# sourceMappingURL=_page.svelte-HG9zbow-.js.map
