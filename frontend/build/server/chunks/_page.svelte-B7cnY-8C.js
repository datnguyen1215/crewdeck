import { c as ensure_array_like, m as attr_style, f as stringify, l as attr, d as attr_class, h as escape_html } from './index2-BGzPKYvd.js';
import './root-CKzQD30d.js';
import './state.svelte-7tx-nND4.js';
import { M as Modal } from './Modal-C8eh0UL9.js';

function ProjectForm($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const { githubAccounts = [], onCancel } = $$props;
    let githubUrl = "";
    let selectedGitHubAccountId = "";
    let submitting = false;
    let githubUrlError = "";
    $$renderer2.push(`<form class="flex flex-col gap-4"><div><label for="proj-github-url" class="block text-xs text-muted uppercase tracking-widest mb-1.5">GitHub URL <span class="text-red">*</span></label> <input id="proj-github-url" type="text"${attr("value", githubUrl)} placeholder="https://github.com/owner/repo"${attr_class("w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:border-cyan transition-colors", void 0, { "border-red": githubUrlError })}/> `);
    {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<p class="text-muted text-xs mt-1">Name, description, and branch will be fetched automatically</p>`);
    }
    $$renderer2.push(`<!--]--></div> `);
    if (githubAccounts.length > 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div><label for="proj-gh-account" class="block text-xs text-muted uppercase tracking-widest mb-1.5">GitHub Account</label> `);
      $$renderer2.select(
        {
          id: "proj-gh-account",
          value: selectedGitHubAccountId,
          class: "w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary focus:outline-none focus:border-cyan transition-colors"
        },
        ($$renderer3) => {
          $$renderer3.option({ value: "" }, ($$renderer4) => {
            $$renderer4.push(`None (use host credentials)`);
          });
          $$renderer3.push(`<!--[-->`);
          const each_array = ensure_array_like(githubAccounts);
          for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
            let account = each_array[$$index];
            $$renderer3.option({ value: account.id }, ($$renderer4) => {
              $$renderer4.push(`${escape_html(account.github_username)} (${escape_html(account.account_name)})`);
            });
          }
          $$renderer3.push(`<!--]-->`);
        }
      );
      $$renderer2.push(`</div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <div class="flex gap-3 mt-2">`);
    if (onCancel) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<button type="button"${attr("disabled", submitting, true)} class="flex-1 px-4 py-2 border border-edge rounded text-sm text-secondary hover:text-primary hover:border-edge-hi transition-colors disabled:opacity-50">Cancel</button>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <button type="submit"${attr("disabled", submitting, true)} class="flex-1 px-4 py-2 bg-cyan/10 border border-cyan rounded text-sm text-cyan hover:bg-cyan/20 transition-colors disabled:opacity-50">${escape_html("Create Project")}</button></div></form>`);
  });
}
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let projects = [];
    let githubAccounts = [];
    let showModal = false;
    function closeModal() {
      showModal = false;
    }
    $$renderer2.push(`<div class="p-8 h-full overflow-auto"><div class="flex items-center justify-between mb-10 fade-up"><div><h1 class="text-2xl font-bold tracking-[0.3em] uppercase" style="color: var(--color-cyan); text-shadow: var(--glow-cyan)">CREWDECK</h1> <p class="text-muted text-xs mt-1 tracking-widest uppercase">AI Agent Crew Management</p></div> `);
    if (projects.length > 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<button class="flex items-center gap-2 px-4 py-2 bg-surface border border-edge rounded text-sm text-secondary hover:text-cyan hover:border-cyan transition-colors" style="hover:box-shadow: var(--glow-cyan)"><span class="text-cyan font-bold">+</span> New Project</button>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div> `);
    {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"><!--[-->`);
      const each_array = ensure_array_like(Array(6));
      for (let i = 0, $$length = each_array.length; i < $$length; i++) {
        each_array[i];
        $$renderer2.push(`<div class="bg-surface border border-edge rounded-lg p-5 flex flex-col gap-4 fade-up"${attr_style(`animation-delay: ${stringify(i * 40)}ms`)}><div><div class="skeleton h-4 w-3/5 rounded mb-2"></div> <div class="skeleton h-3 w-2/5 rounded"></div></div> <div class="flex gap-4"><div class="skeleton h-3 w-16 rounded"></div> <div class="skeleton h-3 w-16 rounded"></div></div> <div><div class="skeleton h-1.5 w-full rounded-full mb-2"></div> <div class="flex gap-2"><!--[-->`);
        const each_array_1 = ensure_array_like(Array(5));
        for (let $$index = 0, $$length2 = each_array_1.length; $$index < $$length2; $$index++) {
          each_array_1[$$index];
          $$renderer2.push(`<div class="skeleton h-3 w-8 rounded"></div>`);
        }
        $$renderer2.push(`<!--]--></div></div> <div class="skeleton h-8 w-full rounded mt-auto"></div></div>`);
      }
      $$renderer2.push(`<!--]--></div>`);
    }
    $$renderer2.push(`<!--]--></div> `);
    Modal($$renderer2, {
      open: showModal,
      onClose: closeModal,
      label: "Create new project",
      maxWidth: "max-w-md",
      children: ($$renderer3) => {
        $$renderer3.push(`<div class="flex items-center justify-between mb-6"><h2 class="text-primary font-bold tracking-wide uppercase text-sm">New Project</h2> <button class="text-muted hover:text-primary transition-colors text-lg leading-none" aria-label="Close">✕</button></div> `);
        ProjectForm($$renderer3, {
          githubAccounts,
          onCancel: closeModal
        });
        $$renderer3.push(`<!---->`);
      }
    });
    $$renderer2.push(`<!---->`);
  });
}

export { _page as default };
//# sourceMappingURL=_page.svelte-B7cnY-8C.js.map
