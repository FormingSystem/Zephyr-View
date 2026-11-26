'use strict';
(() => {
  const build_screen = new build_page();
  const sections = {build:['构建','Build'], workspace:['工作区','Workspace'],
    configuration:['工程配置','Project configuration'], modules:['模块','Modules']};
  let state;

  const navigation_bar = document.querySelector('header nav');
  for (const [key, labels] of Object.entries(sections)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.page = key;
    button.innerHTML = ico(({workspace:'folder', configuration:'graph'})[key] || key);
    button.append(tr(...labels));
    button.onclick = () => send('page', key);
    navigation_bar.append(button);
  }

  function navigation(snapshot) {
    for (const button of navigation_bar.children) {
      if (button.dataset.page === snapshot.page) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    document.getElementById('build-context').textContent = tr('构建 · ', 'Build · ')+snapshot.method;
  }

  window.addEventListener('message', ({data}) => {
    if (!data || !Object.hasOwn(sections, data.page)) return;
    const previous = state;
    if (previous?.page === 'build') build_screen.capture();
    if (studioArgumentDrafts.get(data.app) === data.argsText) studioArgumentDrafts.delete(data.app);
    targetPicker.close();
    state = data;
    displayModuleState(data);
    if (previous?.page !== data.page) requestAnimationFrame(() => window.scrollTo(0, 0));
    model.method = data.method;
    model.env.offline = stored().offline !== false;
    navigation(data);
    if (data.page === 'configuration') return studioView.open(data);
    studioView.leave();
    if (data.page === 'build') return build_screen.render($('#main'), data);
    if (data.page === 'workspace') $('#main').innerHTML = setupViews.workspace(data);
  });
  host.postMessage({action:'ready'});
})();

