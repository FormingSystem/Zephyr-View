'use strict';

globalThis.ZephyrProgramPlayback = (() => {
  const {el,button,select} = ThreadStudioUI;
  const {MAX_BYTES,TraceStream,parse} = ZephyrProgramTrace;

  class Playback {
    constructor(root,options) {
      this.root=root;
      this.options=options;
      const en=!String(options.language || document.documentElement.lang).toLowerCase().startsWith('zh');
      this.t=(zh,english)=>en ? english : zh;
      this.delay=750;
      this.position=-1;
      this.generation=0;
      this.build();
      this.draw();
    }

    build() {
      const t=this.t;
      this.section=el('section','vp-playback');
      this.note=el('p','vp-play-note',t('以 -DZV_TRACE=ON 配置、构建并运行工程，然后选择串口日志。按记录顺序回看，速度为演示速度。','Configure with -DZV_TRACE=ON, build, run and select the console log. Playback follows record order at a display speed.'));
      this.output=el('output','vp-play-event');
      this.output.setAttribute('aria-live','off');
      this.info=el('p','vp-play-info');
      this.info.setAttribute('role','status');
      this.file=el('input'); this.file.type='file';this.file.hidden=true;
      this.file.addEventListener('change',()=>this.pick());
      const open=button(t('导入日志…','Import log…'),()=>this.options.requestFile ? this.options.requestFile() : this.file.click());
      const actions=el('div','vp-play-tools',open);
      if (this.options.requestFollow) {
        this.watch=button(t('跟踪日志…','Follow log…'),()=> {
          if (this.following) {this.options.requestStop?.();this.stopFollowing();}
          else this.options.requestFollow();
        });
        actions.append(this.watch);
      }
      this.previous=button('‹',()=>this.step(-1));
      this.next=button('›',()=>this.step(1));
      this.previous.setAttribute('aria-label',t('上一条记录','Previous record'));
      this.next.setAttribute('aria-label',t('下一条记录','Next record'));
      this.play=button('',()=>this.toggle());
      this.range=el('input','vp-play-range');
      this.range.type='range'; this.range.min=0;this.range.step=1;
      this.range.setAttribute('aria-label',t('定位日志记录','Seek to log record'));
      this.range.addEventListener('input',()=>{this.pause();this.seek(Number(this.range.value));});
      this.speed=select(t('回放间隔','Playback interval'),
        [[1500,'0.5×'],[750,'1×'],[375,'2×'],[188,'4×']],750,ms=>{
          this.delay=Number(ms);
          if (this.timer) this.schedule();
        });
      const controls=el('div','vp-play-tools',this.previous,this.play,this.next,this.speed);
      this.section.append(el('h3','',t('运行轨迹','Execution trace')),this.note,actions,this.file,this.info,
        this.range,controls,this.output);
      this.root.append(this.section);
    }

    async pick() {
      const file=this.file.files?.[0];
      this.file.value='';
      if (!file) return;
      const ticket=++this.generation;
      if (file.size>MAX_BYTES) return this.fail('file-size');
      try {
        const text=await file.text();
        if (this.generation===ticket) this.load(text);
      } catch {if (this.generation===ticket) this.fail('file-read');}
    }

    fail(reason) {
      this.clear();
      this.info.textContent=reason==='file-size' ? this.t('文件超过 4 MiB，请导入较短的截取日志。','File exceeds 4 MiB. Import a shorter capture.') :
        reason==='invalid-model' ? this.t('请先修正程序图，再匹配运行记录。','Correct the program graph before matching a capture.') :
        this.t('无法读取日志。','Could not read the log.');
    }

    load(text) {
      if (this.following) this.options.requestStop?.();
      this.clear();
      try {this.data=parse(text,this.options.model());}
      catch(error) {return this.fail(error.message);}
      this.draw();
    }

    follow(text,{reset=false,gap=false}={}) {
      try {
        if (!this.following || reset) {
          const restarted=this.following;
          this.clear();
          this.data=new TraceStream(this.options.model());
          this.restarted=restarted;
          this.following=true;
          this.tail=true;
          this.draw();
        }
        if (!this.sync()) return;
        const n=this.data.append(text,gap);
        if (!n) return;
        if (this.tail) this.seek(this.last());
        else this.draw();
      } catch(error) {
        this.options.requestStop?.();
        this.fail(error.message);
      }
    }

    stopFollowing() {
      if (!this.following) return;
      this.data.finish();
      if (this.tail && this.data.rows.length) this.seek(this.last());
      this.following=false;
      this.pause();
      this.draw();
    }

    sync() {
      if (!this.data || this.data.fingerprint===ZephyrProgramModel.fingerprint(this.options.model())) return true;
      if (this.following) this.options.requestStop?.();
      this.clear();
      this.info.textContent=this.t('程序已改变，请导入本次构建的日志。','Program changed. Import a capture for this build.');
      return false;
    }

    first() {return this.data?.first || 0;}
    last() {return this.first()+(this.data?.rows.length || 0)-1;}

    seek(position) {
      if (!this.sync() || !this.data?.rows.length) return;
      this.position=Math.max(this.first(),Math.min(position,this.last()));
      const row=this.data.rows[this.position-this.first()];
      this.options.onEvent?.(row.kind==='event' ? row : null);
      this.draw();
    }

    step(offset) {
      this.pause();
      this.seek(this.position+offset);
    }

    pause() {
      clearTimeout(this.timer);
      this.timer=undefined;
      this.tail=false;
    }

    toggle() {
      if (!this.sync() || !this.data) return;
      if (this.timer || this.tail) this.pause();
      else if (this.following) {this.tail=true;this.seek(this.last());}
      else {
        if (this.position>=this.last() || this.position<this.first()) this.seek(this.first());
        if (this.position<this.last()) this.schedule();
      }
      this.draw();
    }

    schedule() {
      clearTimeout(this.timer);
      this.timer=setTimeout(()=>{
        this.timer=undefined;
        this.seek(this.position+1);
        if (this.position<this.last()) this.schedule();
        this.draw();
      },this.delay);
    }

    summary() {
      const t=this.t;
      if (!this.data) return '';
      const {counts,truncated}=this.data;
      const pieces=[t('匹配事件 ','Matched events ')+counts.event];
      for (const [key,zh,en] of [['foreign','其他构建','Other builds'],['malformed','格式异常','Malformed'],
        ['unmapped','步骤不匹配','Unmapped'],['inconsistent','条件与记录值矛盾','Contradictory branch values'],['loss','日志报告丢失','Logger loss markers'],['gap','读取缺口','Capture gaps']]) {
        if (counts[key]) pieces.push(t(zh,en)+' '+counts[key]);
      }
      if (truncated) pieces.push(t('仅导入前 20000 条记录','First 20000 records imported'));
      if (this.restarted) pieces.push(t('日志已重新开始，显示新文件中的记录','Log restarted; showing records from the new file'));
      if (this.first()) pieces.push(t('较早记录已移出窗口','Earlier records left the buffer'));
      return pieces.join(' · ');
    }

    describe(row) {
      const t=this.t;
      if (row.kind==='foreign') return t('其他构建','Different build')+' '+row.fingerprint;
      if (row.kind==='malformed') return t('无法解析此事件','Malformed event');
      if (row.kind==='inconsistent') return t('分支与该步骤的比较结果矛盾','Branch contradicts the recorded operand')+' · '+row.stepId+' · '+row.op+' · '+row.value;
      if (row.kind==='unmapped') return t('事件与图中的上下文、步骤或对象不符','Context, operation or object differs from the graph');
      if (row.kind==='loss') return t('日志报告丢失消息 ','Logger reports dropped messages ')+row.count;
      if (row.kind==='gap') return t('读取中断或记录不完整','Read gap or incomplete record');
      const {contextId,objectId,stepId,op,value}=row;
      let route=contextId;
      if (row.phase) return [contextId,stepId,row.callee,row.phase==='enter' ? t('调用输入','Call input') : t('返回值','Return value'),value].join(' · ');
      if (objectId) route=(op==='take' || op==='receive') ? objectId+' → '+contextId : contextId+' → '+objectId;
      const unit=op==='give' || op==='take' ? t('线程当前值','thread-local value') : t('值','value');
      return [route,stepId,op,unit+' '+value].join(' · ');
    }

    draw() {
      const t=this.t,first=this.first(),last=this.last(),hasRows=last>=first;
      this.info.textContent=this.summary();
      this.range.min=String(first);this.range.max=String(Math.max(first,last));
      this.range.value=String(Math.max(first,this.position));this.range.disabled=!hasRows;
      this.previous.disabled=!hasRows || this.position<=first;
      this.next.disabled=!hasRows || this.position>=last;
      this.speed.disabled=this.following || !hasRows;
      this.play.disabled=!hasRows && !this.following;
      this.play.textContent=this.timer || this.tail ? t('暂停','Pause') :
        this.following ? t('跟随最新事件','Follow latest') : t('播放','Play');
      if (this.watch) this.watch.textContent=this.following ? t('停止跟踪','Stop following') : t('跟踪日志…','Follow log…');
      const row=this.data?.rows[this.position-first];
      this.output.textContent=row ? t('行 ','Line ')+row.line+' · '+this.describe(row) : '';
      if (this.position>=0 && this.position<first) {
        this.output.textContent=t('选中的记录已移出窗口。','The selected record left the buffer.');
        this.options.onEvent?.(null);
      }
    }

    clear() {
      this.pause();
      this.generation++;
      this.following=false;
      this.restarted=false;
      this.position=-1;
      this.data=undefined;
      this.options.onEvent?.(null);
      this.draw();
    }

    dispose() {
      if (this.following) this.options.requestStop?.();
      this.clear();
      this.section.remove();
    }
  }

  return {mount:(root,options)=>new Playback(root,options)};
})();
