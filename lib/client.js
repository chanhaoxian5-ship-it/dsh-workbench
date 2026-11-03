window.__ModuleLoader__.load({
  id:'@chanhaoxian5/dsh-workbench',
  factory:require=>{
    const React=require('react'),h=React.createElement;
    const CSS=`.wb-settings{display:flex;flex-direction:column;gap:18px;color:var(--dsw-alias-label-primary)}.wb-settings h3{margin:0;font-size:18px}.wb-settings p{margin:0;font-size:13px;line-height:1.8;color:var(--dsw-alias-label-secondary)}.wb-settings .wb-card{padding:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.wb-settings .wb-row{display:flex;justify-content:space-between;gap:20px;margin-top:10px;font-size:12px}.wb-settings .wb-value{overflow-wrap:anywhere;text-align:right;max-width:75%;font-family:Consolas,monospace}.wb-settings .wb-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.wb-settings button,.wb-settings a{font:inherit;font-size:13px;padding:7px 13px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;text-decoration:none}.wb-settings button:disabled{opacity:.45;cursor:wait}.wb-settings .wb-state{display:inline-block;padding:3px 9px;border-radius:20px;font-size:12px;background:var(--dsw-alias-bg-layer-1)}.wb-settings pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto;margin:12px 0 0}.wb-settings .wb-error{color:var(--dsw-alias-status-danger,#dc5353);font-size:13px}.wb-settings small{font-size:12px;color:var(--dsw-alias-label-secondary)}`;
    const labels={running:'运行中',stopped:'已停止',unavailable:'实例无法确认'};
    function Page({call}){
      const [status,setStatus]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[mcp,setMcp]=React.useState(null),[link,setLink]=React.useState('');
      React.useEffect(()=>{let alive=true;call('status').then(v=>{if(alive)setStatus(v);}).catch(()=>{if(alive)setError('无法读取宿主插件，请确认插件已启用。');});return()=>{alive=false;};},[call]);
      const action=async name=>{setBusy(true);setError('');setLink('');try{if(name==='launch'){const result=await call(name);setLink(result.url);}else if(name==='mcpConfig'){setMcp(await call(name));}else setStatus(await call(name));}catch(e){setError('操作未确认：'+(e.code||e.message||'control_failed')+'。请刷新状态后核对。');}finally{setBusy(false);}};
      const row=(key,value)=>h('div',{className:'wb-row',key},h('span',null,key),h('span',{className:'wb-value'},value||'—'));
      const button=(name,label,disabled=false)=>h('button',{key:name,disabled:busy||disabled,onClick:()=>action(name)},label);
      return h('section',{className:'wb-settings'},h('style',null,CSS),h('h3',null,'Workbench 本地工作台'),h('p',null,'前端与后端随插件提供，项目记录保存在本机独立目录。其他 Agent 通过 MCP 使用同一服务。'),
        h('div',{className:'wb-card'},h('span',{className:'wb-state'},status?(labels[status.status]||status.status):'正在读取…'),row('监听地址',status?.api_base),row('进程 PID',status?.pid?String(status.pid):null),row('数据目录',status?.dataDir),row('版本',status?.version),
          h('div',{className:'wb-actions'},button('start','启动',status?.status==='running'),button('stop','停止',status?.status!=='running'),button('restart','重启',status?.status==='unavailable'),button('status','刷新状态'),button('launch','准备打开工作台',status?.status!=='running')),
          link?h('div',{className:'wb-actions'},h('a',{href:link,target:'_blank',rel:'noreferrer'},'打开工作台 ↗'),h('small',null,'30秒内有效，自动连接；过期后重新准备。')):null),
        error?h('div',{className:'wb-error',role:'alert'},error):null,
        h('div',{className:'wb-card'},h('strong',null,'给其他 Agent 的 MCP'),h('p',null,'标准输入输出连接，不额外占用端口。后端关闭时 MCP 会报告不可用，不会擅自重新启动。'),h('div',{className:'wb-actions'},button('mcpConfig','显示 MCP 配置')),
          mcp?h('pre',null,JSON.stringify(mcp,null,2)):null),
        h('small',null,'自动选择49152–65535内的空闲端口；数据目录不随插件升级删除。退出 DSH 后后端继续运行，可回到此处明确停止。'));
    }
    return {inject:['slots','connection'],apply(ctx){
      const connection=ctx.get('connection');
      const call=async action=>{const response=await connection.rpc.call('/api','workbench/'+action,{args:{}});if(!response.ok)throw Object.assign(Error('Host request failed'),{code:response.error?.code});return response.value;};
      ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'workbench-suite',order:45,label:'Workbench 工作台'},()=>h(Page,{call})));
    }};
  }
});
