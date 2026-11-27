'use strict';

globalThis.ZephyrStudioToolbar = (() => {
  const {el,button,select}=ThreadStudioUI;

  function menu(label,controls) {
    const list=el('div','studio-menu-list',...controls);
    const summary=el('summary','',label);
    const details=el('details','studio-menu',summary,list);
    list.addEventListener('click',event=>{if(event.target.closest('button')) details.open=false;});
    details.addEventListener('keydown',event=>{
      if(event.key==='Escape'){details.open=false;summary.focus();event.preventDefault();}
    });
    details.addEventListener('focusout',event=>{
      if(event.relatedTarget && !details.contains(event.relatedTarget)) details.open=false;
    });
    return details;
  }

  class DebugControls {
    constructor(t,send) {
      this.t=t;this.send=send;this.state={};this.trusted=false;
      this.start=button(t('启动调试','Start debugging'),()=>this.dispatch('start'),'studio-debug-start');
      this.start.dataset.command='debug';
      const labels={continue:t('继续','Continue'),pause:t('暂停','Pause'),next:t('逐过程','Step over'),
        stepIn:t('步入','Step into'),stepOut:t('跳出','Step out'),frame:t('定位栈帧','Reveal stack frame'),stop:t('停止','Stop')};
      this.buttons={};
      for(const [op,label] of Object.entries(labels)){
        const item=button(label,()=>this.dispatch(op));item.dataset.debug=op;
        this.buttons[op]=item;
      }
      this.sessionSlot=el('span','studio-sessions');this.label=el('span','studio-debug-state');
      this.label.setAttribute('role','status');
      this.more=menu(t('单步','Stepping'),[this.buttons.next,this.buttons.stepIn,this.buttons.stepOut,this.buttons.frame]);
      this.root=el('div','studio-debug',this.sessionSlot,this.label,this.start,this.buttons.continue,this.buttons.pause,this.more,this.buttons.stop);
      this.update({});
    }
    dispatch(op,id) {
      if(this.trusted) this.send('debug',{op,token:this.state.token,id});
    }
    trust(value){if(this.trusted!==value){this.trusted=value;this.update(this.state);}}
    update(state){
      this.state=state;
      const active=Boolean(state.active),stopped=Boolean(state.paused || state.phase==='stopped');
      this.start.hidden=active;this.start.disabled=!this.trusted;
      this.start.title=this.trusted?this.t('启动工程调试配置','Start a project debug configuration'):this.t('请先信任工作区','Trust the workspace to debug');
      this.label.textContent=active ? [state.name,stopped?this.t('已暂停','Paused'):state.phase==='running'?this.t('运行中','Running'):null].filter(Boolean).join(' · ') : '';
      this.label.title=state.frame?.name || '';
      for(const [op,item] of Object.entries(this.buttons)) {
        item.hidden=!active || (op==='continue' && !stopped) || (op==='pause' && (stopped || state.phase!=='running'));
        item.disabled=!this.trusted || (!['stop','pause','continue'].includes(op) && !stopped);
      }
      this.more.hidden=!active || !stopped;
      this.buttons.frame.disabled=!this.trusted || !state.frame;
      this.sessionSlot.replaceChildren();
      if(active && state.sessions?.length>1) this.sessionSlot.append(select(this.t('调试会话','Debug session'),
        state.sessions.map(s=>[s.id,s.name]),state.sessionId,id=>this.dispatch('session',id)));
    }
  }

  function mount(toolbar,t,action) {
    const labels={
      new:t('新建设计','New design'),open:t('打开设计…','Open design…'),demo:t('播放固件示例','Play firmware example'),
      save:t('保存','Save'),copy:t('另存为…','Save as…'),text:t('并排编辑 JSON','Edit JSON beside'),
      export:t('导出新应用…','Export application…'),apply:t('审查源码更新…','Review source changes…'),
      liveSource:t('实时 C 源码图','Live C source diagram'),analysis:t('分析工程并发','Analyze project concurrency'),
      window:t('独立窗口','Separate window')};
    const make=name=>{
      const control=button(labels[name],()=>action(name));control.dataset.command=name;return control;
    };
    const debug=new DebugControls(t,action);
    toolbar.append(menu(t('文件','File'),['new','open','demo','save','copy','text','export','apply'].map(make)),
      menu(t('工具','Tools'),['analysis','liveSource'].map(make)),debug.root,make('window'));
    return debug;
  }
  return {mount};
})();
