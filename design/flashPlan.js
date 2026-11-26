'use strict';

/** Resolve only board-declared runners. Both the command preview and extension host use this plan. */
const ZephyrFlashPlan = (() => {
  function domainImages(model, domain) {
    if (!domain) return model.order.map(name => model.images.find(image => image.name === name)).filter(Boolean);
    return model.images.filter(image => image.name === domain);
  }

  function runnerChoices(images) {
    const first = images[0]?.runners || [];
    return first.filter(name => images.every(image => image.runners.includes(name)));
  }

  function plan(model, selection) {
    const {domain = '', runner = '', device = ''} = selection;
    const images = domainImages(model, domain);
    const names = images.map(image => runner || image.defaultRunner);
    const result = {images, names, runners:runnerChoices(images)};
    if (!images.length || (runner && !result.runners.includes(runner))) return {...result,issue:'runner'};
    if (images.some((image,i) => !image.runners.includes(names[i]))) return {...result,issue:'runner'};
    if (!model.west) return {...result,issue:'west'};
    if (model.system && model.domainFlag===false && !domain) return {...result,issue:'domain'};
    const capabilities = names.map(name => model.caps[name]);
    result.device = capabilities.every(caps => caps?.device);
    if (device && !result.device) return {...result,issue:'mixed'};
    if (typeof device !== 'string' || device.length>512 || /^-|[\x00-\x1f\x7f*?]/u.test(device)) return {...result,issue:'device'};
    if (device && images.some((img,i) => (img.deviceIds[names[i]] || []).some(id => id !== device)))
      return {...result,issue:'pinned'};
    if (images.some(image => !image.files.length)) return {...result,issue:'image'};
    const args = ['flash','-d',model.system && model.domainFlag===false ? images[0].dir : model.root];
    if (model.noRebuild) args.push(model.noRebuild);
    if (domain && model.system && model.domainFlag!==false) args.push('--domain',domain);
    if (runner) args.push('-r',runner);
    const oneRunner=names.every(name=>name===names[0]) && names[0];
    if (oneRunner && model.tools?.[oneRunner] && model.caps[oneRunner]?.toolOption)
      args.push(model.caps[oneRunner].toolOption,model.tools[oneRunner]);
    if (device && !images.every((img,i) => img.deviceIds[names[i]]?.includes(device))) {
      if (images.some((img,i) => img.deviceIds[names[i]]?.includes(device))) return {...result,issue:'mixed'};
      args.push('--dev-id',device);
    }
    return {...result,args};
  }

  function command(executable, args) {
    return [executable,...args].map(arg => /[\s"]/u.test(arg) ? '"'+arg.replace(/"/g,'\\"')+'"' : arg).join(' ');
  }
  return {plan, command};
})();
if (typeof module !== 'undefined') module.exports = ZephyrFlashPlan;
