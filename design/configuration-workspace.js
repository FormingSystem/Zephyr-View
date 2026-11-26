'use strict';

/** Keep graph navigation, the inspector and draft review in one editor viewport. */
class ConfigurationWorkspace {
  constructor({toggleWindow, moveWindow, present, exitFullscreen, contextChanged = () => {}}) {
    this.toggleWindow = toggleWindow;
    this.moveWindow = moveWindow;
    this.present = present;
    this.exitFullscreen = exitFullscreen;
    this.contextChanged = contextChanged;
    this.expanded = false;
    this.detached = false;
    this.presentation = false;
    this.pane = '';
  }

  setWindow(detached, pane, presentation = false) {
    this.presentation = presentation;
    if (this.detached !== detached) {
      this.detached = detached;
      this.expanded = detached;
      this.pane = '';
    }
    if (this.expanded && ['inspector', 'drafts'].includes(pane)) this.pane = pane;
  }

  controls() {
    const button = (id, caption, icon) =>
      '<button type="button" data-canvas-action="'+id+'" title="'+esc(caption)+'" aria-label="'+esc(caption)+'">'+
      '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="'+icon+'"/></svg><span>'+esc(caption)+'</span></button>';
    const fullscreen = 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6';
    const restore = 'M3 9h6V3m6 0v6h6M9 21v-6H3m12 6v-6h6';
    const move = 'M13 3h8v8m0-8L10 14M9 5H4v15h15v-5';
    return button('expand', tr('全屏配置','Full-screen configuration'), fullscreen)+
      button('window', tr('切换窗口全屏','Toggle window full screen'), fullscreen)+
      button('restore', tr('退出画布模式','Exit canvas mode'), restore)+
      button('detach', tr('在新窗口配置','Configure in new window'), move)+
      button('attach', this.presentation ? tr('退出全屏配置','Exit full-screen configuration') : tr('返回主窗口','Return to main window'),
        'M11 3H3v8m0-8 11 11m0-9h6v15H5v-6');
  }

  layout(map, drafts, inspector) {
    const toggle = (id, label) => '<button type="button" data-canvas-pane="'+id+'" aria-controls="canvas-'+id+'" aria-expanded="false">'+
      esc(label)+(id==='drafts'?' <span data-pending-drafts></span>':'')+'</button>';
    return '<div class="studio-layout"><div class="canvas-diagram">'+map+'</div>'+
      '<div class="canvas-dock">'+toggle('inspector', tr('配置检查器','Inspector'))+
      toggle('drafts', tr('配置草稿','Drafts'))+'</div>'+
      '<section id="canvas-drafts">'+drafts+'</section><section id="canvas-inspector">'+inspector+'</section></div>';
  }

  fragmentKind(kind) {
    const option=(value,label)=>'<option value="'+value+'"'+(value===kind?' selected':'')+'>'+esc(label)+'</option>';
    return '<select id="studio-fragment-kind" aria-label="'+esc(tr('编辑片段类型','Fragment type'))+'">'+
      option('kconfig','Kconfig')+option('device',tr('设备树覆盖','Devicetree overlays'))+'</select>';
  }

  attach(count) {
    this.main = document.getElementById('main');
    this.main.addEventListener('click', this.handleClick);
    document.addEventListener('keydown', this.handleEscape);
    this.update();
    this.showCount(count);
  }

  showCount(count) {
    const badge = this.main?.querySelector('[data-pending-drafts]');
    if (badge) badge.textContent = count ? String(count) : '';
  }

  leave() {
    this.main?.removeEventListener('click', this.handleClick);
    document.removeEventListener('keydown', this.handleEscape);
    this.main = undefined;
    this.expanded = this.detached = this.presentation = false;
    this.pane = '';
    document.documentElement.removeAttribute('data-studio-expanded');
  }

  openPane(pane) {
    if (!this.expanded) return;
    this.pane = pane;
    this.update();
    this.contextChanged();
  }

  update() {
    const root = document.documentElement;
    root.toggleAttribute('data-studio-expanded', this.expanded);
    if (!this.main) return;
    const visible = {expand:!this.expanded, window:this.expanded && !this.presentation, restore:this.expanded && !this.detached,
      detach:!this.detached, attach:this.detached};
    for (const button of this.main.querySelectorAll('[data-canvas-action]')) button.hidden = !visible[button.dataset.canvasAction];
    for (const button of this.main.querySelectorAll('[data-canvas-pane]')) {
      const pane = button.dataset.canvasPane;
      const open = this.expanded && this.pane === pane;
      button.setAttribute('aria-expanded', String(open));
      this.main.querySelector('#canvas-'+pane).hidden = this.expanded && !open;
    }
  }

  handleClick = event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.canvasPane) {
      this.openPane(this.pane === button.dataset.canvasPane ? '' : button.dataset.canvasPane);
      return;
    }
    const action = button.dataset.canvasAction;
    if (action === 'detach' || action === 'attach') return this.moveWindow(action);
    if (action === 'window') return this.toggleWindow();
    if (action !== 'expand' && action !== 'restore') return;
    if (action === 'expand' && this.present) return this.present();
    this.expanded = action === 'expand';
    this.pane = '';
    this.update();
    this.main.querySelector('[data-canvas-action="'+(this.expanded?'restore':'expand')+'"]')?.focus({preventScroll:true});
    if (this.expanded) this.toggleWindow(); else this.exitFullscreen?.();
    this.contextChanged();
  };

  handleEscape = event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !this.expanded || document.querySelector('dialog[open]')) return;
    if (!event.target.isConnected || event.target.closest('.target-picker,.map-node-editor')) return;
    if (this.pane) {
      const previous = this.pane;
      this.openPane('');
      this.main.querySelector('[data-canvas-pane="'+previous+'"]').focus({preventScroll:true});
    } else if (this.presentation) {
      this.moveWindow('attach');
    } else if (!this.detached) {
      this.expanded = false;
      this.update();
      this.main.querySelector('[data-canvas-action="expand"]').focus({preventScroll:true});
      this.exitFullscreen?.();
    } else return;
    event.preventDefault();
  };
}
