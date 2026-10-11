import {config} from './config.js';
export class ApiError extends Error {constructor(code,message){super(message);this.code=code;}}
export function requestId() {return 'req_' + crypto.randomUUID();}
export function assertConfigured() {
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(config.apiUrl))
    throw new ApiError('CONFIG','請先在 config.js 填入新版測試 GAS 網址。');
}
export async function callApi(user, action, data={}, id) {
  assertConfigured();
  if(!user) throw new ApiError('AUTH','請先登入。');
  const idToken=await user.getIdToken();
  const body={...data,action,idToken};
  if(action!=='read') body.requestId=id || requestId();
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),45000);
  try {
    const res=await fetch(config.apiUrl,{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify(body),signal:controller.signal});
    if(!res.ok) throw new ApiError('NETWORK','無法確認處理結果，請稍後重試。');
    let result;
    try {result=await res.json();} catch {throw new ApiError('NETWORK','API 回應格式不符，請檢查部署設定。');}
    if(result.status!=='success') throw new ApiError(result.code||'SERVER',result.message||'操作失敗。');
    if(result.apiVersion!==40) throw new ApiError('VERSION','前後端版本不符，請使用 V40 GAS 部署。');
    return result;
  } catch(err) {
    if(err instanceof ApiError) throw err;
    throw new ApiError('NETWORK','連線中斷，無法確認結果。請保持表單內容，以相同操作重試。');
  } finally {clearTimeout(timer);}
}
