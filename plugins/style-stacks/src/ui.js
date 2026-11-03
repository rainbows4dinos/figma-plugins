// Figma prepends PropsKit, whose classic script owns globals including `$`.
(()=>{
const LABELS={fills:'Fills',strokes:'Strokes',radii:'Corner radii',effects:'Effects',layout:'Auto Layout'};
const GROUPS=Object.keys(LABELS);
const LOGO="@@asset(assets/style-stacks-thumb.svg)";
// Injected from figma.pluginId before showUI, not the manifest UUID.
const pluginId="__STYLE_STACKS_RUNTIME_ID__";
const $=id=>document.getElementById(id);
const root=document.body;

// Per-viewer conveniences only; the panel works the same when storage is unavailable.
const store={get(k,d){try{const v=localStorage.getItem('style-stacks:'+k);return v==null?d:JSON.parse(v);}catch{return d;}},set(k,v){try{localStorage.setItem('style-stacks:'+k,JSON.stringify(v));}catch{}}};

let state={classes:[],libraryClasses:[],count:0,total:0,source:null,groups:[]};
let view={name:'list'};
let query='',picking=null,collapsed=new Set(store.get('collapsed',[]));
let busy=false,pending=null,sequence=0,watchdog=null,lastMessage=null,toastTimer=null,menuAnchor=null,lastView='list';

function post(message){parent.postMessage({pluginMessage:message,pluginId},'*');}

// Tiny element builder. Properties that must be set as properties (value, checked) are handled explicitly.
function h(tag,attrs,...kids){
  const el=document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){
    if(v==null||v===false)continue;
    if(k.startsWith('on'))el[k]=v;
    else if(k==='class')el.className=v;
    else if(k==='text')el.textContent=v;
    else if(k==='value'||k==='checked')el[k]=v;
    else if(k==='style'&&typeof v==='object')Object.assign(el.style,v);
    else el.setAttribute(k,v===true?'':String(v));
  }
  for(const kid of kids.flat(Infinity)){if(kid==null||kid===false)continue;el.append(kid.nodeType?kid:document.createTextNode(String(kid)));}
  return el;
}
const ICONS={
  plus:'M7 2v10M2 7h10',back:'M9 2.5 4.5 7 9 11.5',more:null,search:null,check:'M2.5 7.5 5.5 10.5 11.5 3.5',close:'M3 3l8 8M11 3l-8 8',caret:'M3.5 5.5 7 9l3.5-3.5',alert:null
};
function icon(name,size=14){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.setAttribute('width',size);svg.setAttribute('height',size);svg.setAttribute('viewBox','0 0 14 14');svg.setAttribute('aria-hidden','true');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.4');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
  const add=(t,a)=>{const e=document.createElementNS(ns,t);for(const[k,v]of Object.entries(a))e.setAttribute(k,v);svg.append(e);};
  if(name==='more'){for(const x of [3,7,11])add('circle',{cx:x,cy:7,r:1,fill:'currentColor',stroke:'none'});}
  else if(name==='search'){add('circle',{cx:6,cy:6,r:3.8});add('path',{d:'M9 9l3 3'});}
  else if(name==='alert'){add('circle',{cx:7,cy:7,r:5.5});add('path',{d:'M7 4.2v3.4'});add('circle',{cx:7,cy:9.9,r:.4,fill:'currentColor'});}
  else add('path',{d:ICONS[name]});
  return svg;
}

// ---------- Actions and messaging ----------
function send(message){
  if(busy){toast('Still working on the last action. Try again in a moment.',true);return false;}
  closeMenu();lastMessage=message;pending=Date.now()+'-'+(++sequence);busy=true;render();
  watchdog=setTimeout(()=>{finish();toast('No reply from Figma. Check your classes before retrying; the action may have finished.',true);post({type:'ready'});},15000);
  try{post({...message,requestId:pending});}catch(error){finish();toast('Could not send that action: '+error.message,true);}
  return true;
}
function finish(){clearTimeout(watchdog);pending=null;busy=false;render();}
function toast(text,error=false){
  const el=$('toast');clearTimeout(toastTimer);
  el.className='sc-toast'+(error?' sc-error':'');
  el.replaceChildren(h('span',{class:error?'sc-bad':'sc-ok'},icon(error?'alert':'check')),h('span',{class:'sc-toast-text',text}),h('button',{'aria-label':'Dismiss',onclick:hideToast},icon('close',12)));
  el.hidden=false;
  // Errors stay until dismissed or replaced; confirmations fade on their own.
  if(!error)toastTimer=setTimeout(hideToast,Math.min(9000,3500+text.length*30));
}
function hideToast(){clearTimeout(toastTimer);$('toast').hidden=true;}
function go(next){closeMenu();hideToast();view=next;$('main').scrollTop=0;render();}
function back(){picking=null;go({name:'list'});}

function apply(item){
  if(!state.count){toast(state.total?'None of the selected layers can take styles. Select a frame, shape or text layer.':'Select a layer first, then click a class to apply it.',true);return;}
  send(item.key?{type:'apply',key:item.key}:{type:'apply',id:item.id});
}
function download(data){
  const slug=(data.source||'classes').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'classes';
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=h('a',{href:url,download:'style-stacks-'+slug+'.json'});document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
$('file').onchange=()=>{
  const file=$('file').files&&$('file').files[0];$('file').value='';
  if(!file)return;
  if(file.size>2e6){toast('That file is too large to be a Style Stacks export.',true);return;}
  file.text().then(text=>{let data;try{data=JSON.parse(text);}catch{toast('That file isn’t valid JSON.',true);return;}
    view={name:'import-loading',fileName:file.name,data};send({type:'import-preview',data});})
  .catch(()=>toast('Could not read that file.',true));
};

// ---------- Menus ----------
function openMenu(anchor,items){
  const menu=$('menu');
  if(menuAnchor===anchor){closeMenu(true);return;}
  closeMenu();menuAnchor=anchor;anchor.setAttribute('aria-expanded','true');
  menu.replaceChildren(...items.map(item=>item==='sep'?h('hr',{role:'separator'}):h('button',{role:'menuitem',class:item.danger?'sc-danger':'',disabled:item.disabled,onclick:()=>{closeMenu();item.run();}},item.label)));
  menu.hidden=false;
  const r=anchor.getBoundingClientRect(),w=document.documentElement.clientWidth;
  menu.style.top=(r.bottom+4)+'px';menu.style.left=Math.max(6,Math.min(w-menu.offsetWidth-6,r.right-menu.offsetWidth))+'px';
  const first=menu.querySelector('button:not(:disabled)');if(first)first.focus();
}
function closeMenu(refocus=false){
  if(!menuAnchor)return;
  const anchor=menuAnchor;menuAnchor=null;$('menu').hidden=true;
  if(anchor.isConnected){anchor.setAttribute('aria-expanded','false');if(refocus)anchor.focus();}
}
document.addEventListener('click',e=>{if(menuAnchor&&!$('menu').contains(e.target)&&!menuAnchor.contains(e.target))closeMenu();});
document.addEventListener('keydown',e=>{
  if(menuAnchor&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
    e.preventDefault();const items=[...$('menu').querySelectorAll('button:not(:disabled)')],i=items.indexOf(document.activeElement);
    const next=e.key==='Home'?0:e.key==='End'?items.length-1:e.key==='ArrowDown'?(i+1)%items.length:(i-1+items.length)%items.length;items[next].focus();return;
  }
  if(e.key!=='Escape')return;
  if(menuAnchor){closeMenu(true);return;}
  if(!$('toast').hidden&&$('toast').contains(document.activeElement)){hideToast();return;}
  if(busy)return;
  if(view.name!=='list'||picking){back();return;}
  if(query){query='';render();}
});

// ---------- Data shaping ----------
const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
function split(name){const i=name.lastIndexOf('/');return i>0&&i<name.length-1?[name.slice(0,i),name.slice(i+1)]:['',name];}
function sources(){
  const result=[{id:'file',title:'This file',items:state.classes.map(c=>({...c,kind:'local'}))}];
  const libs=new Map();
  for(const c of state.libraryClasses){if(!libs.has(c.library))libs.set(c.library,[]);libs.get(c.library).push({...c,kind:'catalog',groups:[]});}
  for(const [name,items] of libs)result.push({id:'lib:'+name,title:name,library:true,items});
  for(const s of result)s.items.sort((a,b)=>collator.compare(a.name,b.name));
  return result;
}
function find(ref){
  if(!ref)return null;
  if(ref.key){const c=state.libraryClasses.find(x=>x.key===ref.key);return c?{...c,kind:'catalog',groups:[]}:null;}
  const c=state.classes.find(x=>x.id===ref.id);return c?{...c,kind:'local'}:null;
}
function nameTaken(name,exceptId){const n=name.trim().toLowerCase();return state.classes.some(c=>c.id!==exceptId&&c.name.toLowerCase()===n);}
function suggestedName(){
  const base=(state.source||'New class').trim().replace(/\s*\/\s*/g,'/').slice(0,80)||'New class';
  let result=base,i=2;while(nameTaken(result)){const s=' '+i++;result=base.slice(0,80-s.length)+s;}return result;
}
function toggle(id){collapsed.has(id)?collapsed.delete(id):collapsed.add(id);store.set('collapsed',[...collapsed]);render();}
function glyphs(item){
  return h('span',{class:'sc-glyphs','aria-hidden':'true'},item.groups.map(g=>{
    const el=h('span',{class:'sc-glyph sc-g-'+g,title:LABELS[g]});
    if(g==='fills'&&item.preview&&item.preview.fill)el.style.background=item.preview.fill;
    if(g==='strokes'&&item.preview&&item.preview.stroke)el.style.borderColor=item.preview.stroke;
    return el;
  }));
}

// ---------- Views ----------
function selectionLine(){
  const dot=h('span',{class:'sc-dot'+(state.count?' sc-on':'')});
  if(!state.total)return h('div',{class:'sc-status'},dot,'Select a layer to apply a class');
  if(!state.count)return h('div',{class:'sc-status'},dot,'Selected layers can’t take styles');
  if(state.source!==null)return h('div',{class:'sc-status'},dot,'Applies to',h('strong',{text:state.source||'Unnamed layer'}));
  return h('div',{class:'sc-status'},dot,'Applies to',h('strong',{text:state.count+' layers'}),state.count<state.total?' (some skipped)':'');
}

function listHeader(){
  if(picking){
    const all=state.classes.length&&picking.size===state.classes.length;
    return [h('div',{class:'sc-bar'},h('button',{class:'sc-icon','aria-label':'Cancel export',title:'Cancel',onclick:back},icon('back')),h('span',{class:'sc-title',text:'Choose classes to export'})),
      h('div',{class:'sc-status'},picking.size+' of '+state.classes.length+' selected',h('button',{class:'sc-link','data-fid':'pick-all',onclick:()=>{picking=all?new Set():new Set(state.classes.map(c=>c.id));render();}},all?'Select none':'Select all'))];
  }
  const total=state.classes.length+state.libraryClasses.length;
  const more=h('button',{class:'sc-icon','data-fid':'menu','aria-label':'More actions','aria-haspopup':'menu','aria-expanded':'false',title:'More actions',onclick:e=>openMenu(e.currentTarget,[
    {label:'Import classes…',run:()=>$('file').click()},
    {label:'Export all classes',disabled:!state.classes.length,run:()=>send({type:'export'})},
    {label:'Export selected…',disabled:!state.classes.length,run:()=>{picking=new Set();query='';render();}},
    'sep',
    {label:'Expand all groups',run:()=>{collapsed.clear();store.set('collapsed',[]);render();}},
    {label:'Collapse all groups',run:()=>{for(const s of sources()){collapsed.add(s.id);for(const it of s.items){const [f]=split(it.name);if(f)collapsed.add(s.id+'/'+f.toLowerCase());}}store.set('collapsed',[...collapsed]);render();}},
  ])},icon('more'));
  const add=h('button',{class:'sc-icon sc-primary','data-fid':'new','aria-label':'New class from selection',title:'New class from selection',onclick:openNew},icon('plus'));
  const search=h('label',{class:'sc-search'},icon('search',13),h('input',{type:'text',role:'searchbox','data-fid':'search','aria-label':'Search classes',placeholder:total?'Search '+total+(total===1?' class':' classes'):'Search classes',value:query,autocomplete:'off',spellcheck:'false',
    oninput:e=>{query=e.target.value;render();},
    onkeydown:e=>{if(e.key==='ArrowDown'){const first=$('main').querySelector('.sc-apply');if(first){e.preventDefault();first.focus();}}}}),
    query?h('button',{class:'sc-icon','aria-label':'Clear search',style:{width:'20px',height:'20px',flex:'0 0 20px'},onclick:()=>{query='';render();document.querySelector('[data-fid=search]').focus();}},icon('close',11)):null);
  return [h('div',{class:'sc-bar'},h('img',{class:'sc-logo',src:LOGO,alt:''}),h('span',{class:'sc-title',text:'Style Stacks'}),more,add),search,selectionLine()];
}

function listBody(){
  const list=h('div',{class:'sc-list',role:'list','aria-label':'Classes','aria-busy':busy?'true':'false'});
  const all=sources().filter(s=>!picking||s.id==='file');
  const q=query.trim().toLowerCase();
  if(!state.classes.length&&!state.libraryClasses.length){
    return h('div',{class:'sc-empty'},h('strong',{text:'No classes yet'}),
      h('p',{text:'A class saves the fills, strokes, corners, effects and Auto Layout of a layer so you can apply them to other layers.'}),
      h('button',{class:'sc-btn sc-primary','data-fid':'empty-new',onclick:openNew},icon('plus',12),'New class from selection'),
      h('button',{class:'sc-link','data-fid':'empty-import',onclick:()=>$('file').click()},'Import classes from a file'));
  }
  let shown=0;
  for(const s of all){
    const items=q?s.items.filter(c=>c.name.toLowerCase().includes(q)):s.items;
    if(q&&!items.length)continue;
    if(!s.items.length&&s.id==='file'&&!q){
      list.append(h('div',{class:'sc-section',role:'presentation'},'This file',h('span',{class:'sc-count',text:'0'})),
        h('p',{class:'sc-hint',style:{padding:'2px 24px 10px'}},'No classes saved in this file. Use + to save one from a layer.'));
      continue;
    }
    const open=q||picking||!collapsed.has(s.id);
    const label=[s.title,h('span',{class:'sc-count',text:String(items.length)}),s.library?h('span',{class:'sc-kind',text:'Library'}):null];
    list.append(q||picking?h('div',{class:'sc-section',role:'heading','aria-level':'2',style:{paddingLeft:'12px'}},...label)
      :h('button',{class:'sc-section','data-fid':'s:'+s.id,'aria-expanded':String(!!open),onclick:()=>toggle(s.id)},h('span',{class:'sc-caret'},icon('caret',10)),...label));
    if(!open)continue;
    // Searching shows full names in one flat list; otherwise loose classes first, then slash folders.
    const loose=[],folders=new Map();
    const labels=new Map();
    for(const c of items){const [f,leaf]=split(c.name);if(q||!f){loose.push([c,q?c.name:leaf]);continue;}const k=f.toLowerCase();if(!folders.has(k)){folders.set(k,[]);labels.set(k,f);}folders.get(k).push([c,leaf]);}
    for(const [c,label] of loose){list.append(row(c,label,true));shown++;}
    for(const f of [...folders.keys()].sort(collator.compare)){
      const fid=s.id+'/'+f,fopen=picking||!collapsed.has(fid),entries=folders.get(f);
      list.append(h('button',{class:'sc-folder','data-fid':'f:'+fid,'aria-expanded':String(!!fopen),onclick:()=>toggle(fid)},h('span',{class:'sc-caret'},icon('caret',10)),labels.get(f),h('span',{class:'sc-count',text:String(entries.length)})));
      if(fopen)for(const [c,leaf] of entries){list.append(row(c,leaf,false));shown++;}
    }
  }
  if(q&&!shown)list.append(h('div',{class:'sc-empty'},h('p',{text:'No classes match “'+query.trim()+'”.'}),h('button',{class:'sc-link',onclick:()=>{query='';render();}},'Clear search')));
  return list;
}

function row(item,label,loose){
  const key=item.key?'k:'+item.key:'c:'+item.id;
  if(picking){
    const checked=picking.has(item.id);
    return h('div',{role:'listitem'},h('label',{class:'sc-pick'},h('input',{type:'checkbox','data-fid':'p:'+key,checked,onchange:e=>{e.target.checked?picking.add(item.id):picking.delete(item.id);render();}}),h('span',{class:'sc-leaf',text:item.name})));
  }
  const groups=item.groups.map(g=>LABELS[g]).join(', ');
  const applyLabel='Apply '+item.name+(item.kind==='catalog'?' from '+item.library:'')+(groups?'. Contains '+groups:'');
  return h('div',{class:'sc-row'+(loose?' sc-loose':''),role:'listitem'},
    h('button',{class:'sc-apply','data-fid':'a:'+key,title:'Apply '+item.name,'aria-label':applyLabel,onclick:()=>apply(item),
      onkeydown:e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const all=[...$('main').querySelectorAll('.sc-apply')],i=all.indexOf(e.currentTarget),n=all[i+(e.key==='ArrowDown'?1:-1)];if(n)n.focus();else if(e.key==='ArrowUp')document.querySelector('[data-fid=search]').focus();}}},
      h('span',{class:'sc-leaf',text:label}),item.library&&item.kind==='local'?h('span',{class:'sc-tag',text:'Published'}):null,glyphs(item)),
    h('button',{class:'sc-more','data-fid':'m:'+key,'aria-label':'Details for '+item.name,title:'Details',onclick:()=>go({name:'details',ref:item.key?{key:item.key}:{id:item.id}})},icon('more')));
}
function listFoot(){
  if(!picking)return null;
  return [h('button',{class:'sc-btn',onclick:back},'Cancel'),h('button',{class:'sc-btn sc-primary','data-fid':'export-picked',disabled:busy||!picking.size,onclick:()=>send({type:'export',ids:[...picking]})},picking.size?'Export '+picking.size+(picking.size===1?' class':' classes'):'Export')];
}

// New class
function openNew(){go({name:'new',className:'',nameEdited:false,choice:{fills:true,strokes:true,radii:true,effects:true,layout:true},dest:store.get('dest','file'),issues:null});}
function newHeader(){return [h('div',{class:'sc-bar'},h('button',{class:'sc-icon','data-fid':'back','aria-label':'Back to classes',title:'Back',onclick:back},icon('back')),h('span',{class:'sc-title',text:'New class'}))];}
function chosenGroups(){return GROUPS.filter(g=>view.choice[g]&&state.groups.includes(g));}
function newProblem(){
  if(state.source===null)return state.total>1?'Select just one layer to save its styles.':'Select a layer to save its styles.';
  const name=view.className.trim();
  if(!name)return 'Enter a name.';
  if(nameTaken(name))return 'A class named “'+name+'” already exists.';
  if(!chosenGroups().length)return 'Choose at least one kind of style to include.';
  return '';
}
function newBody(){
  if(!view.nameEdited)view.className=state.source!==null?suggestedName():'';
  const body=h('div',{class:'sc-body'});
  if(state.source===null){
    body.append(h('div',{class:'sc-callout'},h('strong',{text:state.total>1?'Select one layer':'Select a layer'}),
      h('span',{text:state.total>1?'Classes are saved from one layer at a time. Select just the layer whose styles you want to save.':'Select the layer whose styles you want to save. It can be a frame, component, shape or text layer.'})));
    return body;
  }
  const problem=newProblem(),name=view.className.trim();
  body.append(
    h('div',{class:'sc-field'},h('span',{class:'sc-label',text:'Saving from'}),h('strong',{text:state.source||'Unnamed layer',style:{fontWeight:'500'}})),
    h('div',{class:'sc-field'},h('label',{class:'sc-label',for:'class-name',text:'Name'}),
      h('input',{type:'text',id:'class-name','data-fid':'class-name',maxlength:80,value:view.className,autocomplete:'off',spellcheck:'false','aria-describedby':'name-hint',
        oninput:e=>{view.className=e.target.value;view.nameEdited=true;view.issues=null;render();},onkeydown:e=>{if(e.key==='Enter')save();}}),
      h('p',{id:'name-hint',class:'sc-hint'+(name&&nameTaken(name)?' sc-error':''),text:name&&nameTaken(name)?'A class with this name already exists.':'Use slashes to group classes, like card/elevated.'})),
    h('fieldset',{class:'sc-field'},h('legend',{class:'sc-label',text:'Include',style:{marginBottom:'6px'}}),
      h('div',{class:'sc-chips'},GROUPS.map(g=>{
        const supported=state.groups.includes(g),checked=view.choice[g]&&supported;
        return h('label',{class:'sc-chip'+(checked?' sc-checked':'')+(supported?'':' sc-off'),title:supported?'':'Not available for this layer type'},
          h('input',{type:'checkbox','data-fid':'g:'+g,checked,disabled:!supported,onchange:e=>{view.choice[g]=e.target.checked;view.issues=null;render();}}),LABELS[g]);
      }))),
    h('div',{class:'sc-field'},h('span',{class:'sc-label',id:'dest-label',text:'Save to'}),
      h('div',{class:'sc-seg',role:'radiogroup','aria-labelledby':'dest-label'},[['file','This file'],['library','Library']].map(([value,label])=>
        h('button',{role:'radio','data-fid':'dest:'+value,'aria-checked':String(view.dest===value),tabindex:view.dest===value?'0':'-1',
          onclick:()=>{view.dest=value;view.issues=null;store.set('dest',value);render();},
          onkeydown:e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();view.dest=view.dest==='file'?'library':'file';store.set('dest',view.dest);render();}}},label))),
      h('p',{class:'sc-hint',text:view.dest==='library'?'Other files can use it after you publish the library, like components.':'Only this file can use it. You can add it to the library later.'})),
  );
  if(view.issues)body.append(warning(view.issues));
  else if(problem&&name&&!nameTaken(name))body.append(h('p',{class:'sc-hint sc-error',text:problem}));
  return body;
}
function warning(issues){
  return h('div',{class:'sc-warning',role:'alert'},h('strong',{text:'This class may look different in other files'}),h('ul',{},issues.map(t=>h('li',{text:t}))),h('p',{class:'sc-hint',style:{marginTop:'6px'},text:'Fix these and try again, or continue anyway.'}));
}
function save(){
  if(newProblem()||busy)return;
  send({type:'save',library:view.dest==='library',name:view.className.trim(),groups:chosenGroups(),confirmed:!!view.issues});
}
function newFoot(){
  if(state.source===null)return [h('button',{class:'sc-btn sc-primary',onclick:back},'Back to classes')];
  const label=view.issues?(view.dest==='library'?'Save to library anyway':'Save anyway'):view.dest==='library'?'Save to library':'Save class';
  return [h('button',{class:'sc-btn',onclick:back},'Cancel'),h('button',{class:'sc-btn sc-primary','data-fid':'save',disabled:busy||!!newProblem(),onclick:save},busy?'Saving…':label)];
}

// Class details
function detailsHeader(item){
  const bar=h('div',{class:'sc-bar'},h('button',{class:'sc-icon','data-fid':'back','aria-label':'Back to classes',title:'Back',onclick:back},icon('back')),h('span',{class:'sc-title',text:item?item.name:'Class'}));
  if(item&&item.kind==='local')bar.append(h('button',{class:'sc-icon','data-fid':'details-menu','aria-label':'More actions for '+item.name,'aria-haspopup':'menu','aria-expanded':'false',title:'More actions',onclick:e=>openMenu(e.currentTarget,[
    item.library?null:{label:'Add to library',run:()=>{view.issues=null;send({type:'move',id:item.id});}},
    {label:'Export class',run:()=>send({type:'export',ids:[item.id]})},
    'sep',
    {label:'Delete class…',danger:true,run:()=>{view.confirmDelete=true;render();const b=document.querySelector('[data-fid=cancel-delete]');if(b)b.focus();}},
  ].filter(Boolean))},icon('more')));
  return [bar];
}
function canUpdate(item){return state.source!==null&&item.groups.every(g=>state.groups.includes(g));}
function detailsBody(item){
  const body=h('div',{class:'sc-body'});
  if(item.kind==='catalog'){
    body.append(h('div',{class:'sc-callout'},h('span',{},'From ',h('strong',{text:item.library}),'.'),h('span',{text:'Library classes are edited in their library file. Apply always uses the latest published version.'})));
    return body;
  }
  const p=item.preview||{},swatch=h('div',{class:'sc-swatch'});
  if(p.fill)swatch.style.background=p.fill;
  if(p.stroke)swatch.style.border=Math.max(1,Math.min(4,p.strokeWidth||1))+'px solid '+p.stroke;
  if(p.radius)swatch.style.borderRadius=p.radius;
  if(p.shadow)swatch.style.boxShadow=p.shadow;
  if(!p.fill&&!p.stroke)swatch.style.border='1px dashed var(--sc-border)';
  const nameValue=view.rename!=null?view.rename:item.name,renaming=view.rename!=null&&view.rename.trim()!==item.name;
  const clash=renaming&&nameTaken(view.rename,item.id),update=canUpdate(item);
  body.append(
    h('div',{class:'sc-preview','aria-hidden':'true'},swatch),
    h('dl',{class:'sc-contents','aria-label':'What this class contains'},item.groups.flatMap(g=>[h('dt',{text:LABELS[g]}),h('dd',{text:item.contents&&item.contents[g]||'Saved'})])),
    h('div',{class:'sc-field'},h('label',{class:'sc-label',for:'rename',text:'Name'}),
      h('div',{class:'sc-inline'},h('input',{type:'text',id:'rename','data-fid':'rename',maxlength:80,value:nameValue,autocomplete:'off',spellcheck:'false',
        oninput:e=>{view.rename=e.target.value;render();},onkeydown:e=>{if(e.key==='Enter')rename(item);if(e.key==='Escape'&&view.rename!=null){e.stopPropagation();view.rename=null;render();}}}),
        renaming?h('button',{class:'sc-btn','data-fid':'save-name',disabled:busy||clash||!view.rename.trim(),onclick:()=>rename(item)},'Save'):null),
      clash?h('p',{class:'sc-hint sc-error',text:'A class with this name already exists.'}):null),
    h('p',{class:'sc-hint',text:item.library?'Published from this file. Publish the library after changes to share them with other files.':'Saved in this file only.'}),
    h('div',{class:'sc-field'},
      h('button',{class:'sc-btn sc-wide','data-fid':'update',disabled:busy||!update,'aria-describedby':'update-hint',onclick:()=>{view.issues=null;send({type:'update',id:item.id});}},'Update from selection'),
      h('p',{id:'update-hint',class:'sc-hint',text:update?'Replaces this class’s styles with the selected layer’s. Layers already styled with it don’t change.':'To update, select one layer that has the same kinds of styles ('+item.groups.map(g=>LABELS[g].toLowerCase()).join(', ')+').'})),
  );
  if(view.issues)body.append(warning(view.issues),h('div',{class:'sc-actions'},h('button',{class:'sc-btn',onclick:()=>{view.issues=null;render();}},'Cancel'),h('button',{class:'sc-btn sc-primary',onclick:()=>send({...lastMessage,confirmed:true})},'Continue anyway')));
  if(view.confirmDelete)body.append(h('div',{class:'sc-warning',role:'alertdialog','aria-label':'Delete class'},
    h('strong',{text:'Delete “'+item.name+'”?'}),
    h('p',{class:'sc-hint',text:item.library?'Other files keep it until you publish the library. Layers already styled with it don’t change.':'Layers already styled with it don’t change.'}),
    h('div',{class:'sc-actions',style:{marginTop:'8px'}},h('button',{class:'sc-btn','data-fid':'cancel-delete',onclick:()=>{view.confirmDelete=false;render();}},'Cancel'),h('button',{class:'sc-btn sc-danger','data-fid':'confirm-delete',disabled:busy,onclick:()=>send({type:'delete',id:item.id})},'Delete'))));
  return body;
}
function rename(item){
  if(view.rename==null||busy)return;
  const name=view.rename.trim();
  if(!name||name===item.name||nameTaken(name,item.id))return;
  send({type:'rename',id:item.id,name});
}
function detailsFoot(item){return [h('button',{class:'sc-btn sc-primary','data-fid':'apply-details',disabled:busy,onclick:()=>apply(item)},state.count>1?'Apply to '+state.count+' layers':'Apply to selection')];}

// Import review
function importHeader(){return [h('div',{class:'sc-bar'},h('button',{class:'sc-icon','data-fid':'back','aria-label':'Cancel import',title:'Cancel',onclick:back},icon('back')),h('span',{class:'sc-title',text:'Import classes'}))];}
function importCount(){return view.mode==='skip'?view.classes.filter(c=>!c.clash).length:view.classes.length;}
function importBody(){
  const clashes=view.classes.filter(c=>c.clash).length,unlinked=view.classes.filter(c=>c.unlinked).length;
  const body=h('div',{class:'sc-body'},
    h('p',{},h('strong',{text:view.classes.length+(view.classes.length===1?' class':' classes')}),' in ',view.fileName,'. They’ll be saved in this file.'));
  if(clashes)body.append(h('div',{class:'sc-field'},h('span',{class:'sc-label',id:'mode-label',text:clashes+(clashes===1?' name already exists here':' names already exist here')}),
    h('div',{class:'sc-seg',role:'radiogroup','aria-labelledby':'mode-label'},[['keep','Keep both'],['replace','Replace'],['skip','Skip']].map(([value,label])=>
      h('button',{role:'radio','data-fid':'mode:'+value,'aria-checked':String(view.mode===value),tabindex:view.mode===value?'0':'-1',onclick:()=>{view.mode=value;render();}},label))),
    h('p',{class:'sc-hint',text:view.mode==='keep'?'Imported copies get a number, like “card 2”.':view.mode==='replace'?'Existing classes take the imported styles. Layers already styled don’t change.':'Classes with existing names aren’t imported.'})));
  if(unlinked)body.append(h('p',{class:'sc-hint',text:unlinked+(unlinked===1?' class uses':' classes use')+' variables or styles that aren’t in this file. Those parts will use plain values.'}));
  body.append(h('div',{class:'sc-import-list',role:'list'},view.classes.map(c=>h('div',{class:'sc-import-row',role:'listitem'},
    h('span',{class:'sc-leaf',text:c.name}),c.clash?h('span',{class:'sc-badge sc-clash',text:view.mode==='skip'?'Skipped':view.mode==='replace'?'Replaces':'Exists'}):null,glyphs({groups:c.groups,preview:{}})))));
  return body;
}
function importFoot(){const n=importCount();return [h('button',{class:'sc-btn',onclick:back},'Cancel'),h('button',{class:'sc-btn sc-primary','data-fid':'import',disabled:busy||!n,onclick:()=>send({type:'import',data:view.data,mode:view.mode})},busy?'Importing…':'Import '+n+(n===1?' class':' classes'))];}

// ---------- Render ----------
function render(){
  const active=document.activeElement,fid=active&&active.dataset?active.dataset.fid:null;
  const range=active&&typeof active.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null;
  const main=$('main'),scroll=main.scrollTop;
  let top,body,foot=null;
  let item=null;
  if(view.name==='details'){item=find(view.ref);if(!item){view={name:'list'};}}
  if(view.name==='new'){top=newHeader();body=newBody();foot=newFoot();}
  else if(view.name==='details'){top=detailsHeader(item);body=detailsBody(item);foot=detailsFoot(item);}
  else if(view.name==='import'){top=importHeader();body=importBody();foot=importFoot();}
  else{top=listHeader();body=listBody();foot=listFoot();}
  $('top').replaceChildren(...top);
  main.replaceChildren(body);
  $('foot').hidden=!foot;$('foot').replaceChildren(...(foot||[]));
  root.classList.toggle('sc-has-foot',!!foot);
  const viewKey=view.name+(view.ref?JSON.stringify(view.ref):'')+(picking?'pick':'');
  if(viewKey===lastView)main.scrollTop=scroll;
  lastView=viewKey;
  if(fid){const el=document.querySelector('[data-fid="'+CSS.escape(fid)+'"]');if(el&&!el.disabled){el.focus({preventScroll:true});if(range&&el.setSelectionRange)try{el.setSelectionRange(range[0],range[1]);}catch{}}}
}

window.addEventListener('message',event=>{
  const msg=event.data&&event.data.pluginMessage;if(!msg)return;
  if(msg.type==='state'){state=msg;render();return;}
  if(msg.type!=='feedback')return;
  if(msg.requestId!==undefined){if(msg.requestId!==pending)return;clearTimeout(watchdog);pending=null;busy=false;}
  else if(busy)return;
  const sent=lastMessage&&lastMessage.type;
  if(msg.portability){hideToast();view.issues=msg.portability;render();const w=document.querySelector('.sc-warning');if(w)w.scrollIntoView({block:'nearest'});return;}
  if(msg.importPreview){view={name:'import',fileName:view.fileName,data:view.data,classes:msg.importPreview.classes,mode:'keep'};render();return;}
  if(msg.error){if(view.name==='import-loading')view={name:'list'};render();toast(msg.text,true);return;}
  if(msg.export)download(msg.export);
  if(sent==='save'||sent==='import'||sent==='delete'||(sent==='export'&&picking))back();
  else if(view.name==='details'){view.rename=null;view.issues=null;view.confirmDelete=false;render();}
  else render();
  if(msg.text)toast(msg.text);
});
render();post({type:'ready'});
})();
