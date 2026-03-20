import { n as getContext, c as ensure_array_like, m as attr_style, f as stringify } from './index2-BGzPKYvd.js';
import './root-CKzQD30d.js';
import './state.svelte-7tx-nND4.js';

function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    getContext("projectWs");
    {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="p-6 max-w-6xl fade-up"><div class="mb-6"><div class="skeleton h-3 w-24 rounded"></div></div> <div class="grid lg:grid-cols-[1fr_288px] gap-5"><div class="bg-surface border border-edge rounded overflow-hidden"><div class="flex border-b border-edge gap-1 px-1 pt-1"><!--[-->`);
      const each_array = ensure_array_like([80, 100, 70]);
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let w = each_array[$$index];
        $$renderer2.push(`<div class="skeleton h-8 rounded-t"${attr_style(`width: ${stringify(w)}px`)}></div>`);
      }
      $$renderer2.push(`<!--]--></div> <div class="p-6 flex flex-col gap-4"><div class="skeleton h-6 w-3/4 rounded"></div> <!--[-->`);
      const each_array_1 = ensure_array_like([100, 90, 95, 70, 85]);
      for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
        let pct = each_array_1[$$index_1];
        $$renderer2.push(`<div class="skeleton h-4 rounded"${attr_style(`width: ${stringify(pct)}%`)}></div>`);
      }
      $$renderer2.push(`<!--]--></div></div> <div class="flex flex-col gap-4"><div class="bg-surface border border-edge rounded p-4 flex flex-col gap-3"><!--[-->`);
      const each_array_2 = ensure_array_like(Array(6));
      for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
        each_array_2[$$index_2];
        $$renderer2.push(`<div class="flex items-center gap-2"><div class="skeleton h-3 w-20 rounded"></div><div class="skeleton h-4 w-24 rounded"></div></div>`);
      }
      $$renderer2.push(`<!--]--></div></div></div></div>`);
    }
    $$renderer2.push(`<!--]-->`);
  });
}

export { _page as default };
//# sourceMappingURL=_page.svelte-DhOx78l7.js.map
