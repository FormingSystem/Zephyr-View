'use strict';

/** Owns the preview and committed appearance of one workbench window. */
class workbench_appearance {
  constructor({ document, button, system_theme, save, system_label }) {
    this.root = document.documentElement;

    this.system_theme = system_theme;
    this.save = save;
    this.settings = { theme: 'system', density: 'auto' };
    const chinese = document.documentElement.lang.toLowerCase().startsWith('zh');
    const label = (zh, en) => chinese ? zh : en;
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'appearance-dialog';
    this.dialog.setAttribute('aria-labelledby', 'appearance-title');
    this.dialog.innerHTML = '<h2 id="appearance-title"></h2><form method="dialog"></form>';
    const heading = label('工作台外观', 'Workbench appearance');
    this.dialog.querySelector('h2').textContent = heading;
    this.form = this.dialog.querySelector('form');
    this.add_select('theme', label('配色', 'Colors'), {
      system: system_label, light: label('浅色', 'Light'), dark: label('深色', 'Dark')
    });
    this.add_select('density', label('界面密度', 'Spacing'), {
      auto: label('自适应', 'Adaptive'), compact: label('紧凑', 'Compact'), comfortable: label('宽松', 'Comfortable')
    });
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(this.button(label('取消', 'Cancel'), 'cancel'), this.button(label('应用', 'Apply'), 'apply'));
    this.form.append(actions);
    document.body.append(this.dialog);
    button.title = heading;
    button.setAttribute('aria-label', heading);
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', this.dialog.id);
    button.onclick = () => this.open();
    this.form.onchange = () => this.paint(this.selection());
    this.form.onsubmit = event => this.submit(event);
    this.dialog.oncancel = () => this.paint(this.settings);
    this.dialog.onclose = () => { if (!this.dialog.open) this.refresh_theme(); };
    this.refresh_theme();
  }

  add_select(name, caption, choices) {
    const document = this.dialog.ownerDocument;
    const label = document.createElement('label');
    const select = document.createElement('select');
    select.name = name;
    for (const [value, text] of Object.entries(choices)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    label.append(caption, select);
    this.form.append(label);
  }

  button(caption, value) {
    const button = this.dialog.ownerDocument.createElement('button');
    button.value = value;
    button.textContent = caption;
    if (value === 'apply') {
      button.className = 'primary';
    } else {
      button.type = 'button';
      button.onclick = () => this.close();
    }
    return button;
  }

  selection() {
    return { theme: this.form.elements.theme.value, density: this.form.elements.density.value };
  }

  /** Accept only known preferences, including records from older installations. */
  receive(values = {}) {
    for (const name of ['theme', 'density']) {
      const options = Array.from(this.form.elements[name].options);
      this.settings[name] = (options.find(option => option.value === values[name]) || options[0]).value;
    }
    this.refresh_theme();
  }

  open() {
    this.opened_settings = {...this.settings};
    for (const [name, value] of Object.entries(this.settings)) this.form.elements[name].value = value;
    this.dialog.showModal();
    this.form.elements.theme.focus();
  }

  submit(event) {
    event.preventDefault();
    if (event.submitter?.value === 'apply') {
      const values = this.selection();
      const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => this.opened_settings[key] !== value));
      if (Object.keys(changes).length) {
        Object.assign(this.settings, changes);
        this.save(changes);
      }
    }
    this.close();
  }

  close() {
    this.dialog.close();
    this.paint(this.settings);
  }

  refresh_theme() {
    this.paint(this.dialog.open ? this.selection() : this.settings);
  }

  paint(settings) {
    this.root.dataset.scheme = settings.theme;
    this.root.dataset.theme = settings.theme === 'system' ? this.system_theme() : settings.theme;
    this.root.dataset.density = settings.density;
  }
}
