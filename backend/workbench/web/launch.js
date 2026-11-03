// Bundled page bootstrap; the permanent API token never enters an URL.
import './app.js';
const ticket = new URLSearchParams(location.hash.slice(1)).get('launch');
if (ticket) {
  history.replaceState(null, '', location.pathname + location.search);
  document.getElementById('connect-main').click();
  try {
    const response = await fetch('/v1/runtime/connect', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket}),credentials:'omit',cache:'no-store',redirect:'error'});
    if (!response.ok) throw Error('启动链接已失效，请回到 DSH 设置重新打开工作台。');
    const result = await response.json();
    document.getElementById('token').value = result.token;
    document.getElementById('connect-form').requestSubmit();
  } catch (error) {
    const node = document.getElementById('connect-error');
    node.textContent = error.message;
    node.hidden = false;
  }
}
