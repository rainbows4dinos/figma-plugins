// Figma prepends PropsKit, whose classic script owns globals including `$`.
(()=>{
const labels={fills:'Fills',strokes:'Strokes',radii:'Corner radii',effects:'Effects',layout:'Auto Layout'};
let state={classes:[],count:0,total:0,source:null,groups:[]},busy=false,renaming=null,nameEdited=false;
let pending=null,sequence=0,watchdog;
const choice={};
let menuId=null,deleting=null,listKey='';
const $=id=>document.getElementById(id);
// Injected from figma.pluginId before showUI, not the manifest UUID.
const pluginId="__STYLE_STACKS_RUNTIME_ID__";
function post(message){parent.postMessage({pluginMessage:message,pluginId},'*');}
function recover(text){clearTimeout(watchdog);pending=null;busy=false;$('feedback').textContent=text;$('feedback').className='sc-error';render();}
function send(message){if(busy)return;closeMenu();pending=Date.now()+'-'+(++sequence);busy=true;render();watchdog=setTimeout(()=>{recover('No completion received. Check Saved classes before retrying; the action may have completed.');post({type:'ready'});},10000);try{post({...message,requestId:pending});}catch(error){recover('Could not send action: '+error.message);}}
for(const [key,label] of Object.entries(labels)){const l=document.createElement('label'),c=document.createElement('input');c.type='checkbox';c.value=key;choice[key]=true;c.checked=true;c.id='group-'+key;c.onchange=()=>{choice[key]=c.checked;controls();};l.append(c,document.createTextNode(label));$('checks').append(l);}
function suggestedName(){const base=(state.source||'New class').trim().slice(0,80)||'New class';let result=base,index=2;while(state.classes.some(c=>c.name.toLowerCase()===result.toLowerCase())){const suffix=' '+index++;result=base.slice(0,80-suffix.length)+suffix;}return result;}
function controls(){for(const key of Object.keys(labels)){const box=$('group-'+key),unsupported=state.source!==null&&!state.groups.includes(key);box.disabled=busy||state.source===null||unsupported;box.checked=choice[key]&&!unsupported;box.parentElement.classList.toggle('sc-unavailable',unsupported);box.parentElement.title=unsupported?'Not available for this layer type':'';}$('name').disabled=busy||state.source===null;const name=$('name').value.trim(),hasGroups=Object.keys(labels).some(k=>$('group-'+k).checked&&!$('group-'+k).disabled),duplicate=state.classes.some(c=>c.name.toLowerCase()===name.toLowerCase());const reason=busy?'Working…':state.source===null?(state.total>1?'Select just one compatible layer to save a class.':'Select one unlocked, compatible layer to save a class.'):!name?'Enter a class name to enable Save.':duplicate?'A class with this name already exists. Choose another name.':!hasGroups?'Choose at least one supported property group.':'';$('save').disabled=!!reason;$('save-hint').textContent=reason||'Ready to save. You can edit the suggested class name.';}
function action(label,handler,disabled=false){const b=document.createElement('button');b.textContent=label;b.disabled=disabled;b.onclick=handler;return b;}
function menuTrigger(){return [...$('list').children].find(row=>row.dataset.classId===menuId)?.children[1];}
function closeMenu(focus=false){const trigger=menuTrigger();if(trigger)trigger.setAttribute('aria-expanded','false');menuId=null;$('class-menu').hidden=true;if(focus&&trigger)trigger.focus();}
function positionMenu(){
 if(!menuId)return;
 const trigger=menuTrigger();if(!trigger){closeMenu();return;}
 const rect=trigger.getBoundingClientRect(),list=$('list').getBoundingClientRect(),menu=$('class-menu');
 if(rect.bottom<=list.top||rect.top>=list.bottom){closeMenu();return;}
 const width=document.documentElement.clientWidth,height=document.documentElement.clientHeight;
 menu.style.left=Math.max(4,Math.min(width-menu.offsetWidth-4,rect.right-menu.offsetWidth))+'px';
 menu.style.top=Math.max(4,rect.bottom+4+menu.offsetHeight<=height?rect.bottom+4:rect.top-menu.offsetHeight-4)+'px';
}
function render(){
 if(!nameEdited&&state.source!==null)$('name').value=suggestedName();
 $('selection').textContent=state.total===0?'No layer selected. Select a layer to apply a class.':state.count===0?'No editable compatible layers selected.':state.source!==null?'Selected: '+(state.source||'Unnamed layer'):state.count+' compatible layers selected'+(state.count<state.total?' · unsupported layers will be skipped':'');
 // Preserve focused rows and title scrollers when content/availability is unchanged.
 const key=JSON.stringify([state.classes,busy,!!state.count]);
 if(key!==listKey){listKey=key;const scroll=$('list').scrollTop;$('list').replaceChildren();
 if(!state.classes.length){const p=document.createElement('p');p.textContent='No classes yet. Save a visual treatment below.';$('list').append(p);}
 for(const c of state.classes){const row=document.createElement('div');row.className='sc-row';row.dataset.classId=c.id;const apply=action('',()=>send({type:'apply',id:c.id}),busy||!state.count);apply.className='sc-apply';apply.title='Apply '+c.name;apply.setAttribute('aria-label','Apply '+c.name);const name=document.createElement('span');name.className='sc-name';name.textContent=c.name;name.tabIndex=0;name.setAttribute('aria-label',c.name);name.onclick=e=>{if(name.scrollWidth>name.clientWidth)e.stopPropagation();};apply.append(name);const overflow=action('⋯',()=>{const opening=menuId!==c.id;closeMenu();if(opening){menuId=c.id;$('class-menu').hidden=false;overflow.setAttribute('aria-expanded','true');positionMenu();$('edit-class').focus();}},busy);overflow.className='sc-menu-button';overflow.setAttribute('aria-label','Manage '+c.name);overflow.setAttribute('aria-haspopup','menu');overflow.setAttribute('aria-controls','class-menu');overflow.setAttribute('aria-expanded',String(menuId===c.id));row.append(apply,overflow);$('list').append(row);}
 $('list').scrollTop=scroll;}
 if(renaming&&!state.classes.some(c=>c.id===renaming)){renaming=null;$('editor').hidden=true;}
 if(deleting&&!state.classes.some(c=>c.id===deleting)){deleting=null;$('delete-confirm').hidden=true;}
 const editing=state.classes.find(c=>c.id===renaming),canUpdate=editing&&state.source!==null&&editing.groups.every(g=>state.groups.includes(g));
 controls();$('rename').disabled=busy;$('confirm-rename').disabled=busy;$('cancel-rename').disabled=busy;$('update-class').disabled=busy||!canUpdate;
 $('update-hint').textContent=canUpdate?'Replace this class styling with the current selection (same property groups). Renaming is separate.':'Select one compatible layer supporting all saved property groups to update styling.';
 $('confirm-delete').disabled=busy;$('cancel-delete').disabled=busy;positionMenu();
}
$('name').oninput=()=>{nameEdited=true;controls();};
$('save').onclick=()=>send({type:'save',name:$('name').value,groups:Object.keys(labels).filter(k=>$('group-'+k).checked&&!$('group-'+k).disabled)});
$('cancel-rename').onclick=()=>{$('editor').hidden=true;renaming=null;};
$('confirm-rename').onclick=()=>{if(renaming)send({type:'rename',id:renaming,name:$('rename').value});};
$('update-class').onclick=()=>{if(renaming)send({type:'update',id:renaming});};
$('edit-class').onclick=()=>{const c=state.classes.find(c=>c.id===menuId);if(!c)return;renaming=c.id;deleting=null;$('delete-confirm').hidden=true;$('editor').hidden=false;$('rename').value=c.name;closeMenu();render();$('rename').focus();};
$('delete-class').onclick=()=>{const c=state.classes.find(c=>c.id===menuId);if(!c)return;deleting=c.id;renaming=null;$('editor').hidden=true;$('delete-question').textContent='Delete “'+c.name+'”?';$('delete-confirm').hidden=false;closeMenu();$('cancel-delete').focus();};
$('cancel-delete').onclick=()=>{deleting=null;$('delete-confirm').hidden=true;};
$('confirm-delete').onclick=()=>{if(deleting)send({type:'delete',id:deleting});};
$('list').addEventListener('scroll',positionMenu);
window.addEventListener('resize',positionMenu);
document.addEventListener('scroll',positionMenu,true);
document.addEventListener('click',e=>{if(menuId&&!$('class-menu').contains(e.target)&&!menuTrigger()?.contains(e.target))closeMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeMenu(true);if(!busy){$('editor').hidden=true;renaming=null;$('delete-confirm').hidden=true;deleting=null;}}else if(menuId&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=[$('edit-class'),$('delete-class')];const index=items.indexOf(document.activeElement);items[e.key==='Home'?0:e.key==='End'?1:(index+1)%2].focus();}});
window.addEventListener('message',event=>{const msg=event.data&&event.data.pluginMessage;if(!msg)return;if(msg.type==='state'){state=msg;render();}if(msg.type==='feedback'){if(msg.requestId!==undefined){if(msg.requestId!==pending)return;clearTimeout(watchdog);pending=null;busy=false;}else if(busy)return;$('feedback').textContent=msg.text;$('feedback').className=msg.error?'sc-error':'';if(!msg.error){$('editor').hidden=true;renaming=null;$('delete-confirm').hidden=true;deleting=null;if(msg.saved){nameEdited=false;$('name').value='';}}render();}});
render();post({type:'ready'});
})();
