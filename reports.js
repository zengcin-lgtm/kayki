import {e,day,money,totals,ledger,status,statusNames,filterTransactions,yes,isVoid} from './domain.js';
const projectName=(id,projects)=>projects.find(p=>String(p.id)===String(id))?.name||id;
const signatures=(labels=['理事長','總幹事','會計','出納'])=>`<table class="signature"><thead><tr>${labels.map(l=>`<th>${e(l)}</th>`).join('')}</tr></thead><tbody><tr>${labels.map(()=>'<td></td>').join('')}</tr></tbody></table>`;
export function reportHtml(transactions,projects,f) {
  if(!/^\d{4}$/.test(String(f.year))) throw new Error('請選擇報表年度。');
  const rows=filterTransactions(transactions,{year:f.year,month:f.month?`${f.year}-${f.month}`:'',project:f.project,basis:f.basis}).reverse();
  const title={journal:'日記帳',ledger:'分類帳',monthly:'收支彙總表'}[f.reportType];
  if(!title) throw new Error('報表類型無效。');
  const sums=totals(rows), range=`${f.year} 年${f.month?' '+Number(f.month)+' 月':'全年度'}`;
  let html=`<h1>花蓮縣ʼonanip文教協會</h1><h2>${e(title)}</h2><p>範圍：${e(f.project?projectName(f.project,projects):'全部計畫')}｜期間：${e(range)}</p>`;
  if(f.personal) html+='<p class="report-note">資料範圍：僅包含本帳號建立的交易，不代表協會或計畫全部收支。</p>';
  html+=`<p class="report-note">統計口徑：${f.basis==='paid'?'收入依登錄日期；支出僅含已付款，依付款日期。':'依交易登錄日期，包含待核准與尚未付款支出。'} 作廢紀錄不計入。</p>`;
  if(f.basis==='paid') {
    const missing=transactions.filter(t=>!isVoid(t)&&t.type==='expense'&&yes(t.isPaid)&&!day(t.paymentDate)&&(!f.project||String(t.projectId)===String(f.project)));
    if(missing.length) html+=`<p class="report-note">注意：選定計畫範圍共有 ${missing.length} 筆已付款資料缺少付款日期，未納入本報表。請先於副本補齊舊資料，再重新產出。</p>`;
  }
  if(!rows.length) html+='<p>此期間查無符合資料。</p>';
  else if(f.reportType==='journal') {
    html+='<table><thead><tr><th>日期</th><th>計畫／科目</th><th>摘要／編號</th><th>狀態</th><th>收入</th><th>支出</th></tr></thead><tbody>';
    html+=rows.map(t=>`<tr><td>${e(f.basis==='paid'&&t.type==='expense'?day(t.paymentDate):day(t.date))}</td><td>${e(projectName(t.projectId,projects))}<br>${e(t.category)}</td><td>${e(t.summary)}<br><small>${e(t.id)}</small></td><td>${e(statusNames[status(t)])}</td><td class="num">${t.type==='income'?money(t.amount):''}</td><td class="num">${t.type==='expense'?money(t.amount):''}</td></tr>`).join('');
    html+=`<tr><th colspan="4">合計</th><td class="num">${money(sums.income)}</td><td class="num">${money(sums.expense)}</td></tr></tbody></table>`;
  } else if(f.reportType==='ledger') {
    for(const group of ledger(rows)) {
      html+=`<h3>${e(group.category)}</h3><table><thead><tr><th>日期</th><th>摘要</th><th>計畫</th><th>收入</th><th>支出</th></tr></thead><tbody>`;
      html+=group.transactions.map(t=>`<tr><td>${e(f.basis==='paid'&&t.type==='expense'?day(t.paymentDate):day(t.date))}</td><td>${e(t.summary)}</td><td>${e(projectName(t.projectId,projects))}</td><td class="num">${t.type==='income'?money(t.amount):''}</td><td class="num">${t.type==='expense'?money(t.amount):''}</td></tr>`).join('');
      html+=`<tr><th colspan="3">小計（收支差額 ${money(group.net)}）</th><td class="num">${money(group.income)}</td><td class="num">${money(group.expense)}</td></tr></tbody></table>`;
    }
  } else {
    html+='<table><thead><tr><th>科目</th><th>收入</th><th>支出</th><th>收支差額</th></tr></thead><tbody>';
    html+=ledger(rows).map(g=>`<tr><td>${e(g.category)}</td><td class="num">${money(g.income)}</td><td class="num">${money(g.expense)}</td><td class="num">${money(g.net)}</td></tr>`).join('');
    html+=`<tr><th>合計</th><td class="num">${money(sums.income)}</td><td class="num">${money(sums.expense)}</td><td class="num">${money(sums.income-sums.expense)}</td></tr></tbody></table>`;
  }
  html+=`<p>本期收支差額：新臺幣 ${money(sums.income-sums.expense)} 元（非帳戶餘額）</p>`;
  html+=signatures();
  return {html,landscape:f.reportType==='ledger',filename:`onanip_${f.reportType}_${f.year}${f.month?'_'+f.month:''}.pdf`,count:rows.length};
}
export function voucherHtml(t,projects) {
  if(t.type!=='expense') throw new Error('收入紀錄不使用支出憑證。');
  return {landscape:false,filename:`onanip_voucher_${t.id}.pdf`,html:`<h1>花蓮縣ʼonanip文教協會</h1><h2>支用單據黏貼憑證用紙</h2><p>編號：${e(t.id)}｜狀態：${e(statusNames[status(t)])}</p><table><tbody><tr><th>計畫名稱</th><td colspan="3">${e(projectName(t.projectId,projects))}</td></tr><tr><th>日期</th><td>${e(day(t.date))}</td><th>科目</th><td>${e(t.category)}</td></tr><tr><th>受款人</th><td>${e(t.payee)}</td><th>金額</th><td class="num">新臺幣 ${money(t.amount)} 元</td></tr><tr><th>銀行代碼</th><td>${e(t.bankCode)}</td><th>銀行帳號</th><td>${e(t.bankAccount)}</td></tr><tr><th>摘要</th><td colspan="3">${e(t.summary)}</td></tr><tr><th>備註</th><td colspan="3">${e(t.note)}</td></tr></tbody></table><div class="attachment">憑證黏貼處</div>${signatures(['理事長','總幹事','會計','驗收證明','經辦人'])}`};
}
