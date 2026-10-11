import {config} from './config.js';
import {callApi,requestId,assertConfigured,ApiError} from './api.js';
import {e,day,today,money,yes,isVoid,isClosed,canEdit,status,statusNames,filterTransactions,totals,paginate} from './domain.js';
import {reportHtml,voucherHtml} from './reports.js';
const $=id=>document.getElementById(id), entry=$('entry-form');
let state={user:null,transactions:[],projects:[],categories:[],page:1}, firebaseUser=null,auth=null,epoch=0,
  busy=false,pending=null,reasonAction=null,currentDocument=null,messageTimer;
const projectName=id=>state.projects.find(p=>String(p.id)===String(id))?.name||id;
const button=(action,id,label)=>`<button data-action="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;
function message(text,error=false) {clearTimeout(messageTimer);$('message').textContent=text;$('message').className=error?'error':'';$('message').hidden=false;messageTimer=setTimeout(()=>$('message').hidden=true,9000);}
function loading(value){busy=value;$('busy').hidden=!value;}
function showTab(tab){if(!state.user)return;document.querySelectorAll('[data-view]').forEach(el=>el.hidden=el.dataset.view!==tab);document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===tab));window.scrollTo({top:0,behavior:'instant'});}
function years(){return [...new Set([today().slice(0,4),...state.transactions.map(t=>day(t.date).slice(0,4)),...state.transactions.map(t=>day(t.paymentDate).slice(0,4))])].filter(y=>/^\d{4}$/.test(y)).sort().reverse();}
function options(select,rows,{all='',valueKey='id',nameKey='name',defaultValue=''}={}) {
  const saved=select.value;
  select.innerHTML=(all?`<option value="">${e(all)}</option>`:'')+rows.map(r=>`<option value="${e(r[valueKey])}">${e(r[nameKey])}</option>`).join('');
  if([...select.options].some(o=>o.value===saved)) select.value=saved;
  else if(defaultValue) select.value=defaultValue;
}
function updateSelectors() {
  const y=years().map(id=>({id,name:id+' 年'}));
  options($('dashboard-year'),y,{defaultValue:today().slice(0,4)});
  options($('filter-year'),y,{all:'全部年度'});options($('filter-project'),state.projects,{all:'全部計畫'});
  options(entry.elements.projectId,state.projects.filter(p=>!isClosed(p)));
  const canIncome=['admin','accountant','treasurer'].includes(state.user.role);
  entry.elements.type.querySelector('[value="income"]').hidden=!canIncome;
  if(!canIncome)entry.elements.type.value='expense';updateCategories();
  document.querySelector('[data-tab="entry"]').hidden=state.user.role==='viewer';
}
function updateCategories(){const type=entry.elements.type.value;options(entry.elements.category,state.categories.filter(c=>!c.type||['both',type].includes(String(c.type).toLowerCase())),{valueKey:'name',nameKey:'name'});}
function renderDashboard() {
  const txs=filterTransactions(state.transactions,{year:$('dashboard-year').value}),s=totals(txs);
  const personal=state.user.role==='user';
  $('dashboard-scope').textContent=personal?'僅統計您建立的交易，不能代表協會或計畫全部收支。':'依交易登錄日期統計；已付款支出與尚未付款申請分開顯示。登錄收入並非銀行存款餘額。';
  $('stats').innerHTML=[['登錄收入',s.income,'收入登錄總額',''],['已付款支出',s.paid,'該年度登錄案件中已付款金額','expense'],['核准待付款',s.approved,'尚待出納處理',''],['待核准支出',s.pending,'尚待會計確認','expense']].map(([label,n,note,cl])=>`<div class="stat ${cl}"><small>${label}</small><strong>$${money(n)}</strong><div class="hint">${note}</div></div>`).join('');
  $('project-stats').innerHTML=state.projects.map(p=>{
    const s=totals(state.transactions.filter(t=>String(t.projectId)===String(p.id))),budget=Number(p.budget)||0,pct=budget>0?Math.min(100,Math.round(s.expense/budget*100)):0;
    return `<div class="project-stat"><div class="line"><strong>${e(p.name)}${isClosed(p)?' · 已關帳':''}${personal?' · 您的紀錄':''}</strong><span>$${money(s.expense)} / $${money(budget)}</span></div><div class="meter ${s.expense>budget?'over':''}"><span style="width:${pct}%"></span></div><small class="hint">已付款 $${money(s.paid)} · 核准未付 $${money(s.approved)} · 待核准 $${money(s.pending)}${personal?' · 此處不代表計畫整體餘額。':' · 預算餘額 $'+money(budget-s.expense)}</small></div>`;
  }).join('')||'<p class="empty">尚無計畫。</p>';
}
function renderList(){
  const f={q:$('filter-q').value.trim(),project:$('filter-project').value,year:$('filter-year').value,status:$('filter-status').value};
  f.includeVoid=f.status==='void';
  const all=filterTransactions(state.transactions,f),p=paginate(all,state.page);state.page=p.page;
  $('list-body').innerHTML=p.rows.map(t=>{
    const st=status(t),closed=isClosed(state.projects.find(p=>String(p.id)===String(t.projectId))),role=state.user.role;
    let actions=t.type==='expense'?button('voucher',t.id,'憑證'):'';
    if(canEdit(t,state.user,state.projects))actions+=button('edit',t.id,'修改')+button('void',t.id,'作廢');
    if(!closed&&!isVoid(t)&&t.type==='expense'){
      if(['admin','accountant'].includes(role)&&!yes(t.accountantApproved)&&!yes(t.isPaid))actions+=button('approve',t.id,'核准');
      if(['admin','accountant'].includes(role)&&yes(t.accountantApproved)&&!yes(t.isPaid))actions+=button('unapprove',t.id,'撤回核准');
      if(['admin','treasurer'].includes(role)&&yes(t.accountantApproved)&&!yes(t.isPaid))actions+=button('pay',t.id,'登記付款');
    }
    const bank=t.type==='expense'&&role!=='viewer'?`<small class="bank">受款人 ${e(t.payee||'—')}｜${e(t.bankCode||'—')} ${e(t.bankAccount||'—')}</small>`:'';
    const details=st==='paid'?`<small>付款 ${e(day(t.paymentDate)||'日期待補')} · ${e(t.paidBy||'舊資料')}</small>`:st==='void'?`<small>原因：${e(t.voidReason)}</small>`:'';
    return `<tr><td><small>${e(day(t.date))} · ${e(projectName(t.projectId))}</small><strong>${e(t.summary)}</strong><small>${e(t.category)} · ${e(t.id)}</small>${bank}</td><td><div class="amount ${t.type==='income'?'income':'expense'}">${t.type==='income'?'+':'−'}$${money(t.amount)}</div><span class="badge ${st}">${e(statusNames[st])}</span>${closed?'<span class="badge">已關帳</span>':''}${details}</td><td><div class="actions">${actions||'<span class="hint">唯讀</span>'}</div></td></tr>`;
  }).join('')||'<tr><td colspan="3" class="empty">沒有符合條件的紀錄。</td></tr>';
  $('page-info').textContent=`第 ${p.page} / ${p.pages} 頁 · ${all.length} 筆`;$('prev-page').disabled=p.page<=1;$('next-page').disabled=p.page>=p.pages;
}
function renderProjects(){
  $('projects-list').innerHTML=state.projects.map(p=>`<div class="card project-card ${isClosed(p)?'closed':''}"><div><h2>${e(p.name)}</h2><div class="meta">${e(p.id)} · ${e(p.funder||'')} ${isClosed(p)?'· 已關帳':''}</div></div><div><strong>預算 $${money(p.budget)}</strong><div class="actions">${['admin','accountant'].includes(state.user.role)?button(isClosed(p)?'reopen':'close',p.id,isClosed(p)?'重啟計畫':'關帳'):''}</div></div></div>`).join('')||'<div class="card empty">尚無計畫。</div>';
}
function render(){updateSelectors();renderDashboard();renderList();renderProjects();}
function resetEntry(){entry.reset();entry.elements.date.value=today();entry.elements.id.value='';entry.elements.version.value='';$('entry-title').textContent='新增紀錄';$('save').textContent='儲存紀錄';if(state.user)updateSelectors();}
function clearSession(){epoch++;firebaseUser=null;pending=null;reasonAction=null;currentDocument=null;state={user:null,transactions:[],projects:[],categories:[],page:1};
  document.querySelectorAll('dialog').forEach(d=>d.close());for(const id of ['stats','project-stats','list-body','projects-list','print-content'])$(id).replaceChildren();$('print-root')?.replaceChildren();
  entry.reset();$('payment-form').reset();$('reason-form').reset();$('report-form').reset();
  $('workspace').hidden=true;$('login-panel').hidden=false;$('logout').hidden=true;$('refresh').hidden=true;$('retry-panel').hidden=true;$('user-name').textContent='尚未登入';
  $('filter-q').value='';$('filter-status').value='';for(const id of ['dashboard-year','filter-year','filter-project'])$(id).replaceChildren();loading(false);
}
async function loadData(){const owner=firebaseUser,session=epoch;const r=await callApi(owner,'read');if(session!==epoch||owner!==firebaseUser)return;
  state.user=r.currentUser;state.transactions=r.transactions;state.projects=r.projects;state.categories=r.categories;render();
  $('user-name').textContent=`${state.user.name} · ${{admin:'管理者',accountant:'會計',treasurer:'出納',user:'經辦人',viewer:'查閱者'}[state.user.role]}`;
  $('workspace').hidden=false;$('login-panel').hidden=true;$('logout').hidden=false;$('refresh').hidden=false;
}
function merge(result){if(result.transaction){const i=state.transactions.findIndex(t=>t.id===result.transaction.id);if(i<0)state.transactions.push(result.transaction);else state.transactions[i]=result.transaction;}
  if(result.project){const i=state.projects.findIndex(p=>p.id===result.project.id);if(i>=0)state.projects[i]=result.project;}render();}
async function mutate(action,data,retry=false){
  if(busy)return false;
  if(pending&&!retry){message('上一筆操作結果尚未確認，請先按「重試上一筆操作」。',true);return false;}
  const op=retry?pending:{action,data,requestId:requestId()},session=epoch;
  loading(true);
  try {const r=await callApi(firebaseUser,op.action,op.data,op.requestId);if(session!==epoch)return false;
    pending=null;$('retry-panel').hidden=true;
    try {merge(r);message('資料已儲存，操作紀錄已同步建立。');}
    catch(displayError){message('資料已儲存，但其他資料的顯示需要修正：'+displayError.message,true);}
    return r;
  } catch(err){if(session!==epoch)return false;
    if(['NETWORK','WRITE_UNCERTAIN'].includes(err.code)){pending=op;$('retry-panel').hidden=false;}
    else if(retry){pending=null;$('retry-panel').hidden=true;}
    if(err.code==='CONFLICT'){pending=null;$('retry-panel').hidden=true;try{await loadData();}catch{}}
    message(err.message,true);return false;
  } finally {if(session===epoch)loading(false);}
}
const retryPanel=document.createElement('div');retryPanel.id='retry-panel';retryPanel.className='card';retryPanel.hidden=true;
retryPanel.innerHTML='<strong>上一筆操作結果尚未確認。</strong><p class="hint">請以相同操作編號重新確認；確認完成前，其他寫入會暫停。重新整理頁面前請先處理此操作。</p><button id="retry-operation" class="primary">重新確認上一筆操作</button>';$('workspace').prepend(retryPanel);
$('retry-operation').addEventListener('click',async()=>{const r=await mutate(null,null,true);if(r){resetEntry();$('payment-dialog').close();$('reason-dialog').close();reasonAction=null;}});
window.addEventListener('beforeunload',event=>{if(pending){event.preventDefault();event.returnValue='';}});
document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>showTab(btn.dataset.tab)));
document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>$(btn.dataset.close).close()));
$('dashboard-year').addEventListener('change',()=>{try{renderDashboard();}catch(err){message(err.message,true);}});
for(const id of ['filter-q','filter-year','filter-project','filter-status'])$(id).addEventListener(id==='filter-q'?'input':'change',()=>{state.page=1;renderList();});
$('prev-page').addEventListener('click',()=>{state.page--;renderList();});$('next-page').addEventListener('click',()=>{state.page++;renderList();});
entry.elements.type.addEventListener('change',updateCategories);$('cancel-edit').addEventListener('click',()=>{if(pending){message('請先確認上一筆操作。',true);return;}resetEntry();});
entry.addEventListener('submit',async event=>{event.preventDefault();if(!state.user)return;const d=Object.fromEntries(new FormData(entry));const action=d.id?'edit':'add';if(!d.id){delete d.id;delete d.version;}else d.version=Number(d.version);d.amount=Number(d.amount);
  const r=await mutate(action,d);if(r){resetEntry();if(action==='add'&&r.transaction?.type==='expense')preview(voucherHtml(r.transaction,state.projects));}});
$('refresh').addEventListener('click',async()=>{if(busy)return;loading(true);try{await loadData();message('資料已重新整理。');}catch(err){message(err.message,true);}finally{loading(false);}});
function askReason(action,data,title){reasonAction={action,data};$('reason-title').textContent=title;$('reason-form').reset();$('reason-dialog').showModal();}
document.addEventListener('click',async event=>{const btn=event.target.closest('[data-action]');if(!btn||busy||!state.user)return;
  const {action,id}=btn.dataset;
  try{
    if(['close','reopen'].includes(action)){const p=state.projects.find(p=>p.id===id);askReason('updateProjectStatus',{id,version:p.version,status:action==='close'?'CLOSED':'OPEN'},action==='close'?'計畫關帳原因':'計畫重啟原因');return;}
    const t=state.transactions.find(t=>t.id===id);if(!t)throw new Error('找不到資料，請重新整理。');
    if(action==='voucher'){preview(voucherHtml(t,state.projects));return;}
    if(action==='edit'){if(pending)throw new Error('請先確認上一筆操作。');if(!canEdit(t,state.user,state.projects))throw new Error('此筆資料無法修改。');
      resetEntry();for(const key of ['id','version','date','amount','type','projectId','payee','bankCode','bankAccount','summary','note'])entry.elements[key].value=key==='date'?day(t[key]):t[key]??'';
      updateCategories();entry.elements.category.value=t.category;$('entry-title').textContent='修改紀錄';$('save').textContent='更新紀錄';showTab('entry');return;}
    if(action==='void'||action==='unapprove'){askReason(action,{id,version:t.version},action==='void'?'作廢原因':'撤回核准原因');return;}
    if(action==='approve'){if(confirm(`核准「${t.summary}」$${money(t.amount)}？`))await mutate('approve',{id,version:t.version});return;}
    if(action==='pay'){const form=$('payment-form');form.reset();form.elements.id.value=id;form.elements.version.value=t.version;form.elements.paymentDate.value=today();form.elements.paymentDate.max=today();form.elements.paymentReference.required=true;$('payment-dialog').showModal();}
  }catch(err){message(err.message,true);}
});
$('reason-form').addEventListener('submit',async event=>{event.preventDefault();if(!reasonAction)return;const r=await mutate(reasonAction.action,{...reasonAction.data,reason:$('reason-form').elements.reason.value});if(r){$('reason-dialog').close();reasonAction=null;}});
$('payment-form').elements.paymentMethod.addEventListener('change',()=>{$('payment-form').elements.paymentReference.required=$('payment-form').elements.paymentMethod.value!=='cash';});
$('payment-form').addEventListener('submit',async event=>{event.preventDefault();const d=Object.fromEntries(new FormData($('payment-form')));d.version=Number(d.version);const r=await mutate('pay',d);if(r)$('payment-dialog').close();});
function preview(doc){currentDocument=doc;$('print-content').innerHTML=doc.html;$('print-content').className='paper'+(doc.landscape?' landscape':'');if(!$('preview-dialog').open)$('preview-dialog').showModal();}
$('report-open').addEventListener('click',()=>{const form=$('report-form');options(form.elements.project,state.projects,{all:'全部計畫'});options(form.elements.year,years().map(id=>({id,name:id+' 年'})),{defaultValue:today().slice(0,4)});form.elements.month.innerHTML='<option value="">全年度</option>'+Array.from({length:12},(_,i)=>`<option value="${String(i+1).padStart(2,'0')}">${i+1} 月</option>`).join('');$('report-dialog').showModal();});
$('report-form').addEventListener('submit',event=>{event.preventDefault();try{const f=Object.fromEntries(new FormData($('report-form')));f.personal=state.user.role==='user';preview(reportHtml(state.transactions,state.projects,f));$('report-dialog').close();}catch(err){message(err.message,true);}});
function preparePrint(){if(!currentDocument)return;let root=$('print-root');if(!root){root=document.createElement('div');root.id='print-root';root.hidden=true;document.body.append(root);}root.innerHTML=`<div class="paper${currentDocument.landscape?' landscape':''}">${currentDocument.html}</div>`;
  let style=$('print-orientation');if(!style){style=document.createElement('style');style.id='print-orientation';document.head.append(style);}style.textContent=`@media print{@page{size:A4 ${currentDocument.landscape?'landscape':'portrait'};margin:10mm}}`;}
$('print-document').addEventListener('click',()=>{preparePrint();window.print();});
window.addEventListener('beforeprint',preparePrint);
window.addEventListener('afterprint',()=>{$('print-root')?.replaceChildren();});
let pdfLoad;
async function ensurePdf(){if(window.html2pdf)return;if(!pdfLoad)pdfLoad=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';s.onload=resolve;s.onerror=()=>{pdfLoad=null;s.remove();reject(new Error('PDF 套件無法載入，請使用「列印／另存 PDF」。'));};document.head.append(s);});await pdfLoad;}
$('download-pdf').addEventListener('click',async()=>{if(busy||!currentDocument)return;loading(true);try{await ensurePdf();await document.fonts.ready;
  await window.html2pdf().set({margin:5,filename:currentDocument.filename,image:{type:'jpeg',quality:.98},html2canvas:{scale:2,useCORS:true},jsPDF:{unit:'mm',format:'a4',orientation:currentDocument.landscape?'landscape':'portrait'},pagebreak:{mode:['css','legacy'],avoid:['tr','.signature']}}).from($('print-content')).save();message('PDF 已產生。');
}catch(err){message(err.message,true);}finally{loading(false);}});
$('login').addEventListener('click',async()=>{if(!auth||busy)return;try{assertConfigured();loading(true);const {GoogleAuthProvider,signInWithPopup}=await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js');await signInWithPopup(auth,new GoogleAuthProvider());}catch(err){message(err.message,true);loading(false);}});
$('logout').addEventListener('click',async()=>{if(pending&&!confirm('上一筆操作結果尚未確認。建議先重試完成；仍要登出嗎？'))return;try{const {signOut}=await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js');await signOut(auth);clearSession();}catch(err){message('登出失敗：'+err.message,true);}});
async function init(){try{
  const [{initializeApp},{getAuth,onAuthStateChanged,signOut}]=await Promise.all([import('https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js'),import('https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js')]);
  auth=getAuth(initializeApp(config.firebase));
  $('login').disabled=false;
  onAuthStateChanged(auth,async user=>{clearSession();if(!user)return;const email=String(user.email||'').toLowerCase();if(email.split('@')[1]!==config.allowedDomain){await signOut(auth);message('請使用協會網域帳號。',true);return;}
    firebaseUser=user;const session=epoch;loading(true);try{await loadData();if(session===epoch){resetEntry();showTab('dashboard');}}catch(err){if(session===epoch){$('login-message').textContent=err.message;message(err.message,true);}}finally{if(session===epoch)loading(false);}
  });
  try{assertConfigured();}catch(err){$('login-message').textContent=err.message;}
}catch(err){$('login-message').textContent='登入服務載入失敗，請檢查網路後重新整理。';message('登入服務載入失敗。',true);}}
init();
