export const yes = v => String(v).toUpperCase() === 'TRUE';
export const isVoid = t => String(t.recordStatus).toUpperCase() === 'VOID';
export const isClosed = p => String(p?.status).toUpperCase() === 'CLOSED' || yes(p?.isClosed);
export const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const day = v => String(v || '').slice(0, 10);
export const today = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const money = v => Number.isFinite(Number(v)) ? Number(v).toLocaleString('zh-TW') : '—';
export function amount(t) {
  const n = Number(t.amount);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`交易 ${t.id} 的金額無效，請先修正資料。`);
  return n;
}
export function status(t) {
  return isVoid(t) ? 'void' : t.type === 'income' ? 'income' : yes(t.isPaid) ? 'paid' : yes(t.accountantApproved) ? 'approved' : 'pending';
}
export const statusNames = {void:'已作廢',income:'收入紀錄',paid:'已付款',approved:'核准待付款',pending:'待核准'};
export function canEdit(t, user, projects) {
  return user && user.role !== 'viewer' && !isVoid(t) && !yes(t.isPaid) && !yes(t.accountantApproved) &&
    !isClosed(projects.find(p => String(p.id) === String(t.projectId))) &&
    (['admin','accountant'].includes(user.role) || String(t.createdBy).toLowerCase() === user.id);
}
export function filterTransactions(txs, f = {}) {
  return txs.filter(t => {
    const d = f.basis === 'paid' && t.type === 'expense' ? day(t.paymentDate) : day(t.date);
    if (!f.includeVoid && isVoid(t)) return false;
    if (f.basis === 'paid' && t.type === 'expense' && !yes(t.isPaid)) return false;
    if (f.project && String(t.projectId) !== String(f.project)) return false;
    if (f.year && !d.startsWith(String(f.year) + '-')) return false;
    if (f.month && !d.startsWith(f.month)) return false;
    if (f.from && d < f.from || f.to && d > f.to) return false;
    if (f.status && status(t) !== f.status) return false;
    if (f.q && ![t.summary,t.payee,t.note,t.id,t.category].some(v => String(v || '').toLowerCase().includes(f.q.toLowerCase()))) return false;
    return true;
  }).sort((a,b) => day(b.date).localeCompare(day(a.date)) || String(b.id).localeCompare(String(a.id)));
}
export function totals(txs) {
  const out = {income:0,expense:0,paid:0,approved:0,pending:0};
  for (const t of txs) {
    if(isVoid(t)) continue;
    const n = amount(t);
    if(t.type==='income') out.income += n;
    else if(t.type==='expense') {out.expense += n; out[yes(t.isPaid)?'paid':yes(t.accountantApproved)?'approved':'pending'] += n;}
    else throw new Error(`交易 ${t.id} 的收支類別無效。`);
  }
  return out;
}
export function ledger(txs) {
  const map = new Map();
  for (const t of txs) {
    if (isVoid(t)) continue;
    if(!['income','expense'].includes(t.type)) throw new Error('收支類別無效。');
    if (!map.has(t.category)) map.set(t.category, {category:t.category,income:0,expense:0,transactions:[]});
    const row=map.get(t.category);row[t.type]+=amount(t);row.transactions.push(t);
  }
  return [...map.values()].map(r=>({...r,net:r.income-r.expense}));
}
export function paginate(rows, page, size=15) {
  const pages=Math.max(1,Math.ceil(rows.length/size)), current=Math.min(Math.max(1,page),pages);
  return {page:current,pages,rows:rows.slice((current-1)*size,current*size)};
}
