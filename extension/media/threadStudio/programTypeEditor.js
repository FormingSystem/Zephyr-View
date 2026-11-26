'use strict';

globalThis.ZephyrProgramTypeEditor = (() => {
  const {el,button,select} = ThreadStudioUI;
  const model = ZephyrProgramModel;
  const field = (label,control) => el('label','vp-field',el('span','',label),control);
  const types_of = graph => Array.isArray(graph.types) ? graph.types.filter(type=>type && Array.isArray(type.members) && type.members.every(m=>m && typeof m.id==='string')) : [];
  const id = prefix => prefix+'_'+crypto.randomUUID();
  const button_for = (label,key,run) => {
    const control = button(label,run);
    control.dataset.action = key;
    return control;
  };

  /** Select a literal or a stable reference; member IDs are scoped to their type. */
  function operand(ctx,body,label,literal,current) {
    const {t,graph} = ctx, types = types_of(graph);
    const selected = model.enum_member(graph,current);
    const missing = current!==null && typeof current==='object' && !selected;
    const options = [['',t('数值','Number')], ...types.map(type=>[type.id,type.name])];
    if (missing) options.push(['$missing',model.operand_text(graph,current)+' · '+t('引用缺失','Missing reference')]);
    const slot = el('div','vp-fields');
    const kind = select(t('操作数类型','Operand type'), options, missing?'$missing':selected?.type.id || '', render);
    kind.dataset.field = 'operandType';
    let member;
    function render() {
      if (kind.value==='$missing') {
        member=null;
        slot.replaceChildren(el('span','vp-muted',t('请重新选择成员或输入数值。','Select a member or enter a number.')));
        return;
      }
      const type = types.find(type=>type.id===kind.value);
      if (!type) {member=null;slot.replaceChildren(field(label,literal));return;}
      const options = type.members.filter(m=>m && typeof m.id==='string').map(m=>[m.id,m.name+' · '+m.value]);
      const initial = type.id===selected?.type.id ? selected.member.id : options[0]?.[0];
      member = select(t('枚举成员','Enum member'),options,initial,()=>{});
      member.dataset.field = 'operandMember';
      slot.replaceChildren(field(t('枚举成员','Enum member'),member));
    }
    render();
    body.append(field(t('操作数类型','Operand type'),kind),slot);
    return () => {
      if (kind.value==='$missing') return current;
      return member ? {type:kind.value,member:member.value} : literal.value===''?'':literal.valueAsNumber;
    };
  }

  function used_members(graph,type_id) {
    const used = new Set();
    if (!Array.isArray(graph?.threads) || !Array.isArray(graph.functions??[])) return used;
    for (const owner of ZephyrProgramFlow.owners(graph)) {
      ZephyrProgramFlow.walk(owner.steps,step=>{
        if (step.value?.type===type_id) used.add(step.value.member);
      });
    }
    return used;
  }

  function text_input(value,label,key,update) {
    const node=el('input');
    node.value=value;node.setAttribute('aria-label',label);node.dataset.field=key;
    node.addEventListener('input',()=>update(node.value));
    return node;
  }

  function member_row(form,member,used) {
    const {t} = form.ctx;
    const label=t('成员名','Member name');
    const name=text_input(member.name,label,'memberName',value=>{member.name=value;});
    const number=text_input(member.value,t('无符号整数值','Unsigned value'),'memberValue',text=>{
      member.value=text===''?null:Number(text);
    });
    number.type='number';number.min='0';number.max='4294967295';number.step='1';
    const remove=button_for(t('移除','Remove'),'removeMember',()=>{
      form.draft.members=form.draft.members.filter(m=>m!==member);
      form.render_members();
    });
    remove.disabled=used || form.draft.members.length===1;
    if (remove.disabled) remove.title=used?t('有指令引用此成员，先修改操作数。','A step uses this member. Change its operand first.'):
      t('枚举至少保留一个成员。','Keep at least one enum member.');
    return el('div','vp-member-row',field(label,name),field(t('值','Value'),number),remove);
  }

  class type_form {
    constructor(ctx,type) {
      this.ctx=ctx;
      this.original=type?JSON.stringify(type):undefined;
      this.draft=type?structuredClone(type):{id:id('type'),name:'State',kind:'enum',members:[{id:id('member'),name:'idle',value:0}]};
      this.dialog=el('dialog','vp-type-dialog');
      this.members=el('div','vp-members');
      this.feedback=el('p','vp-type-error');
      this.feedback.setAttribute('role','alert');
    }

    open() {
      const {t}=this.ctx;
      const title=t('自定义 uint32 枚举','Custom uint32 enum');
      const name_label=t('类型名','Type name');
      const name=text_input(this.draft.name,name_label,'typeName',value=>{this.draft.name=value;});
      const add=button_for(t('添加成员','Add member'),'addMember',()=>{
        const names=new Set(this.draft.members.map(m=>m.name));
        let index=this.draft.members.length;
        while(names.has('value_'+index))index++;
        this.draft.members.push({id:id('member'),name:'value_'+index,value:index});
        this.render_members();
      });
      this.add=add;
      const actions=el('div','vp-tools-group',button_for(t('保存类型','Save type'),'saveType',()=>this.save(false)),
        button_for(t('取消','Cancel'),'cancelType',()=>this.dialog.close()));
      if (this.original) {
        const remove=button_for(t('删除类型','Delete type'),'deleteType',()=>this.save(true));
        remove.disabled=used_members(this.ctx.graph,this.draft.id).size>0;
        if(remove.disabled)remove.title=t('先替换引用此类型的操作数。','Replace operands that reference this type first.');
        actions.append(remove);
      }
      this.dialog.setAttribute('aria-label',title);
      this.dialog.append(el('h2','',title),field(name_label,name),this.members,add,this.feedback,actions);
      this.render_members();
      this.dialog.addEventListener('close',()=>this.dialog.remove(),{once:true});
      this.ctx.shell.append(this.dialog);
      this.dialog.showModal();
      name.focus();name.select();
    }

    render_members() {
      const used=used_members(this.ctx.graph,this.draft.id);
      this.members.replaceChildren(...this.draft.members.map(member=>member_row(this,member,used.has(member.id))));
      this.add.disabled=this.draft.members.length>=64;
    }

    save(remove) {
      const {graph,t}=this.ctx;
      if (!graph || (graph.types!==undefined && !Array.isArray(graph.types))) {
        this.feedback.textContent=t('先在设计文档中修复 types 列表。','Repair the types list in the design document first.');
        return;
      }
      const types=graph.types || [],current=types.find(type=>type?.id===this.draft.id);
      if (JSON.stringify(current)!==this.original) {
        this.feedback.textContent=t('此类型已在另一处修改，请重新打开。','This type changed elsewhere. Reopen it to continue.');
        return;
      }
      const next=current?types.flatMap(type=>type!==current?[type]:remove?[]:[this.draft]):[...types,this.draft];
      const problem=model.validate({...graph,types:next})[0];
      if(problem) {
        const help={name:t('请使用有效的 C 标识符。','Use a valid C identifier.'),
          duplicate:t('名称或标识符重复。','A name or identifier is duplicated.'),
          range:t('成员值必须在 0 到 4294967295 之间，移位位数须小于 32。','Use 0 to 4294967295 for values and 0 to 31 for shift counts.'),
          reference:t('请先替换引用此成员的操作数。','Replace operands that use this member first.')};
        this.feedback.textContent=problem.field+' · '+(help[problem.code]||problem.code);
        return;
      }
      this.dialog.close();
      this.ctx.change(g=>{g.types=next;});
    }
  }

  function panel(ctx) {
    const {t}=ctx, types=types_of(ctx.graph);
    const add=button_for(t('添加类型','Add type'),'addType',()=>new type_form(ctx).open());
    add.disabled=types.length>=32;
    const root=el('section','vp-type-library',el('div','vp-tools-group vp-type-head',el('h3','',t('自定义类型','Custom types')),add));
    for(const type of types) {
      const pick=button_for(type.name+' · '+type.members.length,'editType',()=>new type_form(ctx,type).open());
      pick.className='vp-tree-node';pick.dataset.typeId=type.id;
      root.append(pick);
    }
    return root;
  }

  return {panel,operand};
})();
