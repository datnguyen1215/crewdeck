import { l as attr, d as attr_class, f as stringify } from './index2-BGzPKYvd.js';

function Modal($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      open,
      onClose,
      label,
      maxWidth = "max-w-lg",
      cardClass = "",
      escapeClose = true,
      children
    } = $$props;
    if (open) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true"${attr("aria-label", label)}><div${attr_class(`bg-surface border border-edge rounded w-full ${stringify(maxWidth)} mx-4 p-6 shadow-2xl ${stringify(cardClass)}`)}>`);
      children($$renderer2);
      $$renderer2.push(`<!----></div></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]-->`);
  });
}

export { Modal as M };
//# sourceMappingURL=Modal-C8eh0UL9.js.map
