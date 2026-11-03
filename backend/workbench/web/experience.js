import {projects as initialProjects,stages,versions,issues,files,changes,discoveries} from './catalog.js';
import {createProjectScreens} from './projects.js';
import {createStageBoard} from './stages.js';

export function createExperience(ctx){
  const {el,button,icon,tag,state,toast,copyButton,openDetail,openConnection,navigate,openDialog,closeDialog}=ctx;
  const $=id=>document.getElementById(id);
  let projects=initialProjects.map(p=>({...p})),current='paper',tab='概览',filter='全部',fileFilter='全部文件',query='',version='v3';
  let favorite=new Set(['paper','software']),attention=new Map(),issueFilter='全部',zoom=1,layer='explore',savedCanvas=null,panelBack=null;
  const project=()=>projects.find(p=>p.id===current)||projects[0];
  const block=(title,sub='')=>{const n=el('div','section-heading');n.append(el('h2','',title));if(sub)n.append(el('p','',sub));return n;};
  const badge=(symbol,tone='blue')=>{const n=el('span',`object-icon ${tone}`);n.append(icon(symbol));return n;};
  const card=(className='')=>el('section',`surface ${className}`);
  function heading(title,subtitle,kicker='WORKBENCH'){ $('page-title').textContent=title;$('page-subtitle').textContent=subtitle;$('page-kicker').textContent=kicker; }
  function rowAction(label,run,tone='secondary'){return button(label,run,`button ${tone}`);}
  // 面板是一叠可以往下走、也可以退回的纸：每进一级记住当前滚动位置，
  // 退回时等内容渲染完再还原，不再用固定延时猜布局时机。
  const panelStack=[];
  // restore：这一屏是「退回上一级」，传回当初离开时的 scrollTop；新建一屏则不传。
  function panel(title,body,eyebrow='工作详情',restore=null){
    panelBack=null;
    const dialog=$('panel-dialog');
    // 往下走一级之前，记住当前这一级停在哪；退回时不重复压栈。
    if(restore===null&&dialog.open)panelStack.push(dialog.scrollTop);
    $('panel-title')?.remove();const h=el('h2','',title);h.id='panel-title';
    $('panel-content').replaceChildren(h,...(Array.isArray(body)?body:[body]));$('panel-eyebrow').textContent=eyebrow;
    // openDialog 会作废进行中的退场：关闭中的面板同样由新内容就地接管。
    openDialog(dialog);
    const top=restore===null?0:restore;
    dialog.scrollTop=top;
    // 内容刚换完还没测出高度，此刻写 scrollTop 会被夹回 0；等这一轮布局落地再写。
    if(top>0)afterLayout(()=>{if(dialog.open)dialog.scrollTop=top;});
  }
  function afterLayout(run){
    if(typeof requestAnimationFrame!=='function'){run();return;}
    requestAnimationFrame(()=>requestAnimationFrame(run));
  }
  // 退回上一级：由这里统一取出保存的位置，交给上一级的渲染函数还原。
  function backTo(render){
    const top=panelStack.length?panelStack.pop():0;
    render(top);
  }

  // 面板真正关闭时丢掉滚动栈，下次打开从顶部开始。
  $('panel-dialog').addEventListener('close',()=>{panelStack.length=0;});
  function note(text){return el('p','muted-note',text);}
  function empty(title,description,action){const n=el('section','surface roomy-empty');n.append(badge('folder'),el('h2','',title),el('p','',description));if(action)n.append(action);return n;}
  function tabs(labels,selected,run){const n=el('div','project-tabs');n.setAttribute('role','tablist');labels.forEach(label=>{const b=button(label,()=>run(label),`tab-button${selected===label?' selected':''}`);b.setAttribute('role','tab');b.setAttribute('aria-selected',String(selected===label));n.append(b);});return n;}
  function field(label,value){const n=el('div','metadata-field');n.append(el('span','',label),el('strong','',value));return n;}
  const live=createProjectScreens({...ctx,heading,panel,card,field,note,block,empty});
  function projectCard(p){
    // 页头承诺"知道下一步在哪里"，所以"下一步"必须是这一行第二强的信息：
    // 名字之后直接读它，状态与日期退为辅助。
    const n=button('',()=>openProject(p.id),'project-row');
    const info=el('div','project-info');
    info.append(el('h3','',p.name));
    const next=el('p','project-next');next.append(el('span','next-label','下一步'),el('span','',p.next));
    info.append(next,el('p','project-subtitle',p.subtitle));
    // 状态不靠彩色胶囊区分——那会让每个项目都在喊。只有真正需要注意的才用琥珀，
    // 其余用中性描边，把注意力留给"下一步"。
    // 与侧栏圆点同一来源：返修中，或还有未处理的重要变化。
    const needsAttention = p.status === '返修中' || changes.some(c => c.project === p.id && !attention.has(c.id));
    const statusTag = tag(p.status);
    statusTag.classList.add('project-status');
    if (needsAttention) statusTag.classList.add('needs-attention');
    const status=el('div','project-state');status.append(statusTag,el('span','project-date',p.date));
    n.append(badge(p.symbol,p.tone),info,status,el('span','project-enter','进入 →'));
    return n;
  }
  function openProject(id,selected='概览'){current=id;tab=selected;fileFilter='全部文件';navigate('project');}
  function renderShortcuts(){
    const container=$('project-shortcuts');container.replaceChildren();
    if(!state.preview){container.append(el('p','sidebar-empty','关联的工作空间会出现在这里'));if(!state.token)live.reset();else live.shortcuts();return;}
    projects.slice(0,6).forEach(p=>{const b=button('',()=>openProject(p.id),`shortcut${state.view==='project'&&current===p.id?' selected':''}`);b.dataset.proj=p.id;const dot=el('span','pending');dot.dataset.pending=p.id;dot.dataset.n='0';dot.setAttribute('aria-hidden','true');b.append(badge(p.symbol,p.tone),el('span','shortcut-name',p.name),dot);container.append(b);});ctx.home.syncPending();
  }
  // 首页卡片叠的预览数据源：知道了 / 稍后只记在本页内存里，不写真实工作台。
  function previewItems(){
    return changes.filter(c=>!attention.has(c.id)).map(c=>{const p=projects.find(x=>x.id===c.project);
      return {id:c.id,rev:'preview',title:c.title,summary:c.summary,flag:{label:c.id==='notice'?'需要关注':'新反馈',warm:c.id==='notice'},source:c.source,time:c.time,project:c.project,
        context:p?{symbol:p.symbol,tone:p.tone,name:p.name,status:p.status,next:p.next}:null,openLabel:'查看详情',raw:c};});
  }
  function previewShelf(){
    const n=el('div','panel-stack');
    for(const [state,label] of [['later','稍后'],['known','已知晓']]){
      const list=changes.filter(c=>attention.get(c.id)===state);
      n.append(block(label,list.length?`${list.length} 件`:''));
      if(!list.length){n.append(note('这里暂时没有变化。'));continue;}
      const rows=el('div','shelf-list');
      list.forEach(c=>{const row=el('div','shelf-row'),main=el('div','shelf-main');main.append(el('strong','',c.title),el('span','quiet-text',`${c.source} · ${c.time}`));
        const acts=el('div','shelf-actions');acts.append(button('查看详情',()=>changeDetail(c),'text-button'),button('重新关注',()=>{attention.delete(c.id);ctx.home.reload();previewShelf();toast('已重新关注：'+c.title);},'quiet-button'));
        row.append(main,acts);rows.append(row);});
      n.append(rows);
    }
    panel('稍后与已知晓',n,'等你决定');
  }
  function previewAdapter(){
    const total=files.length+discoveries.length+versions.length+issues.length+changes.length;
    return {
      kind:'preview',
      items:previewItems,
      act(item,action){attention.set(item.id,action==='ack'?'known':'later');return true;},
      undo(item){attention.delete(item.id);},
      open(item){changeDetail(item.raw);},
      shelfLabel(){const later=[...attention.values()].filter(v=>v==='later').length,known=[...attention.values()].filter(v=>v==='known').length;return later||known?`稍后 ${later} · 已知晓 ${known}`:'';},
      openShelf:previewShelf,
      subtitle(){return `工作台里共 ${total} 项记录，其余都已归到各自的工作空间。`;},
      emptyText:`可以去读右边 Agent 的 ${Math.min(3,discoveries.length)} 条今日发现。`,
      introRecords(){return [
        ...files.map(f=>({kind:'file',proj:f.project})),
        ...versions.map(()=>({kind:'version',proj:'paper'})),
        ...issues.map(()=>({kind:'issue',proj:'paper'})),
        ...discoveries.map((d,i)=>({kind:'disc',i})),
        ...previewItems().map(c=>({kind:'change',proj:c.project})),
      ];},
    };
  }
  function changeDetail(c){
    const summary=card('panel-summary');summary.append(tag(c.id==='notice'?'适用范围待核实':'已收到反馈',c.tone),el('p','',c.summary));
    const content=el('div','panel-stack');content.append(block('变化与依据'),field('来源',c.source),field('核查状态',c.id==='notice'?'待核对适用年级与专业':'意见已整理，采用情况逐项核对'),field('原始来源位置','尚未提供可打开的原始附件'),note('保留来源声明，附件与具体条款仍待补充，不能据此认定要求已核实。'),block('对当前工作的影响'),note(c.id==='notice'?'需要确认实验记录是否应随阶段材料提交。当前计划尚未修改。':'本轮版本中可查看每条意见、拟定处理与实际采用证据。'),rowAction('进入关联项目 →',()=>{$('panel-dialog').close();openProject(c.id==='notice'?'thesis':'paper',c.id==='notice'?'计划':'版本');},'primary'));
    content.append(rowAction('查看来源定位',()=>sourcePanel(c)));
    panel(c.title,[summary,content],'重要变化');
  }
  function sourcePanel(c){
    const n=el('div','panel-stack');
    n.append(tag('来源待补充','amber'),block('已保留的声明'),field('来源类别',c.source),field('原始通知地址','尚未提供'),field('原始附件位置','尚未提供'),block('下一步核对'),el('p','body-copy','当前无法打开原始通知。需要从原发布渠道补充通知地址或附件，再核对适用年级、专业、具体条款和发布日期。'),copyButton('核对事项：原始通知地址或附件；适用年级与专业；具体材料条款；发布日期。','复制核对事项',n),note('原件缺失期间，保留待核实状态，不据此改写项目计划。'));
    panel('通知来源与待核对项',n,'来源定位');
  }
  function rail(){
    const host=$('context-rail');host.replaceChildren();if(!state.preview){const n=card('rail-card');n.append(el('p','eyebrow','CONTINUE YOUR WORK'),el('h3','','工作仍在原来的地方'),el('p','muted-note','发现保留来源和对应的原生会话定位，需要深入时再回去继续。'));host.append(n);return;}
    const n=el('section','rail-card continue-card');n.append(el('h3','','继续工作'));
    projects.filter(p=>p.progress!=null&&!p.paused).slice(0,2).forEach(p=>{const b=button('',()=>openProject(p.id),'continue-row');const name=el('div','continue-name');name.append(el('span','',p.name),el('em','',p.progress+'%'));const bar=el('span','continue-bar');const fill=el('i');fill.style.transform=`scaleX(${p.progress/100})`;bar.append(fill);bar.setAttribute('role','meter');bar.setAttribute('aria-label',p.name+' 进展');bar.setAttribute('aria-valuenow',String(p.progress));bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');b.append(badge(p.symbol,p.tone),name,el('small','','下一步：'+p.next),bar);n.append(b);});
    host.append(n);
  }
  function renderProjects(){
    heading('工作空间','回到正在推进的工作，知道下一步在哪里。','YOUR WORK, IN CONTEXT');
    const host=$('view-content');
    if(!state.preview){host.append(empty('让已有工作有一个清晰入口','项目视图目前可在界面预览中体验；真实工作空间接入尚未启用。',rowAction('浏览项目界面',()=>ctx.setPreview(true),'primary')));return;}
    const toolbar=el('div','view-toolbar');const chips=el('div','filter-chips');
    ['全部','进行中','收藏','暂停'].forEach(f=>chips.append(button(f,()=>{filter=f;renderPage('projects');},`chip${filter===f?' selected':''}`)));
    toolbar.append(chips,rowAction('＋ 关联工作目录',()=>openWorkspaceForm()));host.append(toolbar);
    const selected=projects.filter(p=>filter==='收藏'?favorite.has(p.id):filter==='暂停'?p.paused:filter==='进行中'?!p.paused:true);
    if(!selected.length){host.append(empty('这里暂时没有工作空间','可以切换筛选，查看其他工作空间。'));return;}
    // 与「今日发现」同一套清单语言：一块纸面装一组，组标题带计数，
    // 组内一行一个工作空间。不再用「卡片套行」——那会和老布局一样层层加框。
    const layout=el('div','project-list-layout'),list=el('div','project-groups');
    [...new Set(selected.map(p=>p.group))].forEach(group=>{const groupCard=el('section','project-group');const h=el('div','group-heading');h.append(el('h2','',group),el('span','count-badge',String(selected.filter(p=>p.group===group).length)));const rows=el('div','project-rows');selected.filter(p=>p.group===group).forEach(p=>rows.append(projectCard(p)));groupCard.append(h,rows);list.append(groupCard);});
    // 侧栏已经列了「我的工作空间」，主区又按组列一遍，右栏再列「最近访问」＝第三份同样的列表。
    // 减到只剩主列表；最近访问已由侧栏承担。
    layout.append(list);host.append(layout);
  }
  function renderProject(){
    const p=project();heading(p.name,p.subtitle,'WORKSPACE / '+(p.kind==='area'?'长期工作':'项目'));
    const host=$('view-content'),tools=el('div','project-tools');const status=tag(p.status,'project-status');if(p.status==='返修中')status.classList.add('needs-attention');tools.append(status,el('span','quiet-text',`最近记录 · ${p.date}`),button(favorite.has(p.id)?'★ 已收藏':'☆ 收藏',()=>{favorite.has(p.id)?favorite.delete(p.id):favorite.add(p.id);renderPage('project');},'button secondary'),button('返回工作空间',()=>navigate('projects'),'text-button'));host.append(tools);
    const names=p.kind==='paper'?['概览','版本','文件','工作记录','计划','专题视图','设置']:['概览','文件','工作记录','计划','设置'];
    if(!names.includes(tab))tab='概览';host.append(tabs(names,tab,t=>{tab=t;renderPage('project');}));
    if(tab==='概览')overview(host,p);else if(tab==='版本')versionOverview(host);else if(tab==='文件')fileBrowser(host,p.id);else if(tab==='计划')planView(host,p);else if(tab==='工作记录')recordsView(host,p);else if(tab==='专题视图')canvasView(host);else projectSettings(host,p);
  }
  function overview(host,p){
    if(p.kind==='paper'){
      // Stage line and version line are read side by side: a stage says what
      // happened, the version beside it says what was frozen. The brace between
      // them is what makes "which version came out of which stage" legible.
      const toolbar=el('div','overview-toolbar');
      toolbar.append(block('项目进展','从初稿到返修，阶段是一条线，里程碑是冻在某一刻的那一版。'),rowAction('查看完整时间线 →',()=>{tab='版本';renderPage('project');}));
      host.append(toolbar);
      // The stage line needs the full content width: two rails plus the fan of
      // version links do not survive being squeezed beside a sidebar.
      const layout=el('div','project-overview');
      const board=createStageBoard({
        el,button,tag,stages,versions,files,
        onOpenDetail:v=>{version=v.id;tab='版本';renderPage('project');versionDetail(v);},
      });
      layout.append(board,overviewAside(p));
      host.append(layout);
    }else if(p.kind==='plan'){planView(host,p);}
    else if(p.kind==='software'){
      const grid=el('div','two-column'),delivery=card('content-card');delivery.append(block('正在推进的交付','V2-03 · 持久化采集入口'),tag('开发中','blue'),el('h3','','让每次采集都能可靠留下来'),el('p','body-copy','保留原始记录、修订历史和处理状态，让刷新、重试与后续回看保持连续。'),progress(3,5),rowAction('查看交付与验收 →',()=>deliveryPanel(p),'primary'));
      const next=card('content-card');next.append(block('下一步'),task('确认采集入口的边界',true),task('实现可重试的持久化写入',true),task('核对刷新后的读回结果',false),task('真实设备与媒体验收',false));grid.append(delivery,next);host.append(grid);
      const checks=card('content-card');checks.append(block('验证与边界'),field('工程检查','通过不等于产品验收'),field('真实设备','待验证'),field('来源','项目计划与交付记录'),rowAction('查看来源文件',()=>filePanel(files[5])));host.append(checks);
    }else{
      const grid=el('div','two-column');const weekly=card('content-card');weekly.append(block('本周教学重点','持续工作，不必人为设一个终点。'),el('h3','','让学生把受力分析说清楚'),el('p','body-copy','从画图到列式，先识别研究对象，再说明每一个力的来源。'),task('整理上次课的易错点',true),task('准备受力分析例题',false));
      const next=card('content-card');next.append(block('下次课程'),field('主题','牛顿运动定律'),field('准备材料','例题、错题与课堂笔记'),rowAction('继续本次备课 →',()=>recordsViewPanel(p),'primary'));grid.append(weekly,next);host.append(grid);
    }
  }
  // Right-hand summary: what files exist, what feedback asked for, what is done,
  // what is next. Each card answers one question the stage line raises.
  function overviewAside(p){
    const aside=el('div','overview-aside');
    const currentVersion=versions.find(v=>v.state==='进行中')||versions.find(v=>v.id==='v3');
    const currentFiles=files.filter(f=>f.project===p.id);
    const focus=card('focus-card');
    const head=el('div','card-head');head.append(badge('document','blue'),el('h3','','关键文件'),el('span','count',`${currentFiles.length}`),button('查看全部 →',()=>{tab='文件';renderPage('project');},'text-button'));
    focus.append(head);
    currentFiles.slice(0,4).forEach(f=>{
      const row=button('',()=>filePanel(f),'file-line');
      row.append(badge(f.icon,f.tone));
      const info=el('div','file-line-info');
      info.append(el('strong','',f.name),el('span','',`${f.size} · ${f.date}`));
      row.append(info,icon('arrow'));
      focus.append(row);
    });
    aside.append(focus);

    const feedback=card('content-card');
    const fbHead=el('div','card-head');fbHead.append(badge('chat','blue'),el('h3','','导师反馈摘要'),el('span','count',`共 ${issues.length} 条`),button('查看全部 →',()=>{tab='版本';renderPage('project');versionDetail(currentVersion);},'text-button'));
    feedback.append(fbHead);
    const fbList=el('ul','bullet-list');
    issues.slice(0,3).forEach(i=>fbList.append(el('li','',i.title)));
    feedback.append(fbList);
    aside.append(feedback);

    const done=currentVersion?currentVersion.done:0,total=currentVersion?currentVersion.total:0;
    const tasks=card('content-card');
    const taskHead=el('div','card-head');taskHead.append(badge('check','teal'),el('h3','','已完成修改'),el('span','count',`${done}/${total}`),button('查看任务 →',()=>versionDetail(currentVersion),'text-button'));
    tasks.append(taskHead);
    issues.forEach(i=>{
      const line=el('div','task-row');
      const ok=i.status==='已落实';
      line.append(el('span',ok?'task-check done':'task-check',ok?'✓':''),el('span','task-label',i.title),el('span','task-when',i.status));
      tasks.append(line);
    });
    aside.append(tasks);

    const next=card('content-card next-card');
    const nextStage=stages.find(s=>s.state==='future');
    const nextHead=el('div','card-head');nextHead.append(badge('clock','violet'),el('h3','',`下一个节点：${nextStage?nextStage.title:'—'}`));
    next.append(nextHead);
    if(nextStage){next.append(el('p','next-when',`预计 ${nextStage.day}（${daysUntil(nextStage.day)}）`),el('p','body-copy',nextStage.lines.join('；')+'。'));}
    next.append(button('查看计划 →',()=>{tab='计划';renderPage('project');},'text-button'));
    aside.append(next);

    const goal=card('content-card goal-card');
    const goalHead=el('div','card-head');goalHead.append(badge('spark','amber'),el('h3','','预期成果'));
    goal.append(goalHead,el('p','body-copy','完成论文发表，在目标期刊发表研究成果。'));
    aside.append(goal);
    return aside;
  }
  function daysUntil(day){
    const target=new Date(`${day}T12:00:00+08:00`);
    const today=new Date('2026-10-30T12:00:00+08:00');
    const days=Math.round((target-today)/86400000);
    return days<=0?'今天':days===1?'明天':`${days} 天后`;
  }
  function progress(done,total){const n=el('div','progress-track');n.setAttribute('role','meter');n.setAttribute('aria-label','本轮进展');n.setAttribute('aria-valuenow',String(done));n.setAttribute('aria-valuemin','0');n.setAttribute('aria-valuemax',String(total));const fill=el('div',`progress-fill step-${Math.round(done/total*10)}`);n.append(fill);return n;}
  function task(title,done){const n=el('div','task-line');n.append(el('span',done?'task-check done':'task-check',done?'✓':''),el('span','',title));return n;}
  function versionOverview(host){
    const toolbar=el('div','view-toolbar');toolbar.append(block('整稿版本','每个版本关联一轮工作与成果。'),rowAction('版本对比',compareView));host.append(toolbar);
    const list=card('version-list');versions.forEach(v=>{const n=button('',()=>{version=v.id;versionDetail(v);},'version-row');n.append(badge('version',v.id==='v3'?'blue':'slate'));const info=el('div','version-info');info.append(el('h3','',v.name),el('p','',v.summary));n.append(info,tag(v.number),tag(v.state,v.id==='v3'?'blue':''),el('span','quiet-text',v.date),icon('arrow'));list.append(n);});host.append(list);
  }
  function versionDetail(v,restore=null){
    version=v.id;
    const head=el('div','version-detail-head');head.append(tag(v.number,'blue'),tag(v.state,v.id==='v3'?'blue':''),note(`本轮记录 · ${v.date}`),rowAction('版本对比',compareView));
    const stats=el('div','mini-stats');[['意见',String(v.total)],['已落实',String(v.done)],['待核对',String(v.total-v.done)]].forEach(([k,val])=>stats.append(field(k,val)));
    const list=el('div','issue-list');list.append(tabs(['全部','待处理','处理中','已落实'],issueFilter,f=>{issueFilter=f;versionDetail(v,0);}));
    issues.filter(i=>issueFilter==='全部'||(issueFilter==='待处理'?['待处理','待核对'].includes(i.status):i.status===issueFilter)).slice(0,v.total).forEach(i=>{const n=button('',()=>issuePanel(i),'issue-row');n.append(el('span','issue-number',String(i.id)));const info=el('div','issue-info');info.append(el('h3','',i.title),el('p','',i.plan),el('small','',i.location));n.append(info,tag(i.status,i.tone),icon('arrow'));list.append(n);});
    panel(`${v.name} · 意见落实`,[head,stats,list,rowAction('查看提交包',submissionPanel)],'论文版本',restore);
  }
  function issuePanel(i,restore=null){
    const back=button('← 返回本轮意见',()=>backTo(top=>versionDetail(versions.find(v=>v.id===version)||versions[0],top)),'text-button');
    const quote=el('blockquote','excerpt-block',i.quote);const body=el('div','panel-stack');body.append(back,tag(i.status,i.tone),block('导师 / 审稿意见原话'),quote,block('拟定处理'),el('p','body-copy',i.plan),block('实际采用与证据'),field('对应位置',i.location),field('关联文件',i.file),field('采用状态',i.status==='已落实'?'已记录采用位置，原文件仍需最终核对':'待核对，不能仅凭文件存在认定落实'),rowAction('查看关联文件',()=>filePanel(files.find(f=>f.name===i.file)||files[0],()=>backTo(top=>issuePanel(i,top)))),block('继续这项工作'),note('回到原生 Harness 查看完整讨论。当前预览没有真实会话身份。'));
    panel(i.title,body,`${versions.find(v=>v.id===version)?.name||'本轮版本'} / 意见 ${i.id}`,restore);
  }
  function compareView(){
    const host=$('view-content');closeDialog($('panel-dialog'));tab='版本';host.replaceChildren();host.append(button('← 返回版本列表',()=>renderPage('project'),'text-button'),block('版本对比','先看变化，再看它回应了什么问题。'));
    const controls=el('div','compare-controls');['比较版本','目标版本'].forEach((label,i)=>{const l=el('label','field-label',label),s=el('select','token-input');versions.forEach(v=>{const o=el('option','',`${v.number} · ${v.name}`);o.value=v.id;if(v.id===(i?'v3':'v2'))o.selected=true;s.append(o);});l.append(s);controls.append(l);});host.append(controls);
    const result=card('compare-result');
    const update=()=>{const selected=[...controls.querySelectorAll('select')].map(s=>versions.find(v=>v.id===s.value));result.replaceChildren();if(selected[0].id===selected[1].id){result.append(note('当前选择了同一版本，没有版本间差异。'));return;}
      const columns=el('div','compare-columns');selected.forEach((v,i)=>{const col=el('div','compare-column');col.append(el('p','eyebrow',v.number),el('h3','',v.name),el('h4','','递送效率与比较条件'));const paragraph=el('p','body-copy');paragraph.append(document.createTextNode('不同宿主的结果需要在明确的条件下比较。'));paragraph.append(el(i?'ins':'del','',i?'比较时保留宿主、实验任务与效率分母，未知信息单独标记。':'不同条件的结果在同一指标下汇总。'));col.append(paragraph,note(i?'修改目的：收敛证据边界。':'当前展示为文件级变化摘要。'));columns.append(col);});result.append(columns);};controls.addEventListener('change',update);update();host.append(result);
  }
  function fileLink(f){const b=button('',()=>filePanel(f),'file-link');b.append(badge(f.icon,f.tone),el('span','',f.name),icon('arrow'));return b;}
  function fileBrowser(host,projectId=null){
    const layout=el('div','file-layout'),tree=card('file-tree');tree.append(block('文件夹'));['全部文件','manuscript','supplement','figures','references','docs'].forEach(folder=>{const b=button('',()=>{fileFilter=folder;renderPage(state.view);},`tree-link${fileFilter===folder?' selected':''}`);b.append(icon(folder==='全部文件'?'file-generic':'folder'),el('span','',folder));tree.append(b);});
    const content=card('file-content'),bar=el('div','file-toolbar');bar.append(el('strong','',fileFilter),note('原位置引用 · 只读浏览'));content.append(bar);
    const filtered=files.filter(f=>(!projectId||f.project===projectId)&&(fileFilter==='全部文件'||f.folder===fileFilter));
    if(!filtered.length)content.append(empty('此处没有文件引用','可以切换文件夹查看其他文件。'));
    else{const table=el('div','file-table');const header=el('div','file-table-header');['名称','修改时间','类型','大小'].forEach(t=>header.append(el('span','',t)));header.append(el('span','',''));table.append(header);
      // 每行：文件名（可进入）+ 时间 + 类型 + 大小 + 常驻「查看 →」。
      // 手机上时间与大小不整列隐藏，而是压到文件名下方，否则判断不出哪份更新。
      filtered.forEach(f=>{const b=button('',()=>filePanel(f),'file-table-row');const name=el('span','file-name');const stack=el('span','file-title');stack.append(el('strong','',f.name),el('span','file-when',`${f.date} · ${f.size} · ${f.type}`));name.append(badge(f.icon,f.tone),stack);const open=el('span','file-open','查看');open.append(icon('arrow'));b.append(name,el('span','',f.date),el('span','',f.type),el('span','',f.size),open);table.append(b);});
      content.append(table);}
    layout.append(tree,content);host.append(layout);
  }
  function filePanel(f,back=null,restore=null){
    const body=el('div','panel-stack');body.append(badge(f.icon,f.tone));const content=el('div','file-preview');
    if(f.preview==='figure'){const flow=el('div','mini-flow');['递送','表达','适配'].forEach((t,i)=>{flow.append(el('span','',t));if(i<2)flow.append(el('b','','→'));});content.append(flow,note('阶段关系 · Figure 2'));}
    else if(f.preview)content.append(el('pre','text-preview',f.preview));else content.append(badge(f.icon,f.tone),el('h3','','此文件尚无内嵌预览'),note('文件引用仍保留，可复制位置后在原有工具中查看。'));
    body.append(content,block('文件信息'),field('文件名',f.name),field('大小 / 类型',`${f.size} / ${f.type}`),field('关联项目',projects.find(p=>p.id===f.project)?.name||'未知'),field('位置声明',`项目目录 / ${f.folder} / ${f.name}`),copyButton(`项目目录 / ${f.folder} / ${f.name}`,'复制位置声明',body),note('预览中的相对位置不代表已核对磁盘上的真实文件。'));
    if(back)body.prepend(button('← 返回意见',back,'text-button'));
    panel(f.name,body,'资料 / 文件预览',restore);
    panelBack=back;
  }
  function planView(host,p){
    const layout=el('div','two-column plan-layout'),plan=card('content-card');plan.append(block(p.kind==='area'?'近期准备':'阶段计划','阶段进展与未来安排分开呈现。'));
    const stages=p.kind==='plan'?['文献与问题梳理','实验设计','材料准备','实验与记录','结果分析与报告']:p.kind==='area'?['整理上次课反馈','准备本次课程','课堂与练习','记录下一次重点']:['明确问题与边界','完成本轮修改','核对采用证据','准备交付材料'];
    stages.forEach((s,i)=>{const n=el('div',`plan-stage${i===1?' current':''}`);n.append(el('span','stage-dot',i===0?'✓':String(i+1)),el('strong','',s),tag(i===0?'已记录':i===1?'进行中':'计划',i===1?'blue':''));plan.append(n);});
    const right=el('div','overview-aside'),next=card('content-card');next.append(block('下一步与依赖'),task(p.next,false),task('核对相关材料与来源',false),note('下一步引用项目计划，不另外维护一份全局待办。'));
    const impact=card('impact-card');impact.append(tag('待核实的影响','amber'),el('h3','','材料要求可能变化'),el('p','body-copy','先核对适用范围，再决定是否调整当前计划。'),rowAction('查看调整建议',()=>{const n=el('div','panel-stack');n.append(block('当前计划'),note('当前材料准备安排保持不变。'),block('建议调整'),note('如果通知适用于本项目，则补充实验记录附件并重新检查提交准备。'),tag('尚未改写计划','amber'),rowAction('查看来源状态',()=>sourcePanel(changes[0])));panel('计划调整建议',n,'变化影响');}));right.append(next,impact);layout.append(plan,right);host.append(layout);
  }
  function recordsView(host,p){const n=card('content-card');n.append(block('工作记录','只保留与当前节点有关的成果和会话锚点。'));[['今天','本轮成果与核对摘要'],['10月28日','方法讨论与资料整理']].forEach(([date,title])=>{const b=button('',()=>recordsViewPanel(p),'record-row');b.append(el('span','quiet-text',date),el('strong','',title),icon('arrow'));n.append(b);});host.append(n);}
  function recordsViewPanel(p){const n=el('div','panel-stack');n.append(tag('节点关联','blue'),block('工作上下文'),note(p.next),block('原生会话定位'),field('Harness',p.kind==='software'?'Codex':'DSH'),field('主会话身份','尚未提供'),note('预览中不伪造会话链接。接入真实记录后，按明确的主会话身份定位。'));panel('继续这项工作',n,p.name);}
  function deliveryPanel(p){const n=el('div','panel-stack');n.append(tag('阶段交付','blue'),block('结果与核验'),field('生产者报告','已形成阶段结果'),field('工作台接收','预览未产生正式交付'),field('工程检查','与真实验收分开记录'),field('真实设备与内容','待验证'),block('输出引用'),fileLink(files[5]),rowAction('查看原生会话定位',()=>recordsViewPanel(p)));panel('持久化采集入口',n,'项目交付摘要');}
  function submissionPanel(){const n=el('div','panel-stack');n.append(note('准备材料不等于已经提交。'),block('本轮材料'));files.filter(f=>f.project==='paper').slice(0,4).forEach(f=>n.append(fileLink(f)));n.append(field('待核对','最终采用版本、图表与回复位置'),copyButton(files.filter(f=>f.project==='paper').map(f=>f.name).join('\n'),'复制文件清单',n));panel('提交包预览',n,'R1返修版 / 材料准备');}
  function projectSettings(host,p){const n=card('content-card');n.append(block('工作空间信息'),field('名称',p.name),field('类型',p.kind==='area'?'长期工作':'项目'),field('原目录',p.path||'未关联真实目录'),note('当前为界面预览，配置不写入真实项目文件。'),rowAction(p.paused?'恢复到进行中':'暂停此预览项目',()=>{p.paused=!p.paused;toast(p.paused?'预览项目已暂停':'预览项目已恢复');renderPage('project');}));host.append(n);}
  function canvasView(host){
    const n=card('canvas-card'),toolbar=el('div','canvas-toolbar');toolbar.append(tabs(['正式视图','探索层'],layer==='explore'?'探索层':'正式视图',v=>{layer=v==='探索层'?'explore':'formal';canvasViewReplace();}),button('−',()=>scale(-.1),'icon-button'),el('span','canvas-zoom',`${Math.round(zoom*100)}%`),button('＋',()=>scale(.1),'icon-button'),rowAction('保存为项目视图',()=>{savedCanvas={positions:[...board.querySelectorAll('.canvas-node')].map(node=>({left:node.offsetLeft,top:node.offsetTop})),zoom};toast('布局已保留在当前预览中，未改写项目事实');}));
    const viewport=el('div','canvas-viewport'),board=el('div','canvas-board');board.tabIndex=0;board.setAttribute('aria-label','专题关系画布，可拖动节点');
    const links=document.createElementNS('http://www.w3.org/2000/svg','svg');links.setAttribute('class','canvas-links');links.setAttribute('viewBox','0 0 960 590');links.innerHTML='<path d="M480 120V185H210V255M480 185H750V255M480 120V390M210 320V450H480M750 320V450H480"/>';
    board.append(links);
    function updateLinks(){const nodes=[...board.querySelectorAll('.canvas-node')];if(nodes.length!==4)return;const anchor=(n,bottom)=>[n.offsetLeft+n.offsetWidth/2,n.offsetTop+(bottom?n.offsetHeight:0)];const start=anchor(nodes[0],true);links.replaceChildren();nodes.slice(1).forEach((node,i)=>{const end=anchor(node,false),path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',`M${start[0]} ${start[1]} C${start[0]} ${(start[1]+end[1])/2},${end[0]} ${(start[1]+end[1])/2},${end[0]} ${end[1]}`);links.append(path);const label=document.createElementNS('http://www.w3.org/2000/svg','text');label.setAttribute('x',String((start[0]+end[0])/2+7));label.setAttribute('y',String((start[1]+end[1])/2));label.textContent=['依据','假设','依赖'][i];links.append(label);});}
    [['研究问题','条件不同的结果如何比较？','root','引用'],['证据梳理','保留宿主、任务、条件与分母','left','依据'],['方案比较',layer==='explore'?'探索不同指标与适用范围':'已采用的比较框架','right','假设'],['当前方案','先明确证据边界，再讨论可迁移性','bottom','依赖']].forEach(([title,summary,pos,relation])=>{const node=el('button',`canvas-node node-${pos}`);node.type='button';node.append(tag(relation,pos==='right'?'violet':'blue'),el('h3','',title),el('p','',summary));node.addEventListener('click',()=>{if(node.dataset.dragged==='true'){node.dataset.dragged='false';return;}const b=el('div','panel-stack');b.append(tag(layer==='explore'?'探索内容':'正式视图引用',layer==='explore'?'violet':'blue'),el('p','body-copy',summary),block('采用范围'),note('保存布局不等于把方案认定为研究结论。'),rowAction('保留为当前视图',()=>{$('panel-dialog').close();toast('已保留在当前预览视图中');},'primary'));panel(title,b,'项目专题视图');});
      let start=null;node.addEventListener('pointerdown',e=>{start={x:e.clientX,y:e.clientY,left:node.offsetLeft,top:node.offsetTop};node.setPointerCapture(e.pointerId);});node.addEventListener('pointermove',e=>{if(!start)return;const dx=(e.clientX-start.x)/zoom,dy=(e.clientY-start.y)/zoom;if(Math.abs(dx)+Math.abs(dy)>5){node.dataset.dragged='true';node.style.left=`${Math.max(0,Math.min(720,start.left+dx))}px`;node.style.top=`${Math.max(0,Math.min(470,start.top+dy))}px`;node.classList.add('moved');updateLinks();}});node.addEventListener('pointerup',()=>{start=null;});node.addEventListener('pointercancel',()=>{start=null;});board.append(node);});
    if(savedCanvas){[...board.querySelectorAll('.canvas-node')].forEach((node,i)=>{const pos=savedCanvas.positions[i];node.style.left=`${pos.left}px`;node.style.top=`${pos.top}px`;});zoom=savedCanvas.zoom;}board.style.transform=`scale(${zoom})`;
    viewport.append(board);n.append(toolbar,viewport,note('连线表示引用、假设与依赖；拖动只改变布局。'));host.append(n);
    requestAnimationFrame(()=>{updateLinks();if(viewport.clientWidth<700){const root=board.querySelector('.node-root');if(root)viewport.scrollLeft=Math.max(0,(root.offsetLeft+root.offsetWidth/2)*zoom-viewport.clientWidth/2);}});
    function scale(delta){zoom=Math.max(.6,Math.min(1.4,zoom+delta));board.style.transform=`scale(${zoom})`;$('view-content').querySelector('.canvas-zoom').textContent=`${Math.round(zoom*100)}%`;}
    function canvasViewReplace(){n.remove();canvasView(host);}
  }
  function renderFiles(){heading('资料','连接已有文件，在上下文中查看它们。','FILES, WHERE THEY BELONG');const host=$('view-content');if(!state.preview){host.append(empty('文件仍在原来的地方','真实发现中已经保留了来源定位；跨项目文件索引尚未接入。',rowAction('查看发现来源',()=>navigate('all'),'primary')));return;}fileBrowser(host);}
  function renderSearch(){
    heading('搜索','找到项目、发现与相关成果。','FIND YOUR WAY BACK');const host=$('view-content'),box=el('div','search-box surface'),input=el('input','');input.type='search';input.placeholder='搜索当前已载入的内容…';input.value=query;input.setAttribute('aria-label','全局搜索当前已载入内容');box.append(icon('search'),input);host.append(box,note(state.preview?'范围：预览中的工作空间、发现与文件引用，不包含原生聊天。':'范围：当前已载入的发现。'),tabs(['全部','工作空间','发现','文件'],filter==='全部'||['工作空间','发现','文件'].includes(filter)?filter:'全部',v=>{filter=v;renderPage('search');}));
    const results=el('div','search-results');host.append(results);
    const update=()=>{query=input.value;results.replaceChildren();const term=query.trim().toLowerCase(),match=t=>t.toLowerCase().includes(term);let count=0;
      if(state.preview&&(filter==='全部'||filter==='工作空间'))projects.filter(p=>match(p.name+' '+p.subtitle)).forEach(p=>{results.append(projectCard(p));count++;});
      if(filter==='全部'||filter==='发现')(state.preview?discoveries:state.items).filter(d=>match(d.title+' '+d.interpretation)).forEach(d=>{const b=button('',()=>openDetail(d.record_id),'search-result surface');b.append(tag('发现','blue'),el('h3','',d.title),el('p','',d.interpretation),icon('arrow'));results.append(b);count++;});
      if(state.preview&&(filter==='全部'||filter==='文件'))files.filter(f=>match(f.name)).forEach(f=>{results.append(fileLink(f));count++;});
      if(!count)results.append(empty('没有匹配的内容','试试更短的关键词，或切换搜索范围。'));};input.addEventListener('input',update);update();
  }
  function renderSettings(){
    heading('连接与设置','工作台是一个入口，工作仍在原处。','MAKE ROOM FOR FOCUS');
    const host=$('view-content'),layout=el('div','settings-layout');
    const connection=card('content-card settings-card');
    connection.append(block('本地工作台','管理当前连接状态。'),field('当前模式',state.preview?'界面预览':state.token?'已连接本机服务':'尚未连接'),note('访问令牌只保留在页面内存，刷新后需要重新连接。'),rowAction(state.token?'管理连接':'连接工作台',openConnection,'primary'));
    const display=card('content-card settings-card');display.append(block('显示偏好','调整页面的信息密度。'));
    const density=button(document.body.classList.contains('compact')?'使用舒展布局':'使用紧凑布局',()=>{const on=document.body.classList.toggle('compact');density.textContent=on?'使用舒展布局':'使用紧凑布局';try{localStorage.setItem('workbench-density',on?'compact':'comfortable');}catch{toast('显示偏好仅在当前页面生效');}},'button secondary');display.append(density);
    const preview=card('content-card settings-card');preview.append(block('界面预览','查看尚未接入真实数据的项目、版本和专题视图。'),rowAction(state.preview?'退出预览':'进入界面预览',()=>ctx.setPreview(!state.preview)));
    layout.append(connection,display,preview);host.append(layout);
  }
  function openWorkspaceForm(){
    $('workspace-form').reset();$('workspace-form-note').textContent='当前只添加到本次界面预览，不创建或搬迁目录，也不写入真实工作台。';openDialog($('workspace-dialog'));
  }
  $('workspace-form').addEventListener('submit',e=>{e.preventDefault();if(!state.preview)return;const name=$('workspace-name').value.trim(),path=$('workspace-path').value.trim();if(!name||!path)return;const kind=$('workspace-kind').value;projects.push({id:`added-${Date.now()}`,name,path,subtitle:'用户登记的预览入口 · 目录尚未核对',group:'新增入口',kind,tone:'blue',symbol:'folder',status:'待关联',date:'刚刚',next:'核对目录与来源',progress:null});$('workspace-dialog').close();filter='全部';navigate('projects');toast('已添加到本次预览，未检查或修改目录');});
  $('close-workspace').addEventListener('click',()=>closeDialog($('workspace-dialog')));// 关闭按钮与 Esc 走同一套栈：有上一级就退回上一级（并还原滚动位置），没有再真正关面板。
  function panelBackOnce(){const back=panelBack;panelBack=null;return back&&back()!==false;}
  $('close-panel').addEventListener('click',()=>{if(!panelBackOnce())closeDialog($('panel-dialog'));});
  $('panel-dialog').addEventListener('cancel',event=>{if(panelBackOnce()){event.preventDefault();event.stopImmediatePropagation();}},true);
  $('global-search').addEventListener('click',()=>{filter='全部';navigate('search');$('view-content').querySelector('input')?.focus();});$('top-settings').addEventListener('click',()=>navigate('settings'));
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){if(document.querySelector('dialog[open]'))return;e.preventDefault();filter='全部';navigate('search');$('view-content').querySelector('input')?.focus();}});
  try{if(localStorage.getItem('workbench-density')==='compact')document.body.classList.add('compact');}catch{}
  function renderPage(view){
    const discovery=['home','all'].includes(view);$('view-content').hidden=discovery;$('view-content').replaceChildren();$('discovery-workspace').hidden=!discovery;$('refresh').hidden=!discovery||(!state.token&&!state.preview);$('today-date').hidden=!discovery||(!state.token&&!state.preview);
    const active=view==='project'?'projects':view;
    const symbols={home:'home',projects:'folder',all:'spark',files:'document',settings:'settings'};
    document.querySelectorAll('.nav-item').forEach(n=>{const name=n.id.replace('nav-',''),on=name===active;n.classList.toggle('active',on);if(on)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');n.querySelector('span')?.replaceWith(icon(symbols[name]+(on?'-active':'')));});
    document.querySelectorAll('.mobile-nav button').forEach(n=>{const on=n.dataset.view===active;n.classList.toggle('active',on);if(on)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');n.querySelector('span')?.replaceWith(icon(symbols[n.dataset.view]+(on?'-active':'')));});
    renderShortcuts();
    if(!state.preview&&live.supports(view))live.render(view);
    else if(view==='home'){
      ctx.home.show(state.preview?previewAdapter():null);rail();
    }else if(view==='all'){heading('发现','值得探索的新内容，和它们背后的依据。','A LITTLE CURIOSITY, EVERY DAY');rail();}
    else if(view==='projects')renderProjects();else if(view==='project')renderProject();else if(view==='files')renderFiles();else if(view==='search')renderSearch();else renderSettings();
    $('see-all').hidden=view!=='home';$('preview-toggle').textContent=state.preview?'预览数据':'界面预览';$('preview-toggle').setAttribute('aria-pressed',String(state.preview));document.body.classList.toggle('is-home',view==='home');
    ctx.syncNav();
  }
  function resetPreview(){live.reset();projects=initialProjects.map(p=>({...p}));favorite=new Set(['paper','software']);attention.clear();filter='全部';fileFilter='全部文件';savedCanvas=null;zoom=1;layer='explore';}
  return {render:renderPage,resetPreview,openProject,panel};
}
