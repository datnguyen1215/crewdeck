import { n as getContext, c as ensure_array_like, d as attr_class, f as stringify, h as escape_html, l as attr, m as attr_style } from './index2-BGzPKYvd.js';
import './root-CKzQD30d.js';
import './state.svelte-7tx-nND4.js';
import { M as Modal } from './Modal-C8eh0UL9.js';

const STATUS_CFG = {
  open: { label: "Open", dot: "○", text: "text-blue", border: "border-blue", glow: "var(--glow-blue)" },
  in_progress: {
    label: "In Progress",
    dot: "◉",
    text: "text-green",
    border: "border-green",
    glow: "var(--glow-green)",
    pulse: true
  },
  pr_created: {
    label: "PR Created",
    dot: "◉",
    text: "text-purple",
    border: "border-purple",
    glow: "var(--glow-purple)"
  },
  done: { label: "Done", dot: "✓", text: "text-secondary", border: "border-secondary" }
};
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    getContext("projectWs");
    let agents = [];
    let filterStatuses = [];
    let filterAgent = "";
    let showCompleted = false;
    let sortField = "created_at";
    let showModal = false;
    let newTitle = "";
    let newDescription = "";
    let submitting = false;
    function resetForm() {
      newTitle = "";
      newDescription = "";
    }
    function closeModal() {
      {
        showModal = false;
        resetForm();
      }
    }
    $$renderer2.push(`<div class="p-6 h-full overflow-auto svelte-1n2426w"><div class="flex items-center justify-between mb-5 svelte-1n2426w"><div class="svelte-1n2426w"><h1 class="text-xl font-bold text-primary uppercase tracking-wide svelte-1n2426w">Issues</h1> <p class="text-muted text-xs mt-0.5 svelte-1n2426w">`);
    {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`Loading…`);
    }
    $$renderer2.push(`<!--]--></p></div> <button class="px-3 py-1.5 bg-surface border border-edge text-primary text-xs font-medium rounded hover:border-edge-hi hover:bg-surface-hi transition-colors uppercase tracking-wide svelte-1n2426w">+ New Issue</button></div> <div class="mb-5 space-y-2.5 svelte-1n2426w"><div class="flex flex-wrap items-center gap-1.5 svelte-1n2426w"><span class="text-xs text-muted uppercase tracking-widest mr-1 svelte-1n2426w">Status:</span> <!--[-->`);
    const each_array = ensure_array_like(Object.entries(STATUS_CFG));
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let [key, cfg] = each_array[$$index];
      $$renderer2.push(`<button${attr_class(
        `px-2 py-0.5 text-xs rounded border transition-colors ${stringify(filterStatuses.includes(key) ? `${cfg.text} ${cfg.border} bg-surface-hi` : "text-muted border-edge hover:border-edge-hi hover:text-secondary")}`,
        "svelte-1n2426w"
      )}>${escape_html(cfg.label)}</button>`);
    }
    $$renderer2.push(`<!--]--> `);
    if (filterStatuses.length > 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<button class="px-2 py-0.5 text-xs text-muted hover:text-secondary border border-transparent hover:border-edge rounded transition-colors ml-1 svelte-1n2426w">Clear ×</button>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div> <div class="flex items-center gap-4 flex-wrap svelte-1n2426w"><div class="flex items-center gap-2 svelte-1n2426w"><span class="text-xs text-muted uppercase tracking-widest svelte-1n2426w">Agent:</span> `);
    $$renderer2.select(
      {
        value: filterAgent,
        class: "bg-surface border border-edge text-secondary text-xs rounded px-2 py-1 hover:border-edge-hi transition-colors cursor-pointer outline-none"
      },
      ($$renderer3) => {
        $$renderer3.option(
          { value: "", class: "" },
          ($$renderer4) => {
            $$renderer4.push(`All`);
          },
          "svelte-1n2426w"
        );
        $$renderer3.option(
          { value: "__unassigned__", class: "" },
          ($$renderer4) => {
            $$renderer4.push(`Unassigned`);
          },
          "svelte-1n2426w"
        );
        $$renderer3.push(`<!--[-->`);
        const each_array_1 = ensure_array_like(agents);
        for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
          let agent = each_array_1[$$index_1];
          $$renderer3.option(
            { value: agent.id, class: "" },
            ($$renderer4) => {
              $$renderer4.push(`${escape_html(agent.name)}`);
            },
            "svelte-1n2426w"
          );
        }
        $$renderer3.push(`<!--]-->`);
      },
      "svelte-1n2426w"
    );
    $$renderer2.push(`</div> <div class="flex items-center gap-2 svelte-1n2426w"><span class="text-xs text-muted uppercase tracking-widest svelte-1n2426w">Sort:</span> `);
    $$renderer2.select(
      {
        value: sortField,
        class: "bg-surface border border-edge text-secondary text-xs rounded px-2 py-1 hover:border-edge-hi transition-colors cursor-pointer outline-none"
      },
      ($$renderer3) => {
        $$renderer3.option(
          { value: "priority", class: "" },
          ($$renderer4) => {
            $$renderer4.push(`Priority`);
          },
          "svelte-1n2426w"
        );
        $$renderer3.option(
          { value: "created_at", class: "" },
          ($$renderer4) => {
            $$renderer4.push(`Created`);
          },
          "svelte-1n2426w"
        );
        $$renderer3.option(
          { value: "updated_at", class: "" },
          ($$renderer4) => {
            $$renderer4.push(`Updated`);
          },
          "svelte-1n2426w"
        );
      },
      "svelte-1n2426w"
    );
    $$renderer2.push(` <button class="px-2 py-1 bg-surface border border-edge text-secondary text-xs rounded hover:border-edge-hi hover:text-primary transition-colors svelte-1n2426w"${attr("title", "Descending")}>${escape_html("↓ Desc")}</button></div> <label class="flex items-center gap-1.5 cursor-pointer svelte-1n2426w"><input type="checkbox"${attr("checked", showCompleted, true)} class="accent-cyan svelte-1n2426w"/> <span class="text-xs text-muted svelte-1n2426w">Show completed</span></label></div></div> `);
    {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="overflow-x-auto fade-up svelte-1n2426w"><div class="min-w-[680px] border border-edge rounded overflow-hidden svelte-1n2426w"><div class="grid grid-cols-[52px_1fr_148px_96px_96px_60px] text-xs text-muted uppercase tracking-widest bg-base-hi border-b border-edge svelte-1n2426w"><div class="px-3 py-2.5 text-center svelte-1n2426w">Pri</div> <div class="px-3 py-2.5 svelte-1n2426w">Title</div> <div class="px-3 py-2.5 svelte-1n2426w">Status</div> <div class="px-3 py-2.5 svelte-1n2426w">Agent</div> <div class="px-3 py-2.5 svelte-1n2426w">Repo</div> <div class="px-3 py-2.5 text-right svelte-1n2426w">Age</div></div> <!--[-->`);
      const each_array_2 = ensure_array_like(Array(8));
      for (let i = 0, $$length = each_array_2.length; i < $$length; i++) {
        each_array_2[i];
        const skeletonWidths = [75, 60, 90, 55, 80, 65, 70, 85];
        $$renderer2.push(`<div${attr_class(`grid grid-cols-[52px_1fr_148px_96px_96px_60px] border-b border-edge last:border-0 fade-up ${stringify(i % 2 === 1 ? "bg-base-hi" : "bg-base")}`, "svelte-1n2426w")}${attr_style(`animation-delay: ${stringify(i * 30)}ms`)}><div class="px-3 py-3 flex justify-center items-center svelte-1n2426w"><div class="skeleton h-4 w-6 rounded svelte-1n2426w"></div></div> <div class="px-3 py-3 flex items-center gap-2 svelte-1n2426w"><div class="skeleton h-4 rounded svelte-1n2426w"${attr_style(`width: ${stringify(skeletonWidths[i])}%`)}></div></div> <div class="px-3 py-3 flex items-center svelte-1n2426w"><div class="skeleton h-5 w-24 rounded svelte-1n2426w"></div></div> <div class="px-3 py-3 flex items-center svelte-1n2426w"><div class="skeleton h-4 w-16 rounded svelte-1n2426w"></div></div> <div class="px-3 py-3 flex items-center svelte-1n2426w"><div class="skeleton h-4 w-14 rounded svelte-1n2426w"></div></div> <div class="px-3 py-3 flex items-center justify-end svelte-1n2426w"><div class="skeleton h-3 w-8 rounded svelte-1n2426w"></div></div></div>`);
      }
      $$renderer2.push(`<!--]--></div></div>`);
    }
    $$renderer2.push(`<!--]--></div> `);
    Modal($$renderer2, {
      open: showModal,
      onClose: closeModal,
      label: "New Issue",
      children: ($$renderer3) => {
        $$renderer3.push(`<div class="flex items-center justify-between mb-5 svelte-1n2426w"><h2 class="text-primary font-bold uppercase tracking-wide text-sm svelte-1n2426w">New Issue</h2> <button class="text-muted hover:text-primary transition-colors text-xl leading-none svelte-1n2426w" aria-label="Close modal">×</button></div> <form class="space-y-4 svelte-1n2426w"><div class="svelte-1n2426w"><label for="issue-title" class="block text-xs text-muted uppercase tracking-widest mb-1.5 svelte-1n2426w">Title <span class="text-red svelte-1n2426w">*</span></label> <input id="issue-title"${attr("value", newTitle)} required="" placeholder="e.g. Fix authentication bug" class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-cyan transition-colors svelte-1n2426w"/></div> <div class="svelte-1n2426w"><label for="issue-description" class="block text-xs text-muted uppercase tracking-widest mb-1.5 svelte-1n2426w">Description <span class="text-red svelte-1n2426w">*</span></label> <textarea id="issue-description" required="" rows="4" placeholder="Describe the issue… (Markdown supported)" class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-cyan transition-colors resize-y svelte-1n2426w">`);
        const $$body = escape_html(newDescription);
        if ($$body) {
          $$renderer3.push(`${$$body}`);
        }
        $$renderer3.push(`</textarea></div> `);
        {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]--> <div class="flex gap-3 pt-1 svelte-1n2426w"><button type="submit"${attr("disabled", submitting, true)} class="flex-1 py-2 bg-cyan/10 border border-cyan text-cyan text-sm font-medium rounded hover:bg-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wide svelte-1n2426w">${escape_html("Create Issue")}</button> <button type="button"${attr("disabled", submitting, true)} class="px-4 py-2 bg-surface border border-edge text-secondary text-sm rounded hover:border-edge-hi transition-colors disabled:opacity-50 svelte-1n2426w">Cancel</button></div></form>`);
      }
    });
    $$renderer2.push(`<!---->`);
  });
}

export { _page as default };
//# sourceMappingURL=_page.svelte-C2IDYshf.js.map
