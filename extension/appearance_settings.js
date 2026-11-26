'use strict';

const section = 'zephyrWorkbench.appearance';
const options = {theme: ['system', 'light', 'dark'], density: ['auto', 'compact', 'comfortable']};

/** Stores presentation choices in the VS Code user profile, independent of the active project. */
class appearance_settings {
  constructor(workspace, user_scope) {
    this.workspace = workspace;
    this.user_scope = user_scope;
    this.pending = Promise.resolve();
  }

  read() {
    const config = this.workspace.getConfiguration(section);
    return {
      theme: config.inspect('theme')?.globalValue,
      density: config.get('density')
    };
  }

  update(changes) {
    const entries = Object.entries(options).filter(([key, values]) => values.includes(changes?.[key]));
    const write = async () => {
      const config = this.workspace.getConfiguration(section);
      for (const [key] of entries) await config.update(key, changes[key], this.user_scope);
    };
    const completed = this.pending.then(write);
    this.pending = completed.catch(() => {});
    return completed;
  }
}

module.exports = {appearance_settings};
