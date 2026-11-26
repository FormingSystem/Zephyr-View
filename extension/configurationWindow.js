'use strict';

/** Move the existing configuration editor, taking its unsaved view with it. */
class ConfigurationWindow {
  constructor() {
    this.reset();
  }

  reset() {
    this.homeGroup = undefined;
    this.transfer = undefined;
    this.moving = false;
    this.presentation = false;
    this.enterFullscreen = false;
    this.visitedFloatingGroup = false;
    this.checkpoint = undefined;
  }

  get detached() {
    return this.homeGroup !== undefined;
  }

  remember(panel, scope, state) {
    if (!this.detached || state?.studioMapView?.scope !== scope) return;
    const previous = this.checkpoint?.state.studioDraftsV1 || [];
    const otherTargets = previous.filter(([key]) => key !== scope);
    const updated = {...state, studioDraftsV1:[...otherTargets, ...(state.studioDraftsV1 || [])]};
    this.checkpoint = {panel, scope, state:updated};
  }

  close() {
    const last = this.detached && this.checkpoint;
    this.reset();
    if (last) this.checkpoint = {scope:last.scope, state:last.state};
    return Boolean(last);
  }

  async move({detach, presentation, panel, groups, scope, state, execute}) {
    if (!panel.active || this.moving || this.detached === detach) return;
    const origin = this.homeGroup;
    const previousPresentation = this.presentation;
    const destination = groups.all.includes(origin) ? origin : groups.all[0];
    this.homeGroup = detach ? groups.activeTabGroup : undefined;
    this.presentation = Boolean(detach && presentation);
    this.enterFullscreen = this.presentation;
    this.visitedFloatingGroup = false;
    this.transfer = {panel, scope, state, ready: false};
    this.checkpoint = {panel, scope, state};
    this.moving = true;
    try {
      if (detach) await execute('workbench.action.moveEditorToNewWindow');
      else await execute('moveActiveEditor', {to:'position', by:'group', value:destination.viewColumn});
    } catch (error) {
      this.homeGroup = origin;
      this.presentation = previousPresentation;
      this.enterFullscreen = false;
      this.transfer = undefined;
      throw error;
    } finally {
      this.moving = false;
    }
  }

  // VS Code can announce the destination tab group before or after the move resolves.
  async activate(panel, groups, execute) {
    if (this.moving || !this.detached || !panel.active || panel.viewColumn !== groups.activeTabGroup.viewColumn) return;
    const home = groups.all.includes(this.homeGroup) ? this.homeGroup : groups.all[0];
    if (groups.activeTabGroup === home) {
      if (!this.visitedFloatingGroup) return;
      this.homeGroup = undefined;
      this.presentation = this.enterFullscreen = this.visitedFloatingGroup = false;
      return true;
    }
    this.visitedFloatingGroup = true;
    if (!this.enterFullscreen) return;
    this.enterFullscreen = false;
    await execute('workbench.action.toggleFullScreen');
  }

  ready(panel) {
    if (this.transfer?.panel === panel) this.transfer.ready = true;
    else if (this.checkpoint && (!this.checkpoint.panel || this.checkpoint.panel === panel)) {
      this.transfer = {...this.checkpoint, panel, ready:true};
    }
  }

  forTarget(panel, scope) {
    const transfer = this.transfer;
    if (!transfer?.ready || transfer.panel !== panel) return;
    if (transfer.scope === scope) return transfer;
    this.transfer = undefined;
  }

  delivered(transfer) {
    if (this.transfer === transfer) this.transfer = undefined;
    if (!this.detached) this.checkpoint = undefined;
  }
}

module.exports = {ConfigurationWindow};
