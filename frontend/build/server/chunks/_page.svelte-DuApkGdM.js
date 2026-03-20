import { n as getContext, c as ensure_array_like, d as attr_class, f as stringify, h as escape_html, m as attr_style, j as derived } from './index2-BGzPKYvd.js';
import './root-CKzQD30d.js';
import './state.svelte-7tx-nND4.js';

const ACTOR_CFG = {
  user: { icon: "○", color: "text-primary", border: "border-edge-hi", glow: "" },
  agent: { icon: "⬡", color: "text-cyan", border: "border-cyan", glow: "var(--glow-cyan)" },
  system: { icon: "⚙", color: "text-muted", border: "border-edge", glow: "" }
};
const ACTION_DISPLAY = {
  "issue.created": "Issue Created",
  "issue.status_changed": "Status Changed",
  "comment.added": "Comment Added",
  "pr.created": "PR Created",
  "mention.spawned": "Agent Spawned",
  "mention.completed": "Agent Completed"
};
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    getContext("projectWs");
    const PAGE_SIZE = 50;
    let allEntries = [];
    let issues = [];
    let filterActors = [];
    let filterAction = "";
    let filterIssue = "";
    let actionTypes = derived(() => [...new Set(allEntries.map((e) => e.action))].sort());
    $$renderer2.push(`<div class="p-6 h-full overflow-auto"><div class="flex items-center justify-between mb-5"><div><h1 class="text-xl font-bold text-primary uppercase tracking-wide">Activity</h1> <p class="text-muted text-xs mt-0.5">`);
    {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`Loading…`);
    }
    $$renderer2.push(`<!--]--></p></div></div> <div class="mb-6 space-y-2"><div class="flex flex-wrap items-center gap-1.5"><span class="text-xs text-muted uppercase tracking-widest mr-1 flex-shrink-0">Actor:</span> <!--[-->`);
    const each_array = ensure_array_like(Object.entries(ACTOR_CFG));
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let [type, cfg] = each_array[$$index];
      $$renderer2.push(`<button${attr_class(`px-2 py-0.5 text-xs rounded border transition-colors ${stringify(filterActors.includes(type) ? `${cfg.color} ${cfg.border} bg-surface-hi` : "text-muted border-edge hover:border-edge-hi hover:text-secondary")}`)}>${escape_html(cfg.icon)}
					${escape_html(type.charAt(0).toUpperCase() + type.slice(1))}</button>`);
    }
    $$renderer2.push(`<!--]--></div> <div class="flex items-center gap-4 flex-wrap"><div class="flex items-center gap-2"><span class="text-xs text-muted uppercase tracking-widest">Action:</span> `);
    $$renderer2.select(
      {
        value: filterAction,
        onchange: () => PAGE_SIZE,
        class: "bg-surface border border-edge text-secondary text-xs rounded px-2 py-1 hover:border-edge-hi transition-colors cursor-pointer outline-none"
      },
      ($$renderer3) => {
        $$renderer3.option({ value: "" }, ($$renderer4) => {
          $$renderer4.push(`All`);
        });
        $$renderer3.push(`<!--[-->`);
        const each_array_1 = ensure_array_like(actionTypes());
        for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
          let action = each_array_1[$$index_1];
          $$renderer3.option({ value: action }, ($$renderer4) => {
            $$renderer4.push(`${escape_html(ACTION_DISPLAY[action] ?? action)}`);
          });
        }
        $$renderer3.push(`<!--]-->`);
      }
    );
    $$renderer2.push(`</div> <div class="flex items-center gap-2"><span class="text-xs text-muted uppercase tracking-widest">Issue:</span> `);
    $$renderer2.select(
      {
        value: filterIssue,
        onchange: () => PAGE_SIZE,
        class: "bg-surface border border-edge text-secondary text-xs rounded px-2 py-1 hover:border-edge-hi transition-colors cursor-pointer outline-none max-w-[180px]"
      },
      ($$renderer3) => {
        $$renderer3.option({ value: "" }, ($$renderer4) => {
          $$renderer4.push(`All`);
        });
        $$renderer3.push(`<!--[-->`);
        const each_array_2 = ensure_array_like(issues);
        for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
          let issue = each_array_2[$$index_2];
          $$renderer3.option({ value: issue.id }, ($$renderer4) => {
            $$renderer4.push(`${escape_html(issue.title)}`);
          });
        }
        $$renderer3.push(`<!--]-->`);
      }
    );
    $$renderer2.push(`</div> `);
    if (filterActors.length > 0 || filterAction || filterIssue) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<button class="px-2 py-0.5 text-xs text-muted hover:text-secondary border border-transparent hover:border-edge rounded transition-colors">Clear ×</button>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div></div> `);
    {
      $$renderer2.push("<!--[0-->");
      const skeletonWidths = [75, 55, 85, 65, 90, 60, 70, 80];
      $$renderer2.push(`<div class="max-w-2xl relative fade-up"><div class="absolute left-[19px] top-2 bottom-0 w-px bg-edge pointer-events-none"></div> <div class="flex flex-col"><!--[-->`);
      const each_array_3 = ensure_array_like(Array(8));
      for (let i = 0, $$length = each_array_3.length; i < $$length; i++) {
        each_array_3[i];
        $$renderer2.push(`<div class="flex gap-4 pb-5 relative fade-up"${attr_style(`animation-delay: ${stringify(i * 40)}ms`)}><div class="flex-shrink-0 w-10 flex justify-center pt-0.5"><div class="skeleton w-6 h-6 rounded-full"></div></div> <div class="flex-1 pt-0.5"><div class="flex items-center gap-2 mb-1.5"><div class="skeleton h-3 w-16 rounded"></div> <div class="skeleton h-3 w-12 rounded"></div></div> <div class="skeleton h-4 rounded"${attr_style(`width: ${stringify(skeletonWidths[i])}%`)}></div> `);
        if (i % 3 === 0) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<div class="skeleton h-3 w-32 rounded mt-1.5"></div>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></div></div>`);
      }
      $$renderer2.push(`<!--]--></div></div>`);
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}

export { _page as default };
//# sourceMappingURL=_page.svelte-DuApkGdM.js.map
