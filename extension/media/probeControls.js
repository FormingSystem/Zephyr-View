'use strict';

const probeControls = (() => {
  let folder, trusted, result;
  const expanded = new Set();

  function render(state) {
    if (state.folder !== folder || state.trusted !== trusted) {
      folder = state.folder;
      trusted = state.trusted;
      result = undefined;
      expanded.clear();
    }
    return probeListView.render({
      rows:result?.rows || state.probeProfiles || [],
      scanning:trusted && (result?.scanning ?? true), error:result?.error,
      trusted, editable:Boolean(folder && trusted && !state.busy)
    });
  }
  function restoreDetails() {
    for (const details of document.querySelectorAll('[data-probe-details]')) {
      details.open = expanded.has(details.dataset.probeDetails);
    }
  }
  function enter(state) {
    const panel = document.getElementById('probe-panel');
    if (!panel) return;
    restoreDetails();
    if (state.trusted) send('probeList');
    if (state.openProbes) {
      const id = state.openProbes.id;
      const row = [...panel.querySelectorAll('[data-probe-id]')].find(node=>node.dataset.probeId === id);
      const target = row || panel.querySelector('.ph button');
      target?.focus({preventScroll:true});
      (row || panel).scrollIntoView({block:'nearest'});
    }
  }
  function receive(list) {
    const panel = document.getElementById('probe-panel');
    if (!panel || live?.page !== 'workspace' || list.folder !== live.folder || !live.trusted) return;
    result = list;
    const focused = document.activeElement;
    const action = focused.dataset.act;
    const id = focused.closest('[data-probe-id]')?.dataset.probeId;
    const summary = focused.tagName === 'SUMMARY';
    panel.outerHTML = render(live);
    restoreDetails();
    if (!id && action !== 'probe:refresh') return;
    const scope = id ? document.querySelector('[data-probe-id="'+CSS.escape(id)+'"]') : document.getElementById('probe-panel');
    const button = action ? scope?.querySelector('[data-act="'+CSS.escape(action)+'"]:not(:disabled)') : undefined;
    (button || (summary && scope?.querySelector('summary')) || scope)?.focus({preventScroll:true});
  }
  window.addEventListener('message', ({data})=>{
    if (data?.probeList) receive(data.probeList);
  });
  document.addEventListener('toggle', ({target})=>{
    const id = target.dataset?.probeDetails;
    if (!id || !target.isConnected) return;
    if (target.open) expanded.add(id);
    else expanded.delete(id);
  },true);
  document.addEventListener('click', event=>{
    const button = event.target.closest('[data-act^="probe:"]');
    if (!button || button.disabled) return;
    const [,op,id] = button.dataset.act.split(':');
    send('probeAction', id ? {id,op} : {op});
  });
  return {render,enter};
})();
