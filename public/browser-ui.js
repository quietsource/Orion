const tabsNode = document.querySelector('#tabs');
const address = document.querySelector('#address');
const back = document.querySelector('#back');
const forward = document.querySelector('#forward');
const reload = document.querySelector('#reload');
const status = document.querySelector('#status');
let snapshot = { activeId: null, tabs: [] };

function render(state) {
  snapshot = state;
  tabsNode.replaceChildren();
  for (const tab of state.tabs) {
    const item = document.createElement('div');
    item.className = `tab${tab.id === state.activeId ? ' active' : ''}`;
    item.title = tab.url || tab.title;
    const title = document.createElement('button');
    title.className = 'tab-title';
    title.type = 'button';
    title.textContent = tab.title || 'New tab';
    title.addEventListener('click', () => void window.orionBrowser.focus(tab.id));
    const close = document.createElement('button');
    close.className = 'tab-close';
    close.type = 'button';
    close.setAttribute('aria-label', `Close ${tab.title || 'tab'}`);
    close.textContent = '×';
    close.addEventListener('click', () => void window.orionBrowser.close(tab.id));
    item.append(title, close);
    item.addEventListener('click', event => { if (event.target === item) void window.orionBrowser.focus(tab.id); });
    tabsNode.append(item);
  }
  const active = state.tabs.find(tab => tab.id === state.activeId);
  address.value = active?.url || '';
  address.placeholder = active?.url ? '' : 'Search or enter address';
  back.disabled = !active?.canGoBack;
  forward.disabled = !active?.canGoForward;
  reload.textContent = active?.loading ? '×' : '↻';
  reload.title = active?.loading ? 'Stop loading' : 'Reload';
  status.textContent = active?.loading ? 'Loading…' : active?.url || 'Ready';
}

window.orionBrowser.onState(render);
void window.orionBrowser.state().then(render);
document.querySelector('#address-form').addEventListener('submit', event => { event.preventDefault(); void window.orionBrowser.navigate(address.value); });
document.querySelector('#new-tab').addEventListener('click', () => void window.orionBrowser.create());
back.addEventListener('click', () => void window.orionBrowser.action('back'));
forward.addEventListener('click', () => void window.orionBrowser.action('forward'));
reload.addEventListener('click', () => void window.orionBrowser.action(snapshot.tabs.find(tab => tab.id === snapshot.activeId)?.loading ? 'stop' : 'reload'));
window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') { event.preventDefault(); address.focus(); address.select(); }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Tab') { event.preventDefault(); const index = snapshot.tabs.findIndex(tab => tab.id === snapshot.activeId); const offset = event.shiftKey ? -1 : 1; const next = snapshot.tabs[(index + offset + snapshot.tabs.length) % snapshot.tabs.length]; if (next) void window.orionBrowser.focus(next.id); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 't') { event.preventDefault(); void window.orionBrowser.create(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w') { event.preventDefault(); if (snapshot.activeId) void window.orionBrowser.close(snapshot.activeId); }
  if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key)) { event.preventDefault(); const tab = snapshot.tabs[Number(event.key) - 1]; if (tab) void window.orionBrowser.focus(tab.id); }
});
