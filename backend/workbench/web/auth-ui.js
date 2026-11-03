// Access management deliberately uses cookies, never localStorage secrets.
const request = async (path, body) => {
  const response = await fetch(path, {method:body === undefined ? 'GET':'POST', credentials:'same-origin', cache:'no-store', redirect:'error',
    headers:{'X-Workbench-Request':'1', ...(body === undefined ? {} : {'Content-Type':'application/json'})},
    body:body === undefined ? undefined : JSON.stringify(body)});
  const value = await response.json();
  if (!response.ok) throw Error(response.status === 401 ? '请先连接工作台。' : value.error?.message || '操作失败，请重新核对。');
  return value;
};
const dialog = document.getElementById('access-dialog');
const error = document.getElementById('access-error');
const select = document.getElementById('access-workspace');
const list = document.getElementById('access-list');
const output = document.getElementById('access-result');
const date = seconds => new Date(seconds*1000).toLocaleString('zh-CN');
async function render() {
  const value = await request('/v1/auth/projects'); list.replaceChildren();
  for (const item of value.items) {
    const row = document.createElement('p');
    row.textContent = `${item.label} · ${item.workspace_id} · ${item.permissions === 'write' ? '读写':'只读'} · ${item.active ? '有效':'已失效'}\n最近使用：${date(item.last_used)}；最晚到期：${date(item.expires)} `;
    const revoke = document.createElement('button'); revoke.type='button'; revoke.className='button secondary'; revoke.textContent='撤销'; revoke.disabled=Boolean(item.revoked);
    revoke.onclick=async()=>{revoke.disabled=true;try{await request('/v1/auth/revoke',{credential_id:item.id});await render();}catch(e){error.textContent=e.message;revoke.disabled=false;}};
    row.append(revoke); list.append(row);
  }
  if (!value.items.length) list.textContent='还没有项目凭证。';
}
document.getElementById('access-open').onclick=async()=>{
  error.textContent='';output.textContent='';select.replaceChildren();dialog.showModal();
  try {
    // Follow the real registry's pagination; never silently omit later projects.
    let before;
    do {
      const result = await request('/v1/workspaces?limit=100&include_test=false'+(before ? '&before='+before:''));
      for (const workspace of result.items) {const option=document.createElement('option');option.value=workspace.id;option.textContent=workspace.name+' — '+workspace.root_path;select.append(option);}
      before=result.next_before;
    } while(before);
    await render();
  } catch(e) {error.textContent=e.message;}
};
document.getElementById('access-close').onclick=()=>dialog.close();
document.getElementById('access-form').onsubmit=async event=>{
  event.preventDefault();error.textContent='';output.textContent='';const button=document.getElementById('access-create');button.disabled=true;
  try {
    if (!select.value) throw Error('请先在工作台登记一个实际项目目录。');
    const value=await request('/v1/auth/projects',{workspace_id:select.value,label:document.getElementById('access-label').value.trim() || select.selectedOptions[0].textContent.split(' — ')[0],permissions:document.getElementById('access-permissions').value,idle_days:90,lifetime_days:365});
    output.textContent=`已写入 ${value.config_path}\nMCP 启动参数使用 --project-dir 加此项目目录。配置不含秘密；同一项目原配置对应的凭证已撤销。`;
    await render();
  } catch(e) {error.textContent=e.message;} finally {button.disabled=false;}
};
