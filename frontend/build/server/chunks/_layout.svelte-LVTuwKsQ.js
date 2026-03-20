import { r as setContext } from './index2-BGzPKYvd.js';
import { o as onDestroy } from './index-server-B3_fMyPJ.js';
import './root-CKzQD30d.js';
import './state.svelte-7tx-nND4.js';

function _layout($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { children } = $$props;
    let ws = null;
    setContext("projectWs", () => ws);
    onDestroy(() => {
    });
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    children($$renderer2);
    $$renderer2.push(`<!---->`);
  });
}

export { _layout as default };
//# sourceMappingURL=_layout.svelte-LVTuwKsQ.js.map
