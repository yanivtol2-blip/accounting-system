// The web app: a small hash-routed single page, no build step.

// ---------- helpers ----------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const $app = document.getElementById('app');

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function api(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') {
    state.user = null;
    go('#/login');
  }
  if (!res.ok) throw new ApiError(data.error || 'שגיאה', res.status, data);
  return data;
}
const get = (url) => api('GET', url);
const post = (url, body = {}) => api('POST', url, body);
const patch = (url, body = {}) => api('PATCH', url, body);

function toast(message, kind = '') {
  const el = h('div', { class: `toast ${kind}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500);
}
const fail = (err) => toast(err.message || 'שגיאה', 'error');

const fmtMoney = (agorot) =>
  agorot == null ? '' : (agorot / 100).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (agorot) => h('span', { class: 'num' }, fmtMoney(agorot));
const shekelsInput = (agorot) => (agorot == null ? '' : (agorot / 100).toFixed(2));
const fmtDate = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '');
const fmtStamp = (sqlDate) => {
  if (!sqlDate) return '';
  const d = new Date(`${sqlDate.replace(' ', 'T')}Z`);
  return d.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

let meta = null;
const state = { user: null, queueCount: null };
let cleanup = [];
function onLeave(fn) {
  cleanup.push(fn);
}
function every(ms, fn) {
  const t = setInterval(() => {
    if (!document.hidden) fn();
  }, ms);
  onLeave(() => clearInterval(t));
}

function stamp(status, big = false) {
  const label = meta?.statusLabels?.[status] || status;
  return h('span', { class: `stamp s-${status}${big ? ' big' : ''}` }, label);
}

const FLAG_LEVEL = { blocking: 'חוסם', warning: 'שימו לב', info: 'לידיעה' };
function flagChips(flags) {
  return h('div', { class: 'chips' }, (flags || []).map((f) => h('span', { class: `chip ${f.level}`, title: f.message }, FLAG_SHORT[f.code] || f.message)));
}
const FLAG_SHORT = {
  extraction_failed: 'לא נקרא אוטומטית',
  missing_fields: 'חסרים פרטים',
  bad_date: 'תאריך לא תקין',
  not_postable: 'לא לרישום',
  duplicate: 'כפולה',
  total_mismatch: 'סכומים לא תואמים',
  vat_rate: 'מע"מ לא 18%',
  allocation_missing: 'חסר מספר הקצאה',
  vat_id_invalid: 'מספר עוסק לא תקין',
  currency: 'מטבע זר',
  new_supplier: 'ספק חדש',
  no_account: 'אין סעיף',
  inactive_account: 'סעיף לא פעיל',
  no_vat_account: 'אין סעיף מע"מ',
  unbalanced: 'לא מאוזנת',
};
function flagList(flags) {
  if (!flags?.length) return h('div', { class: 'flag info', style: 'border-color:var(--primary);background:var(--primary-soft);color:var(--primary-ink)' }, 'אין סימונים. הפקודה מוכנה לאישור.');
  const order = { blocking: 0, warning: 1, info: 2 };
  return h(
    'div',
    { class: 'flags' },
    [...flags].sort((a, b) => order[a.level] - order[b.level]).map((f) => h('div', { class: `flag ${f.level}` }, h('b', {}, FLAG_LEVEL[f.level]), h('span', {}, f.message)))
  );
}

const ACCOUNT_SOURCE = {
  history: 'כמו בחשבונית הקודמת של הספק',
  model: 'הצעה אוטומטית לספק חדש, יש לבדוק',
  manual: 'נבחר ידנית',
};

const ACTION_LABELS = {
  'user.login': 'התחברות',
  'user.created': 'משתמש נוסף',
  'user.password_changed': 'סיסמה שונתה',
  'user.password_reset': 'סיסמה אופסה',
  'user.activated': 'משתמש הופעל',
  'user.deactivated': 'משתמש נחסם',
  'client.created': 'התיק נפתח',
  'document.uploaded': 'המסמך הועלה',
  'document.read': 'המסמך נקרא אוטומטית',
  'document.read_failed': 'הקריאה האוטומטית נכשלה',
  'document.corrected': 'פרטים תוקנו',
  'document.approved': 'אושר ונרשם',
  'document.returned': 'הוחזר ללקוח עם הערה',
  'document.not_for_posting': 'סומן לא לרישום',
  'document.reopened': 'חזר לבדיקה אחרי ביטול הפקודה',
  'entry.posted': 'פקודה נרשמה',
  'entry.reversed': 'פקודה בוטלה',
  'supplier.created': 'כרטיס ספק נפתח',
  'supplier.account_changed': 'סעיף ההוצאה של הספק שונה',
  'supplier.updated': 'פרטי ספק עודכנו',
  'account.created': 'סעיף נוסף לאינדקס',
  'account.updated': 'סעיף באינדקס עודכן',
};
const FIELD_LABELS = {
  supplier_name: 'ספק',
  supplier_vat_id: 'מספר עוסק',
  doc_type: 'סוג מסמך',
  doc_number: 'מספר מסמך',
  doc_date: 'תאריך',
  amount_before_vat: 'לפני מע"מ',
  vat_amount: 'מע"מ',
  total: 'סה"כ',
  allocation_number: 'מספר הקצאה',
  name: 'שם',
  vat_deduction: 'ניכוי מע"מ',
  active: 'פעיל',
  expense_account_id: 'סעיף הוצאה',
};
function auditDetails(a) {
  const d = a.details;
  if (!d) return '';
  if (a.action === 'document.corrected' || a.action === 'account.updated' || a.action === 'supplier.updated') {
    return Object.entries(d)
      .filter(([, v]) => v && typeof v === 'object' && 'to' in v)
      .map(([k, v]) => {
        const money = ['amount_before_vat', 'vat_amount', 'total'].includes(k);
        const show = (x) => (x == null ? 'ריק' : money ? fmtMoney(x) : k === 'vat_deduction' ? meta.vatDeduction[x] || x : k === 'doc_type' ? meta.docTypes[x] || x : x);
        return `${FIELD_LABELS[k] || k}: ${show(v.from)} ← ${show(v.to)}`;
      })
      .join(' · ');
  }
  if (d.note) return d.note;
  if (d.reason) return `פקודה ${d.entry_number} בוטלה בפקודה ${d.reversal_number}: ${d.reason}`;
  if (d.entry_number) return `פקודה ${d.entry_number}`;
  if (d.error) return d.error;
  if (d.name && d.account_code) return `${d.name}, כרטיס ${d.account_code}`;
  if (d.name) return d.name;
  if (d.email) return d.email;
  return '';
}

function dialog({ title, body, submitLabel, danger = false, onSubmit }) {
  const err = h('div', { class: 'note', hidden: true });
  const submit = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'submit' }, submitLabel);
  const dlg = h(
    'dialog',
    {},
    h(
      'form',
      {
        method: 'dialog',
        onsubmit: async (e) => {
          e.preventDefault();
          submit.disabled = true;
          err.hidden = true;
          try {
            await onSubmit(new FormData(e.target));
            dlg.close();
          } catch (ex) {
            err.textContent = ex.message;
            err.hidden = false;
          } finally {
            submit.disabled = false;
          }
        },
      },
      h('h2', {}, title),
      body,
      err,
      h('div', { class: 'dlg-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'ביטול'), submit)
    )
  );
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector('input, textarea, select')?.focus();
  return dlg;
}

// ---------- shell ----------

function shell(active, ...content) {
  const u = state.user;
  const staff = u.role === 'staff';
  const nav = staff
    ? h(
        'nav',
        { class: 'nav' },
        h('a', { href: '#/queue', class: active === 'queue' ? 'active' : '' }, 'תור לבדיקה', state.queueCount ? h('span', { class: 'count' }, state.queueCount) : null),
        h('a', { href: '#/clients', class: active === 'clients' ? 'active' : '' }, 'תיקי לקוחות'),
        h('a', { href: '#/users', class: active === 'users' ? 'active' : '' }, 'משתמשים')
      )
    : h('div', { class: 'grow' });
  return [
    h(
      'header',
      { class: `topbar${staff ? '' : ' topbar-client'}` },
      h(
        'div',
        { class: 'topbar-inner' },
        h('a', { class: 'brand', href: staff ? '#/queue' : '#/my' }, h('span', { class: 'brand-mark' }, logo()), h('span', { class: 'brand-text' }, staff ? 'הנהלת חשבונות' : u.client_name)),
        nav,
        h('button', { class: 'user-btn', onclick: accountMenu }, u.name)
      )
    ),
    h('main', { class: `page${staff ? '' : ' page-narrow'}` }, content),
  ];
}
function logo() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.innerHTML =
    '<path d="M6 9h20M6 16h20M6 23h11" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M20 22.5l2.4 2.4 4.4-4.8" stroke="#9FE3C6" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
  return svg;
}

function accountMenu() {
  dialog({
    title: state.user.name,
    submitLabel: 'שמירת סיסמה',
    body: h(
      'div',
      { class: 'stack-sm' },
      h('p', { class: 'muted small' }, state.user.email),
      h('button', { class: 'btn', type: 'button', onclick: logout }, 'יציאה מהמערכת'),
      h('h3', { style: 'margin-block-start:10px' }, 'החלפת סיסמה'),
      h('label', { class: 'field' }, h('span', {}, 'סיסמה נוכחית'), h('input', { class: 'input', type: 'password', name: 'current', autocomplete: 'current-password' })),
      h('label', { class: 'field' }, h('span', {}, 'סיסמה חדשה (8 תווים לפחות)'), h('input', { class: 'input', type: 'password', name: 'next', autocomplete: 'new-password', minlength: 8 }))
    ),
    onSubmit: async (fd) => {
      await post('/api/me/password', { current: fd.get('current'), next: fd.get('next') });
      toast('הסיסמה הוחלפה', 'ok');
    },
  });
}
async function logout() {
  await post('/api/logout').catch(() => {});
  state.user = null;
  document.querySelector('dialog')?.close();
  go('#/login');
}

async function refreshQueueCount() {
  if (state.user?.role !== 'staff') return;
  try {
    const q = await get('/api/queue');
    state.queueCount = q.documents.length;
    const badge = document.querySelector('.nav a[href="#/queue"]');
    if (badge) {
      badge.querySelector('.count')?.remove();
      if (state.queueCount) badge.append(h('span', { class: 'count' }, state.queueCount));
    }
  } catch {
    /* the next refresh will try again */
  }
}

// ---------- login ----------

function loginView() {
  const err = h('div', { class: 'note', hidden: true });
  const btn = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'כניסה');
  $app.replaceChildren(
    h(
      'div',
      { class: 'login' },
      h(
        'form',
        {
          class: 'card stack',
          onsubmit: async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            btn.disabled = true;
            err.hidden = true;
            try {
              await post('/api/login', { email: fd.get('email'), password: fd.get('password') });
              await boot();
            } catch (ex) {
              err.textContent = ex.message;
              err.hidden = false;
            } finally {
              btn.disabled = false;
            }
          },
        },
        h('div', {}, h('span', { class: 'brand-mark' }, logo()), h('h1', {}, 'כניסה למערכת'), h('p', { class: 'muted' }, 'הנהלת חשבונות: חשבוניות הוצאה, בדיקה ורישום')),
        h('label', { class: 'field' }, h('span', {}, 'דוא"ל'), h('input', { class: 'input ltr', type: 'email', name: 'email', required: true, autocomplete: 'username', inputmode: 'email' })),
        h('label', { class: 'field' }, h('span', {}, 'סיסמה'), h('input', { class: 'input', type: 'password', name: 'password', required: true, autocomplete: 'current-password' })),
        err,
        btn
      )
    )
  );
  $app.querySelector('input').focus();
}

// ---------- upload (client, and office on behalf of a client) ----------

const READABLE_IMAGE = /^image\/(jpeg|png|webp|heic|heif)$/;

// Phone photos are large: shrink to a sharp JPEG before sending (this also turns HEIC into JPEG where the browser can read it).
async function prepareFile(file) {
  if (!READABLE_IMAGE.test(file.type) || file.size < 600 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.(heic|heif|png|webp|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

function uploadZone({ clientId, onDone }) {
  const bar = h('i');
  const progress = h('div', { class: 'progress', hidden: true }, bar);
  const status = h('div', { class: 'hint' }, 'PDF או צילום. אפשר כמה חשבוניות בבת אחת.');
  const accept = 'application/pdf,image/*';
  const pick = h('input', { type: 'file', multiple: true, accept, hidden: true, onchange: (e) => send(e.target.files) });
  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: (e) => send(e.target.files) });
  const buttons = h(
    'div',
    { class: 'buttons' },
    h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => camera.click() }, 'צילום חשבונית'),
    h('button', { class: 'btn btn-lg', type: 'button', onclick: () => pick.click() }, 'בחירת קבצים')
  );
  const zone = h(
    'div',
    {
      class: 'upload-zone',
      ondragover: (e) => {
        e.preventDefault();
        zone.classList.add('drag');
      },
      ondragleave: () => zone.classList.remove('drag'),
      ondrop: (e) => {
        e.preventDefault();
        zone.classList.remove('drag');
        send(e.dataTransfer.files);
      },
    },
    h('h2', {}, 'העלאת חשבוניות הוצאה'),
    status,
    buttons,
    progress,
    pick,
    camera
  );

  async function send(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const bad = files.filter((f) => f.type !== 'application/pdf' && !f.type.startsWith('image/'));
    if (bad.length) return toast(`רק PDF או תמונות: ${bad.map((f) => f.name).join(', ')}`, 'error');
    buttons.hidden = true;
    progress.hidden = false;
    bar.style.inlineSize = '0';
    status.textContent = `מכין ${files.length} קבצים...`;
    const ready = await Promise.all(files.map(prepareFile));
    const fd = new FormData();
    if (clientId) fd.append('client_id', clientId);
    for (const f of ready) fd.append('files', f, f.name);
    status.textContent = `מעלה ${files.length === 1 ? 'חשבונית אחת' : `${files.length} חשבוניות`}...`;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/documents');
    xhr.setRequestHeader('X-Requested-With', 'fetch');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) bar.style.inlineSize = `${Math.round((e.loaded / e.total) * 100)}%`;
    };
    xhr.onloadend = () => {
      buttons.hidden = false;
      progress.hidden = true;
      pick.value = '';
      camera.value = '';
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status === 201) {
        status.textContent = 'התקבל. אפשר להעלות עוד.';
        toast(files.length === 1 ? 'החשבונית התקבלה' : `${files.length} חשבוניות התקבלו`, 'ok');
        onDone?.();
      } else {
        status.textContent = 'PDF או צילום. אפשר כמה חשבוניות בבת אחת.';
        toast(data.error || 'ההעלאה נכשלה. נסו שוב.', 'error');
      }
    };
    xhr.send(fd);
  }
  return zone;
}

// ---------- client: my documents ----------

function docIcon(mime) {
  return h('div', { class: 'doc-icon' }, mime === 'application/pdf' ? 'PDF' : 'IMG');
}

async function myDocumentsView() {
  const list = h('div', { class: 'doc-list' }, h('div', { class: 'loading' }, 'טוען...'));
  const strip = h('div', { class: 'summary-strip' });
  $app.replaceChildren(
    ...shell(
      'my',
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'המסמכים שלי'), h('p', { class: 'sub' }, 'מעלים חשבונית, המשרד בודק ורושם. כאן רואים איפה כל מסמך עומד.'))),
      h('div', { class: 'stack' }, uploadZone({ onDone: load }), strip, h('div', { class: 'card' }, list))
    )
  );
  let docs = [];
  async function load() {
    try {
      ({ documents: docs } = await get('/api/documents'));
    } catch (err) {
      return fail(err);
    }
    const counts = {};
    for (const d of docs) counts[d.status_label] = (counts[d.status_label] || 0) + 1;
    strip.replaceChildren(
      ...Object.entries(counts).map(([label, n]) => h('span', { class: `chip ${label === 'הוחזר עם הערה' ? 'blocking' : label === 'נרשם' ? 'ok' : 'info'}` }, `${label}: ${n}`))
    );
    if (!docs.length) {
      list.replaceChildren(h('div', { class: 'empty' }, 'עוד לא הועלו מסמכים.'));
      return;
    }
    list.replaceChildren(
      ...docs.map((d) =>
        h(
          'div',
          { class: 'doc-item' },
          docIcon(d.mime),
          h('a', { class: 'name', href: `/api/documents/${d.id}/file`, target: '_blank', rel: 'noopener' }, d.status === 'posted' && d.supplier_name ? `${d.supplier_name}, ${d.doc_number}` : d.original_name),
          stamp(d.status),
          h('div', { class: 'meta' }, `הועלה ${fmtStamp(d.created_at)}`, d.status === 'posted' && d.total != null ? [' · ', money(d.total), ' ש"ח'] : null),
          d.return_note ? h('div', { class: `note${d.status === 'not_for_posting' ? ' neutral' : ''}` }, h('b', {}, d.status === 'returned' ? 'הערה מהמשרד: ' : 'לא לרישום: '), d.return_note) : null
        )
      )
    );
  }
  await load();
  every(5000, () => {
    if (docs.some((d) => d.status === 'received' || d.status === 'processing' || d.status === 'pending_review')) load();
  });
}

// ---------- staff: the review queue ----------

async function queueView() {
  const card = h('div', { class: 'card' }, h('div', { class: 'loading' }, 'טוען...'));
  const reading = h('span', { class: 'reading-pill', hidden: true });
  const clientFilter = h('select', { class: 'input', style: 'inline-size:auto', onchange: () => draw() }, h('option', { value: '' }, 'כל התיקים'));
  $app.replaceChildren(
    ...shell(
      'queue',
      h(
        'div',
        { class: 'page-head' },
        h('div', {}, h('h1', {}, 'תור לבדיקה'), h('p', { class: 'sub' }, 'כל המסמכים שנקראו וממתינים לאישור, מכל התיקים. שום דבר לא נרשם בלי אישור.')),
        h('div', { class: 'queue-filters' }, reading, clientFilter)
      ),
      card
    )
  );
  let data = { documents: [], reading: 0 };
  async function load() {
    try {
      data = await get('/api/queue');
    } catch (err) {
      return fail(err);
    }
    state.queueCount = data.documents.length;
    const current = clientFilter.value;
    const clients = [...new Map(data.documents.map((d) => [d.client_id, d.client_name])).entries()];
    clientFilter.replaceChildren(h('option', { value: '' }, 'כל התיקים'), ...clients.map(([id, name]) => h('option', { value: id, selected: String(id) === current }, name)));
    reading.hidden = !data.reading;
    reading.textContent = `${data.reading} בקריאה אוטומטית`;
    draw();
    refreshQueueCount();
  }
  function draw() {
    const docs = data.documents.filter((d) => !clientFilter.value || String(d.client_id) === clientFilter.value);
    if (!docs.length) {
      card.replaceChildren(h('div', { class: 'empty' }, data.reading ? 'מסמכים בקריאה, הם יופיעו כאן עוד רגע.' : 'התור ריק. אין מסמכים שממתינים לבדיקה.'));
      return;
    }
    const table = h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 't stackable' },
        h('thead', {}, h('tr', {}, ['תיק', 'ספק', 'מסמך', 'תאריך', 'סה"כ', 'סעיף מוצע', 'סימונים'].map((t, i) => h('th', { class: i === 4 ? 'num' : '' }, t)))),
        h(
          'tbody',
          {},
          docs.map((d) =>
            h(
              'tr',
              { class: 'link', onclick: () => go(`#/doc/${d.id}`) },
              h('td', { 'data-label': 'תיק' }, d.client_name),
              h('td', { 'data-label': 'ספק' }, h('a', { href: `#/doc/${d.id}`, onclick: (e) => e.stopPropagation() }, d.supplier_name || d.original_name)),
              h('td', { 'data-label': 'מסמך' }, d.doc_type ? meta.docTypes[d.doc_type] : '', d.doc_number ? h('span', { class: 'muted' }, ' ', h('span', { class: 'num' }, d.doc_number)) : null),
              h('td', { 'data-label': 'תאריך', class: 'nowrap' }, fmtDate(d.doc_date)),
              h('td', { 'data-label': 'סה"כ', class: 'num' }, fmtMoney(d.total)),
              h('td', { 'data-label': 'סעיף' }, d.account ? `${d.account.code} ${d.account.name}` : h('span', { class: 'muted' }, 'לא נבחר'), d.account_source ? h('span', { class: `src ${d.account_source}` }, d.account_source === 'history' ? 'לפי ההיסטוריה של הספק' : 'הצעה, ספק חדש') : null),
              h('td', { 'data-label': 'סימונים' }, flagChips(d.flags.filter((f) => f.level !== 'info' || f.code === 'new_supplier' || f.code === 'extraction_failed')))
            )
          )
        )
      )
    );
    card.replaceChildren(table);
  }
  await load();
  every(5000, load);
}

// ---------- staff: one document beside its proposed entry ----------

async function documentView(id) {
  $app.replaceChildren(...shell('queue', h('div', { class: 'loading' }, 'טוען...')));
  let data;
  try {
    data = await get(`/api/documents/${id}`);
  } catch (err) {
    $app.querySelector('main').replaceChildren(h('div', { class: 'empty' }, err.message));
    return;
  }
  const doc = data.document;
  const editable = doc.status === 'pending_review';
  const reading = doc.status === 'received' || doc.status === 'processing';

  // the document itself
  const fileUrl = `/api/documents/${doc.id}/file`;
  const viewerBody = h('div', { class: 'viewer-body' });
  if (doc.mime === 'application/pdf') viewerBody.append(h('iframe', { src: `${fileUrl}#view=FitH&navpanes=0`, title: doc.original_name }));
  else if (/^image\/(jpeg|png|webp|gif)$/.test(doc.mime)) viewerBody.append(h('img', { src: fileUrl, alt: doc.original_name, onclick: () => viewerBody.classList.toggle('zoom') }));
  else viewerBody.append(h('div', { class: 'empty' }, 'אי אפשר להציג את הקובץ בדפדפן. ', h('a', { href: fileUrl, target: '_blank' }, 'הורדה')));
  const viewer = h(
    'div',
    { class: 'card viewer' },
    h('div', { class: 'viewer-bar' }, h('span', { class: 'name' }, doc.original_name), h('a', { href: fileUrl, target: '_blank', rel: 'noopener' }, 'פתיחה בחלון')),
    viewerBody
  );

  // the fields, the account and the entry
  const fields = {};
  const field = (key, label, input) => {
    fields[key] = input;
    input.addEventListener('input', changed);
    input.addEventListener('change', changed);
    return h('label', { class: 'field' }, h('span', {}, label), input);
  };
  const text = (key, opts = {}) => h('input', { class: `input${opts.ltr ? ' ltr' : ''}`, value: doc[key] ?? '', disabled: !editable, inputmode: opts.inputmode, dir: opts.ltr ? 'ltr' : null });
  const amount = (key) => h('input', { class: 'input num', dir: 'ltr', inputmode: 'decimal', value: shekelsInput(doc[key]), disabled: !editable });
  const typeSelect = h(
    'select',
    { class: 'input', disabled: !editable },
    h('option', { value: '' }, 'לא ידוע'),
    Object.entries(meta.docTypes).map(([k, v]) => h('option', { value: k, selected: doc.doc_type === k }, v))
  );
  const original = {
    supplier_name: doc.supplier_name ?? '',
    supplier_vat_id: doc.supplier_vat_id ?? '',
    doc_type: doc.doc_type ?? '',
    doc_number: doc.doc_number ?? '',
    doc_date: doc.doc_date ?? '',
    allocation_number: doc.allocation_number ?? '',
    amount_before_vat: shekelsInput(doc.amount_before_vat),
    vat_amount: shekelsInput(doc.vat_amount),
    total: shekelsInput(doc.total),
  };

  const accountSelect = h(
    'select',
    { class: 'input', disabled: !editable, onchange: () => changed({ account: true }) },
    h('option', { value: '' }, 'בחירת סעיף...'),
    data.accounts
      .filter((a) => a.active || a.id === data.review.expenseAccount?.id)
      .map((a) =>
        h('option', { value: a.id, selected: a.id === (doc.expense_account_id || data.review.expenseAccount?.id) }, `${a.code} ${a.name}${a.vat_deduction !== 'full' ? ` (מע"מ: ${meta.vatDeduction[a.vat_deduction]})` : ''}`)
      )
  );
  let accountTouched = false;
  const accountNote = h('span', { class: 'src' });
  const flagsBox = h('div');
  const entryBox = h('div', { class: 'entry' });
  const sumCheck = h('div', { class: 'sum-check' });
  const approveBtn = h('button', { class: 'btn btn-primary btn-lg', onclick: approve, hidden: !editable }, 'אישור ורישום');
  const why = h('div', { class: 'why', hidden: true });

  function edits() {
    const out = {};
    for (const [k, input] of Object.entries(fields)) {
      const v = input.value.trim();
      input.classList.toggle('changed', v !== original[k]);
      if (v !== original[k]) out[k] = v === '' ? null : v;
    }
    return out;
  }

  let timer = null;
  function changed(e) {
    if (e?.account) accountTouched = true;
    const n = Object.keys(edits()).length;
    approveBtn.textContent = n || accountTouched ? 'תיקון ואישור' : 'אישור ורישום';
    clearTimeout(timer);
    timer = setTimeout(preview, 250);
  }
  async function preview() {
    try {
      const { review } = await post(`/api/documents/${doc.id}/preview`, { edits: edits(), expense_account_id: accountSelect.value || null });
      drawReview(review);
    } catch (err) {
      why.textContent = err.message;
      why.hidden = false;
      approveBtn.disabled = true;
    }
  }

  function drawReview(review) {
    flagsBox.replaceChildren(editable ? flagList(review.flags) : flagList(review.flags.filter((f) => f.level === 'blocking' && f.code !== 'duplicate')));
    if (!editable) flagsBox.hidden = true;
    if (!accountTouched && review.expenseAccount && accountSelect.value !== String(review.expenseAccount.id)) accountSelect.value = review.expenseAccount.id;
    accountNote.className = `src ${review.accountSource || ''}`;
    accountNote.textContent = review.accountSource ? ACCOUNT_SOURCE[review.accountSource] : '';

    const p = review.proposal;
    entryBox.replaceChildren(
      h(
        'table',
        { class: 't' },
        h('thead', {}, h('tr', {}, h('th', {}, 'חשבון'), h('th', { class: 'num' }, 'חובה'), h('th', { class: 'num' }, 'זכות'))),
        h(
          'tbody',
          {},
          p.lines.length
            ? p.lines.map((l) =>
                h(
                  'tr',
                  {},
                  h(
                    'td',
                    { class: 'acct' },
                    l.account ? h('span', { class: l.account.id ? '' : 'new-card' }, h('span', { class: 'code' }, l.account.code), ' ', l.account.name) : h('span', { class: 'muted' }, 'לא נבחר סעיף'),
                    l.memo ? h('span', { class: 'memo' }, l.memo) : null,
                    l.side === 'debit' && l.account?.type === 'vat_input' && p.vatNonDeductible > 0 ? h('span', { class: 'memo' }, `מנוכה ${meta.vatDeduction[review.expenseAccount?.vat_deduction] || ''}`) : null
                  ),
                  h('td', { class: 'num' }, l.debit ? fmtMoney(l.debit) : ''),
                  h('td', { class: 'num' }, l.credit ? fmtMoney(l.credit) : '')
                )
              )
            : h('tr', {}, h('td', { colspan: 3, class: 'muted' }, 'אין סכומים'))
        ),
        h('tfoot', {}, h('tr', {}, h('td', {}, p.balanced ? h('span', { class: 'balance-ok' }, 'מאוזנת') : h('span', { class: 'balance-bad' }, 'לא מאוזנת')), h('td', { class: 'num' }, fmtMoney(p.debits)), h('td', { class: 'num' }, fmtMoney(p.credits))))
      )
    );

    const before = parseFloat(fields.amount_before_vat.value.replace(/,/g, ''));
    const vat = parseFloat(fields.vat_amount.value.replace(/,/g, ''));
    const total = parseFloat(fields.total.value.replace(/,/g, ''));
    if ([before, vat, total].every(Number.isFinite)) {
      const ok = Math.round((before + vat) * 100) === Math.round(total * 100);
      sumCheck.className = `sum-check ${ok ? 'good' : 'bad'}`;
      sumCheck.textContent = `${before.toFixed(2)} + ${vat.toFixed(2)} = ${(before + vat).toFixed(2)} ${ok ? '✓ תואם לסה"כ' : `≠ סה"כ ${total.toFixed(2)}`}`;
      sumCheck.dir = 'rtl';
    } else sumCheck.textContent = '';

    const blocking = review.flags.filter((f) => f.level === 'blocking');
    approveBtn.disabled = blocking.length > 0;
    why.hidden = !blocking.length || !editable;
    why.textContent = blocking.length ? `אי אפשר לאשר: ${blocking.map((f) => FLAG_SHORT[f.code] || f.message).join(', ')}` : '';
  }

  async function approve() {
    approveBtn.disabled = true;
    try {
      const r = await post(`/api/documents/${doc.id}/approve`, { edits: edits(), expense_account_id: accountSelect.value || null });
      toast(`נרשם בפקודה ${r.entryNumber}`, 'ok');
      nextInQueue();
    } catch (err) {
      fail(err);
      if (err.data?.flags) drawReview({ ...data.review, flags: err.data.flags });
      approveBtn.disabled = false;
    }
  }
  async function nextInQueue() {
    try {
      const q = await get('/api/queue');
      state.queueCount = q.documents.length;
      const next = q.documents.find((d) => d.id !== doc.id);
      go(next ? `#/doc/${next.id}` : '#/queue');
    } catch {
      go('#/queue');
    }
  }
  function returnDialog() {
    dialog({
      title: 'החזרה ללקוח עם הערה',
      submitLabel: 'החזרה ללקוח',
      danger: true,
      body: h('label', { class: 'field' }, h('span', {}, 'מה הלקוח צריך לעשות? ההערה תוצג לו ליד המסמך.'), h('textarea', { class: 'input', name: 'note', required: true, placeholder: 'למשל: חסר מספר הקצאה, נא לבקש מהספק חשבונית מתוקנת' })),
      onSubmit: async (fd) => {
        await post(`/api/documents/${doc.id}/return`, { note: fd.get('note') });
        toast('המסמך הוחזר ללקוח', 'ok');
        nextInQueue();
      },
    });
  }
  function notForPostingDialog() {
    dialog({
      title: 'סימון "לא לרישום"',
      submitLabel: 'סימון לא לרישום',
      body: h(
        'div',
        { class: 'stack-sm' },
        h('p', { class: 'muted small' }, 'נרשמות רק חשבונית מס וחשבונית מס קבלה. המסמך יישאר בתיק ולא ייכנס לספרים.'),
        h('label', { class: 'field' }, h('span', {}, 'הערה (לא חובה)'), h('textarea', { class: 'input', name: 'note', placeholder: 'למשל: קבלה בלבד, החשבונית כבר נרשמה' }))
      ),
      onSubmit: async (fd) => {
        await post(`/api/documents/${doc.id}/not-for-posting`, { note: fd.get('note') });
        toast('סומן לא לרישום', 'ok');
        nextInQueue();
      },
    });
  }
  function reverseDialog(entry) {
    dialog({
      title: `ביטול פקודה ${entry.entry_number}`,
      submitLabel: 'ביטול הפקודה',
      danger: true,
      body: h(
        'div',
        { class: 'stack-sm' },
        h('p', { class: 'muted small' }, 'פקודה רשומה לא נמחקת ולא נערכת. תיווצר פקודת ביטול הפוכה באותו תאריך, והמסמך יחזור לתור לרישום מתוקן.'),
        h('label', { class: 'field' }, h('span', {}, 'סיבת הביטול'), h('textarea', { class: 'input', name: 'reason', required: true }))
      ),
      onSubmit: async (fd) => {
        const r = await post(`/api/entries/${entry.id}/reverse`, { reason: fd.get('reason') });
        toast(`נרשמה פקודת ביטול ${r.entryNumber}. המסמך חזר לתור.`, 'ok');
        render();
      },
    });
  }

  const historyList = h('ul', { class: 'history' });
  get(`/api/documents/${doc.id}/history`)
    .then(({ history }) =>
      historyList.replaceChildren(
        ...history.map((a) => h('li', {}, h('span', { class: 'when' }, fmtStamp(a.created_at)), h('span', {}, h('b', {}, ACTION_LABELS[a.action] || a.action), a.user_name ? ` · ${a.user_name}` : ' · המערכת', auditDetails(a) ? h('span', { class: 'muted' }, ` · ${auditDetails(a)}`) : null)))
      )
    )
    .catch(() => {});

  const postedEntry = data.entry;
  const statusSection =
    doc.status === 'posted' && postedEntry
      ? h(
          'div',
          { class: 'section row' },
          h('span', {}, 'נרשם בפקודה ', h('b', {}, postedEntry.entry_number), ` מתאריך ${fmtDate(postedEntry.entry_date)}`),
          h('a', { href: `#/clients/${doc.client_id}/journal` }, 'ליומן'),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn btn-danger btn-sm', onclick: () => reverseDialog(postedEntry) }, 'ביטול הפקודה')
        )
      : doc.return_note
        ? h('div', { class: 'section' }, h('div', { class: `note${doc.status === 'not_for_posting' ? ' neutral' : ''}` }, h('b', {}, doc.status === 'returned' ? 'הוחזר ללקוח: ' : 'לא לרישום: '), doc.return_note))
        : null;
  const reversals = data.entries.filter((e) => e.kind === 'reversal');

  const form = h(
    'div',
    { class: 'card' },
    statusSection,
    reversals.length ? h('div', { class: 'section small muted' }, `בעבר: ${reversals.map((r) => `פקודה ${r.entry_number} ביטלה רישום קודם`).join(', ')}`) : null,
    reading ? h('div', { class: 'section' }, h('div', { class: 'flag info' }, h('b', {}, 'בקריאה'), h('span', {}, 'המסמך נקרא אוטומטית. הפרטים יופיעו כאן בעוד רגע.'))) : null,
    h('div', { class: 'section' }, flagsBox),
    h(
      'div',
      { class: 'section' },
      h('div', { class: 'section-title' }, h('span', {}, 'פרטי המסמך'), editable ? h('span', { class: 'muted' }, 'שדה ששונה מסומן בצהוב') : null),
      h(
        'div',
        { class: 'form-grid' },
        field('supplier_name', 'שם הספק', text('supplier_name')),
        field('supplier_vat_id', 'מספר עוסק / ח"פ', text('supplier_vat_id', { ltr: true, inputmode: 'numeric' })),
        field('doc_type', 'סוג המסמך', typeSelect),
        field('doc_number', 'מספר המסמך', text('doc_number', { ltr: true })),
        field('doc_date', 'תאריך (תאריך הרישום)', h('input', { class: 'input', type: 'date', value: doc.doc_date ?? '', disabled: !editable })),
        field('allocation_number', 'מספר הקצאה', text('allocation_number', { ltr: true, inputmode: 'numeric' })),
        field('amount_before_vat', 'סכום לפני מע"מ', amount('amount_before_vat')),
        field('vat_amount', 'מע"מ', amount('vat_amount')),
        field('total', 'סה"כ לתשלום', amount('total'))
      ),
      sumCheck
    ),
    h('div', { class: 'section' }, h('div', { class: 'section-title' }, h('span', {}, 'סעיף ההוצאה')), accountSelect, accountNote),
    h('div', { class: 'section' }, h('div', { class: 'section-title' }, h('span', {}, editable ? 'הפקודה המוצעת' : 'הפקודה')), entryBox),
    h('div', { class: 'section' }, h('div', { class: 'section-title' }, h('span', {}, 'היסטוריה')), historyList),
    editable
      ? h(
          'div',
          { class: 'actions-bar' },
          approveBtn,
          h('button', { class: 'btn btn-danger', onclick: returnDialog }, 'החזרה עם הערה'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-ghost', onclick: notForPostingDialog }, 'לא לרישום'),
          why
        )
      : null
  );

  const title = doc.supplier_name || doc.original_name;
  $app.querySelector('main').replaceChildren(
    h(
      'div',
      { class: 'review-head' },
      h('div', {}, h('a', { class: 'crumb', href: '#/queue' }, '→ חזרה לתור'), h('h1', {}, title), h('p', { class: 'muted' }, h('a', { href: `#/clients/${doc.client_id}/documents` }, data.client.name), ` · הועלה ${fmtStamp(doc.created_at)}`)),
      stamp(doc.status, true)
    ),
    h('div', { class: 'review' }, form, viewer)
  );
  drawReview(data.review);
  if (doc.status === 'posted' && postedEntry) {
    // show the entry as it was posted, not a fresh proposal
    entryBox.replaceChildren(entryTable(postedEntry));
  }
  if (reading) every(3000, async () => {
    const fresh = await get(`/api/documents/${doc.id}`).catch(() => null);
    if (fresh && fresh.document.status !== doc.status) render();
  });
}

function entryTable(entry) {
  const debits = entry.lines.reduce((s, l) => s + l.debit, 0);
  const credits = entry.lines.reduce((s, l) => s + l.credit, 0);
  return h(
    'table',
    { class: 't' },
    h('thead', {}, h('tr', {}, h('th', {}, 'חשבון'), h('th', { class: 'num' }, 'חובה'), h('th', { class: 'num' }, 'זכות'))),
    h(
      'tbody',
      {},
      entry.lines.map((l) =>
        h('tr', {}, h('td', { class: 'acct' }, h('span', { class: 'code' }, l.code), ' ', l.name, l.memo ? h('span', { class: 'memo' }, l.memo) : null), h('td', { class: 'num' }, l.debit ? fmtMoney(l.debit) : ''), h('td', { class: 'num' }, l.credit ? fmtMoney(l.credit) : ''))
      )
    ),
    h('tfoot', {}, h('tr', {}, h('td', {}), h('td', { class: 'num' }, fmtMoney(debits)), h('td', { class: 'num' }, fmtMoney(credits))))
  );
}

// ---------- staff: client files ----------

async function clientsView() {
  const grid = h('div', { class: 'client-grid' }, h('div', { class: 'loading' }, 'טוען...'));
  $app.replaceChildren(
    ...shell(
      'clients',
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'תיקי לקוחות'), h('p', { class: 'sub' }, 'כל תיק עם אינדקס חשבונות, ספקים, יומן וכרטסת משלו.')), h('button', { class: 'btn btn-primary', onclick: newClient }, 'תיק חדש')),
      grid
    )
  );
  const { clients } = await get('/api/clients');
  if (!clients.length) {
    grid.replaceChildren(h('div', { class: 'card empty' }, 'אין עדיין תיקים. פותחים תיק ראשון בכפתור "תיק חדש".'));
    return;
  }
  grid.replaceChildren(
    ...clients.map((c) =>
      h(
        'a',
        { class: 'card client-card', href: `#/clients/${c.id}/documents` },
        h('h2', {}, c.name),
        c.tax_id ? h('span', { class: 'muted small' }, 'ח"פ ', h('span', { class: 'num' }, c.tax_id)) : null,
        h('div', { class: 'counts' }, c.pending ? h('span', { class: 'chip warning' }, `${c.pending} ממתינים לבדיקה`) : null, c.reading ? h('span', { class: 'chip info' }, `${c.reading} בקריאה`) : null, h('span', { class: 'chip ok' }, `${c.documents} מסמכים`))
      )
    )
  );
}
function newClient() {
  dialog({
    title: 'תיק לקוח חדש',
    submitLabel: 'פתיחת תיק',
    body: h(
      'div',
      { class: 'stack-sm' },
      h('label', { class: 'field' }, h('span', {}, 'שם העסק'), h('input', { class: 'input', name: 'name', required: true })),
      h('label', { class: 'field' }, h('span', {}, 'ח"פ / עוסק מורשה (לא חובה)'), h('input', { class: 'input ltr', name: 'tax_id', inputmode: 'numeric' })),
      h('p', { class: 'muted small' }, 'התיק נפתח עם אינדקס חשבונות מוכן שאפשר לערוך.')
    ),
    onSubmit: async (fd) => {
      const r = await post('/api/clients', { name: fd.get('name'), tax_id: fd.get('tax_id') });
      go(`#/clients/${r.id}/users`);
    },
  });
}

const TABS = [
  ['documents', 'מסמכים'],
  ['accounts', 'אינדקס חשבונות'],
  ['suppliers', 'ספקים'],
  ['journal', 'יומן'],
  ['ledger', 'כרטסת'],
  ['users', 'משתמשי הלקוח'],
  ['audit', 'יומן פעולות'],
];

async function clientView(cid, tab, extra) {
  $app.replaceChildren(...shell('clients', h('div', { class: 'loading' }, 'טוען...')));
  let client;
  try {
    ({ client } = await get(`/api/clients/${cid}`));
  } catch (err) {
    $app.querySelector('main').replaceChildren(h('div', { class: 'empty' }, err.message));
    return;
  }
  const body = h('div', {}, h('div', { class: 'loading' }, 'טוען...'));
  $app.querySelector('main').replaceChildren(
    h('div', { class: 'page-head' }, h('div', {}, h('a', { class: 'crumb', href: '#/clients' }, '→ כל התיקים'), h('h1', {}, client.name), client.tax_id ? h('p', { class: 'sub' }, 'ח"פ ', h('span', { class: 'num' }, client.tax_id)) : null)),
    h('nav', { class: 'tabs' }, TABS.map(([k, label]) => h('a', { href: `#/clients/${cid}/${k}`, class: tab === k ? 'active' : '' }, label))),
    body
  );
  const views = { documents: clientDocsTab, accounts: accountsTab, suppliers: suppliersTab, journal: journalTab, ledger: ledgerTab, users: clientUsersTab, audit: auditTab };
  try {
    await (views[tab] || clientDocsTab)(client, body, extra);
  } catch (err) {
    body.replaceChildren(h('div', { class: 'empty' }, err.message));
  }
}

async function clientDocsTab(client, body) {
  const table = h('div', { class: 'card' }, h('div', { class: 'loading' }, 'טוען...'));
  body.replaceChildren(h('div', { class: 'stack' }, uploadZone({ clientId: client.id, onDone: load }), table));
  async function load() {
    const { documents } = await get(`/api/documents?client_id=${client.id}`);
    if (!documents.length) return table.replaceChildren(h('div', { class: 'empty' }, 'אין מסמכים בתיק.'));
    table.replaceChildren(
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 't stackable' },
          h('thead', {}, h('tr', {}, ['הועלה', 'ספק', 'מסמך', 'תאריך', 'סה"כ', 'מצב'].map((t, i) => h('th', { class: i === 4 ? 'num' : '' }, t)))),
          h(
            'tbody',
            {},
            documents.map((d) =>
              h(
                'tr',
                { class: 'link', onclick: () => go(`#/doc/${d.id}`) },
                h('td', { 'data-label': 'הועלה', class: 'nowrap' }, fmtStamp(d.created_at)),
                h('td', { 'data-label': 'ספק' }, d.supplier_name || h('span', { class: 'muted' }, d.original_name)),
                h('td', { 'data-label': 'מסמך' }, d.doc_type ? meta.docTypes[d.doc_type] : '', ' ', h('span', { class: 'num muted' }, d.doc_number || '')),
                h('td', { 'data-label': 'תאריך', class: 'nowrap' }, fmtDate(d.doc_date)),
                h('td', { 'data-label': 'סה"כ', class: 'num' }, fmtMoney(d.total)),
                h('td', { 'data-label': 'מצב' }, stamp(d.status))
              )
            )
          )
        )
      )
    );
  }
  await load();
  every(5000, load);
}

async function accountsTab(client, body) {
  const { accounts } = await get(`/api/clients/${client.id}/accounts`);
  const save = async (a, change) => {
    try {
      await patch(`/api/clients/${client.id}/accounts/${a.id}`, change);
      toast('נשמר', 'ok');
    } catch (err) {
      fail(err);
      render();
    }
  };
  const visible = accounts.filter((a) => a.type !== 'supplier');
  body.replaceChildren(
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'אינדקס חשבונות'), h('p', { class: 'muted small' }, 'שם ואחוז ניכוי המע"מ נערכים כאן ונשמרים מיד. כרטיסי ספקים נמצאים בלשונית "ספקים".')), h('button', { class: 'btn', onclick: () => newAccount(client) }, 'סעיף חדש')),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 't' },
          h('thead', {}, h('tr', {}, h('th', {}, 'מספר'), h('th', {}, 'שם הסעיף'), h('th', {}, 'סוג'), h('th', {}, 'ניכוי מע"מ'), h('th', {}, 'פעיל'), h('th', { class: 'num' }, 'יתרה'), h('th', {}))),
          h(
            'tbody',
            {},
            visible.map((a) =>
              h(
                'tr',
                {},
                h('td', { class: 'num code' }, a.code),
                h('td', {}, h('input', { class: 'inline-edit', value: a.name, onchange: (e) => save(a, { name: e.target.value }) })),
                h('td', { class: 'muted small' }, meta.accountTypes[a.type]),
                h(
                  'td',
                  {},
                  a.type === 'vat_input'
                    ? h('span', { class: 'muted small' }, 'לא רלוונטי')
                    : h('select', { class: 'inline-edit', style: 'min-inline-size:120px', onchange: (e) => save(a, { vat_deduction: e.target.value }) }, Object.entries(meta.vatDeduction).map(([k, v]) => h('option', { value: k, selected: a.vat_deduction === k }, v)))
                ),
                h('td', {}, a.type === 'vat_input' ? '' : h('input', { type: 'checkbox', checked: a.active, onchange: (e) => save(a, { active: e.target.checked }), 'aria-label': 'פעיל' })),
                h('td', { class: 'num' }, a.line_count ? fmtMoney(a.balance) : ''),
                h('td', {}, a.line_count ? h('a', { href: `#/clients/${client.id}/ledger/${a.id}` }, 'כרטסת') : null)
              )
            )
          )
        )
      )
    )
  );
}
function newAccount(client) {
  dialog({
    title: 'סעיף חדש באינדקס',
    submitLabel: 'הוספה',
    body: h(
      'div',
      { class: 'stack-sm' },
      h('label', { class: 'field' }, h('span', {}, 'מספר סעיף'), h('input', { class: 'input ltr', name: 'code', required: true, inputmode: 'numeric', pattern: '\\d{2,8}' })),
      h('label', { class: 'field' }, h('span', {}, 'שם'), h('input', { class: 'input', name: 'name', required: true })),
      h('label', { class: 'field' }, h('span', {}, 'סוג'), h('select', { class: 'input', name: 'type' }, h('option', { value: 'expense' }, 'הוצאה'), h('option', { value: 'asset' }, 'רכוש קבוע'), h('option', { value: 'liability' }, 'התחייבות'))),
      h('label', { class: 'field' }, h('span', {}, 'ניכוי מע"מ'), h('select', { class: 'input', name: 'vat_deduction' }, Object.entries(meta.vatDeduction).map(([k, v]) => h('option', { value: k }, v))))
    ),
    onSubmit: async (fd) => {
      await post(`/api/clients/${client.id}/accounts`, Object.fromEntries(fd));
      toast('הסעיף נוסף', 'ok');
      render();
    },
  });
}

async function suppliersTab(client, body) {
  const [{ suppliers }, { accounts }] = await Promise.all([get(`/api/clients/${client.id}/suppliers`), get(`/api/clients/${client.id}/accounts`)]);
  const expenseAccounts = accounts.filter((a) => (a.type === 'expense' || a.type === 'asset') && a.active);
  const save = async (s, change) => {
    try {
      await patch(`/api/clients/${client.id}/suppliers/${s.id}`, change);
      toast('נשמר. החשבונית הבאה של הספק תקבל את הסעיף הזה.', 'ok');
    } catch (err) {
      fail(err);
      render();
    }
  };
  body.replaceChildren(
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'כרטיסי ספקים'), h('p', { class: 'muted small' }, 'ספק מזוהה לפי מספר העוסק. כרטיס נפתח עם אישור החשבונית הראשונה שלו.'))),
      suppliers.length
        ? h(
            'div',
            { class: 'table-wrap' },
            h(
              'table',
              { class: 't' },
              h('thead', {}, h('tr', {}, h('th', {}, 'כרטיס'), h('th', {}, 'שם הספק'), h('th', {}, 'מספר עוסק'), h('th', {}, 'סעיף הוצאה קבוע'), h('th', { class: 'num' }, 'חשבוניות'), h('th', { class: 'num' }, 'יתרה (זכות)'), h('th', {}))),
              h(
                'tbody',
                {},
                suppliers.map((s) =>
                  h(
                    'tr',
                    {},
                    h('td', { class: 'num code' }, s.account_code),
                    h('td', {}, h('input', { class: 'inline-edit', value: s.name, onchange: (e) => save(s, { name: e.target.value }) })),
                    h('td', { class: 'num' }, s.vat_id),
                    h('td', {}, h('select', { class: 'inline-edit', onchange: (e) => save(s, { expense_account_id: e.target.value }) }, expenseAccounts.map((a) => h('option', { value: a.id, selected: a.id === s.expense_account_id }, `${a.code} ${a.name}`)))),
                    h('td', { class: 'num' }, s.posted_count),
                    h('td', { class: 'num' }, fmtMoney(s.balance)),
                    h('td', {}, h('a', { href: `#/clients/${client.id}/ledger/${s.account_id}` }, 'כרטסת'))
                  )
                )
              )
            )
          )
        : h('div', { class: 'empty' }, 'עוד אין ספקים. הם נוספים כשמאשרים חשבונית.')
    )
  );
}

function dateRange(onChange, init = {}) {
  const from = h('input', { class: 'input', type: 'date', value: init.from || '' });
  const to = h('input', { class: 'input', type: 'date', value: init.to || '' });
  const el = h('div', { class: 'form-inline' }, h('label', { class: 'field' }, h('span', {}, 'מתאריך'), from), h('label', { class: 'field' }, h('span', {}, 'עד תאריך'), to));
  from.addEventListener('change', () => onChange({ from: from.value, to: to.value }));
  to.addEventListener('change', () => onChange({ from: from.value, to: to.value }));
  return el;
}
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();

async function journalTab(client, body) {
  const list = h('div', {});
  body.replaceChildren(h('div', { class: 'stack' }, h('div', { class: 'card card-pad' }, dateRange(load)), list));
  async function load(range = {}) {
    const { entries } = await get(`/api/clients/${client.id}/journal?${qs(range)}`);
    if (!entries.length) return list.replaceChildren(h('div', { class: 'card empty' }, 'אין פקודות בתקופה.'));
    list.replaceChildren(
      ...entries.map((e) =>
        h(
          'div',
          { class: 'journal-entry' },
          h(
            'div',
            { class: 'je-head' },
            h('span', { class: 'je-no' }, `פקודה ${e.entry_number}`),
            h('span', { class: 'nowrap' }, fmtDate(e.entry_date)),
            h('span', { class: 'grow' }, e.description),
            e.kind === 'reversal' ? h('span', { class: 'je-tag rev' }, `מבטלת את ${e.reverses_number}`) : null,
            e.reversed_by_number ? h('span', { class: 'je-tag gone' }, `בוטלה בפקודה ${e.reversed_by_number}`) : null,
            h('span', { class: 'muted small' }, `${e.created_by_name} · ${fmtStamp(e.created_at)}`),
            e.document_id ? h('a', { href: `#/doc/${e.document_id}`, class: 'small' }, 'המסמך') : null,
            e.kind === 'invoice' && !e.reversed_by_number ? h('button', { class: 'btn btn-danger btn-sm', onclick: () => reverse(e) }, 'ביטול') : null
          ),
          entryTable(e)
        )
      )
    );
  }
  function reverse(entry) {
    dialog({
      title: `ביטול פקודה ${entry.entry_number}`,
      submitLabel: 'ביטול הפקודה',
      danger: true,
      body: h(
        'div',
        { class: 'stack-sm' },
        h('p', { class: 'muted small' }, 'פקודה רשומה לא נמחקת ולא נערכת. תיווצר פקודת ביטול הפוכה באותו תאריך, והמסמך יחזור לתור לרישום מתוקן.'),
        h('label', { class: 'field' }, h('span', {}, 'סיבת הביטול'), h('textarea', { class: 'input', name: 'reason', required: true }))
      ),
      onSubmit: async (fd) => {
        const r = await post(`/api/entries/${entry.id}/reverse`, { reason: fd.get('reason') });
        toast(`נרשמה פקודת ביטול ${r.entryNumber}. המסמך חזר לתור.`, 'ok');
        load();
      },
    });
  }
  await load();
}

async function ledgerTab(client, body, accountId) {
  const { accounts } = await get(`/api/clients/${client.id}/accounts`);
  const withLines = accounts.filter((a) => a.line_count > 0);
  const pick = h(
    'select',
    { class: 'input', onchange: (e) => go(`#/clients/${client.id}/ledger/${e.target.value}`) },
    h('option', { value: '' }, 'בחירת כרטיס...'),
    h('optgroup', { label: 'כרטיסים עם תנועות' }, withLines.map((a) => h('option', { value: a.id, selected: String(a.id) === accountId }, `${a.code} ${a.name}`))),
    h('optgroup', { label: 'כל הכרטיסים' }, accounts.filter((a) => !a.line_count).map((a) => h('option', { value: a.id, selected: String(a.id) === accountId }, `${a.code} ${a.name}`)))
  );
  const card = h('div', { class: 'card' });
  let range = {};
  body.replaceChildren(
    h('div', { class: 'stack' }, h('div', { class: 'card card-pad form-inline' }, h('label', { class: 'field', style: 'flex:2 1 260px' }, h('span', {}, 'כרטיס'), pick), Object.assign(dateRange((r) => ((range = r), load())), { style: 'display:contents' })), card)
  );
  async function load() {
    if (!accountId) return card.replaceChildren(h('div', { class: 'empty' }, 'בוחרים כרטיס כדי לראות את התנועות והיתרה.'));
    const l = await get(`/api/clients/${client.id}/ledger/${accountId}?${qs(range)}`);
    const credit = l.account.type === 'supplier' || l.account.type === 'liability';
    const bal = (b) => (credit ? `${fmtMoney(-b)}` : fmtMoney(b));
    card.replaceChildren(
      h('div', { class: 'card-head' }, h('h2', {}, h('span', { class: 'num code' }, l.account.code), ' ', l.account.name), h('span', { class: 'muted small' }, credit ? 'יתרה בזכות' : 'יתרה בחובה')),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 't' },
          h('thead', {}, h('tr', {}, h('th', {}, 'תאריך'), h('th', {}, 'פקודה'), h('th', {}, 'פרטים'), h('th', { class: 'num' }, 'חובה'), h('th', { class: 'num' }, 'זכות'), h('th', { class: 'num' }, 'יתרה'))),
          h(
            'tbody',
            {},
            range.from ? h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'יתרת פתיחה'), h('td', { class: 'num' }, bal(l.opening))) : null,
            l.lines.length
              ? l.lines.map((r) =>
                  h(
                    'tr',
                    {},
                    h('td', { class: 'nowrap' }, fmtDate(r.entry_date)),
                    h('td', { class: 'num' }, r.entry_number),
                    h('td', {}, r.description, r.memo ? h('span', { class: 'muted small' }, ` (${r.memo})`) : null, r.document_id ? [' ', h('a', { href: `#/doc/${r.document_id}`, class: 'small' }, 'מסמך')] : null),
                    h('td', { class: 'num' }, r.debit ? fmtMoney(r.debit) : ''),
                    h('td', { class: 'num' }, r.credit ? fmtMoney(r.credit) : ''),
                    h('td', { class: 'num' }, bal(r.balance))
                  )
                )
              : h('tr', {}, h('td', { colspan: 6, class: 'muted' }, 'אין תנועות בתקופה'))
          ),
          h(
            'tfoot',
            {},
            h('tr', {}, h('td', { colspan: 3 }, 'סה"כ ויתרה'), h('td', { class: 'num' }, fmtMoney(l.lines.reduce((s, r) => s + r.debit, 0))), h('td', { class: 'num' }, fmtMoney(l.lines.reduce((s, r) => s + r.credit, 0))), h('td', { class: 'num' }, bal(l.closing)))
          )
        )
      )
    );
  }
  await load();
}

async function clientUsersTab(client, body) {
  const { users } = await get('/api/users');
  const mine = users.filter((u) => u.client_id === client.id);
  body.replaceChildren(usersCard(mine, { clientId: client.id, title: 'משתמשי הלקוח', hint: 'משתמש לקוח רואה רק את המסמכים של התיק הזה ומעלה חשבוניות.' }));
}

async function auditTab(client, body) {
  const { audit } = await get(`/api/clients/${client.id}/audit`);
  body.replaceChildren(
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'יומן פעולות'), h('p', { class: 'muted small' }, 'כל פעולה בתיק: מי, מתי ומה. היומן לא ניתן לעריכה.'))),
      audit.length
        ? h(
            'div',
            { class: 'table-wrap' },
            h(
              'table',
              { class: 't stackable' },
              h('thead', {}, h('tr', {}, h('th', {}, 'מתי'), h('th', {}, 'מי'), h('th', {}, 'פעולה'), h('th', {}, 'פרטים'))),
              h(
                'tbody',
                {},
                audit.map((a) =>
                  h(
                    'tr',
                    {},
                    h('td', { class: 'nowrap', 'data-label': 'מתי' }, fmtStamp(a.created_at)),
                    h('td', { 'data-label': 'מי' }, a.user_name || 'המערכת'),
                    h('td', { 'data-label': 'פעולה' }, ACTION_LABELS[a.action] || a.action, a.entity_type === 'document' ? [' ', h('a', { href: `#/doc/${a.entity_id}`, class: 'small' }, `#${a.entity_id}`)] : null),
                    h('td', { class: 'muted small', 'data-label': 'פרטים' }, auditDetails(a))
                  )
                )
              )
            )
          )
        : h('div', { class: 'empty' }, 'אין פעולות.')
    )
  );
}

// ---------- staff: users ----------

function usersCard(users, { clientId = null, title, hint }) {
  const add = () =>
    dialog({
      title: clientId ? 'משתמש לקוח חדש' : 'משתמש משרד חדש',
      submitLabel: 'הוספה',
      body: h(
        'div',
        { class: 'stack-sm' },
        h('label', { class: 'field' }, h('span', {}, 'שם'), h('input', { class: 'input', name: 'name', required: true })),
        h('label', { class: 'field' }, h('span', {}, 'דוא"ל (שם המשתמש)'), h('input', { class: 'input ltr', name: 'email', type: 'email', required: true })),
        h('label', { class: 'field' }, h('span', {}, 'סיסמה ראשונית (8 תווים לפחות)'), h('input', { class: 'input', name: 'password', type: 'text', required: true, minlength: 8, autocomplete: 'off' })),
        h('p', { class: 'muted small' }, 'את הסיסמה מוסרים למשתמש בעצמכם. הוא יכול להחליף אותה אחרי הכניסה.')
      ),
      onSubmit: async (fd) => {
        await post('/api/users', { ...Object.fromEntries(fd), role: clientId ? 'client' : 'staff', client_id: clientId });
        toast('המשתמש נוסף', 'ok');
        render();
      },
    });
  const reset = (u) =>
    dialog({
      title: `סיסמה חדשה ל${u.name}`,
      submitLabel: 'שמירה',
      body: h('label', { class: 'field' }, h('span', {}, 'סיסמה חדשה (8 תווים לפחות)'), h('input', { class: 'input', name: 'password', type: 'text', required: true, minlength: 8, autocomplete: 'off' })),
      onSubmit: async (fd) => {
        await patch(`/api/users/${u.id}`, { password: fd.get('password') });
        toast('הסיסמה עודכנה', 'ok');
      },
    });
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, title), h('p', { class: 'muted small' }, hint)), h('button', { class: 'btn', onclick: add }, 'משתמש חדש')),
    users.length
      ? h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 't stackable' },
            h('thead', {}, h('tr', {}, h('th', {}, 'שם'), h('th', {}, 'דוא"ל'), clientId ? null : h('th', {}, 'תפקיד'), h('th', {}, 'פעיל'), h('th', {}))),
            h(
              'tbody',
              {},
              users.map((u) =>
                h(
                  'tr',
                  {},
                  h('td', { 'data-label': 'שם' }, u.name),
                  h('td', { 'data-label': 'דוא"ל' }, h('span', { class: 'ltr' }, u.email)),
                  clientId ? null : h('td', { 'data-label': 'תפקיד' }, u.role === 'staff' ? 'משרד' : `לקוח: ${u.client_name}`),
                  h(
                    'td',
                    { 'data-label': 'פעיל' },
                    h('input', {
                      type: 'checkbox',
                      checked: u.active,
                      disabled: u.id === state.user.id,
                      'aria-label': 'פעיל',
                      onchange: async (e) => {
                        try {
                          await patch(`/api/users/${u.id}`, { active: e.target.checked });
                          toast(e.target.checked ? 'המשתמש הופעל' : 'המשתמש נחסם', 'ok');
                        } catch (err) {
                          fail(err);
                          e.target.checked = !e.target.checked;
                        }
                      },
                    })
                  ),
                  h('td', {}, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => reset(u) }, 'איפוס סיסמה'))
                )
              )
            )
          )
        )
      : h('div', { class: 'empty' }, clientId ? 'ללקוח עוד אין משתמש. מוסיפים אחד כדי שיוכל להעלות חשבוניות.' : 'אין משתמשים.')
  );
}

async function usersView() {
  $app.replaceChildren(...shell('users', h('div', { class: 'loading' }, 'טוען...')));
  const { users } = await get('/api/users');
  $app
    .querySelector('main')
    .replaceChildren(
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'משתמשים'), h('p', { class: 'sub' }, 'אנשי המשרד רואים את כל התיקים. משתמשי לקוח נוספים מתוך התיק שלהם.'))),
      usersCard(users, { title: 'כל המשתמשים', hint: 'כאן מוסיפים משתמש משרד.' })
    );
}

// ---------- router ----------

async function render() {
  for (const fn of cleanup) fn();
  cleanup = [];
  document.querySelectorAll('dialog').forEach((d) => d.close());
  const path = location.hash.replace(/^#\/?/, '').split('/');
  if (!state.user) {
    if (path[0] !== 'login') return go('#/login');
    return loginView();
  }
  if (path[0] === 'login') return go(state.user.role === 'staff' ? '#/queue' : '#/my');
  try {
    if (state.user.role === 'client') return await myDocumentsView();
    switch (path[0]) {
      case 'doc':
        return await documentView(path[1]);
      case 'clients':
        return path[1] ? await clientView(path[1], path[2] || 'documents', path[3]) : await clientsView();
      case 'users':
        return await usersView();
      case 'queue':
        return await queueView();
      default:
        return go('#/queue');
    }
  } catch (err) {
    fail(err);
  }
}

async function boot() {
  try {
    const me = await fetch('/api/me', { credentials: 'same-origin' });
    state.user = me.ok ? (await me.json()).user : null;
    if (state.user) meta = await get('/api/meta');
  } catch {
    state.user = null;
  }
  if (state.user?.role === 'staff') refreshQueueCount();
  if (!state.user) return go('#/login');
  const path = location.hash.replace(/^#\/?/, '');
  if (!path || path.startsWith('login')) go(state.user.role === 'staff' ? '#/queue' : '#/my');
  else render();
}

window.addEventListener('hashchange', render);
boot();
