/**
 * AP Merin Services - Email Automation Studio Logic (Mode 3)
 * Handles Multi-User Authentication Sync, Quill Rich Text Editor,
 * Designated HTML Signatures, Company Recipient Management & Serverless Dispatch
 */

// MULTI-USER SYSTEM CONFIGURATION (5 USER SLOTS + DEDICATED ADMIN)
const DEFAULT_SYSTEM_USERS = [
  {
    id: 'user_1',
    name: 'Darvwesvaar',
    email: 'project@apmerinservices.com.my',
    password: '',
    role: 'Project Executive',
    defaultCc: 'sharrvendran@apmerinservices.com.my, sales02@apmerinservices.com.my, suga@apmerinservices.com.my, navin@apmerinservices.com.my',
    signatureKey: 'AP_MERIN_SIG_user_1',
    isAdmin: false
  },
  {
    id: 'user_2',
    name: 'Kirthana',
    email: 'sales02@apmerinservices.com.my',
    password: '',
    role: 'Procurement Specialist',
    defaultCc: 'sharrvendran@apmerinservices.com.my, suga@apmerinservices.com.my, project@apmerinservices.com.my',
    signatureKey: 'AP_MERIN_SIG_user_2',
    isAdmin: false
  },
  {
    id: 'user_3',
    name: 'Sharrvendran',
    email: 'sharrvendran@apmerinservices.com.my',
    password: '',
    role: 'Operations Lead',
    defaultCc: 'suga@apmerinservices.com.my, sales02@apmerinservices.com.my, navin@apmerinservices.com.my',
    signatureKey: 'AP_MERIN_SIG_user_3',
    isAdmin: false
  },
  {
    id: 'user_4',
    name: 'Suga',
    email: 'suga@apmerinservices.com.my',
    password: '',
    role: 'Sales Executive',
    defaultCc: 'sharrvendran@apmerinservices.com.my, sales02@apmerinservices.com.my, project@apmerinservices.com.my',
    signatureKey: 'AP_MERIN_SIG_user_4',
    isAdmin: false
  },
  {
    id: 'user_5',
    name: 'Navin',
    email: 'navin@apmerinservices.com.my',
    password: '',
    role: 'Technical Lead',
    defaultCc: 'sharrvendran@apmerinservices.com.my, suga@apmerinservices.com.my, sales02@apmerinservices.com.my, project@apmerinservices.com.my',
    signatureKey: 'AP_MERIN_SIG_user_5',
    isAdmin: false
  }
];

const DEFAULT_ADMIN_USER = {
  id: 'user_admin',
  name: 'System Administrator',
  email: 'admin@apmerinservices.com.my',
  username: 'admin',
  password: '',
  role: 'Administrator',
  defaultCc: 'project@apmerinservices.com.my',
  signatureKey: 'AP_MERIN_SIG_user_admin',
  isAdmin: true
};

function getAdminUser() {
  const stored = localStorage.getItem('AP_MERIN_ADMIN_USER');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.password) {
        if (!parsed.email && DEFAULT_ADMIN_USER.email) parsed.email = DEFAULT_ADMIN_USER.email;
        if (!parsed.name && DEFAULT_ADMIN_USER.name) parsed.name = DEFAULT_ADMIN_USER.name;
        if (!parsed.role && DEFAULT_ADMIN_USER.role) parsed.role = DEFAULT_ADMIN_USER.role;
        if (!parsed.defaultCc && DEFAULT_ADMIN_USER.defaultCc) parsed.defaultCc = DEFAULT_ADMIN_USER.defaultCc;
        return parsed;
      }
    } catch (e) {}
  }
  localStorage.setItem('AP_MERIN_ADMIN_USER', JSON.stringify(DEFAULT_ADMIN_USER));
  return DEFAULT_ADMIN_USER;
}

async function syncUsersToBackend(users, admin, activeUserId) {
  try {
    const payload = {};
    if (users) payload.users = users;
    if (admin) payload.admin = admin;
    if (activeUserId) payload.active_user_id = activeUserId;
    await fetch('/api/settings/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn('Syncing users to backend failed:', err);
  }
}

function saveAdminUser(admin) {
  localStorage.setItem('AP_MERIN_ADMIN_USER', JSON.stringify(admin));
  const activeId = localStorage.getItem('AP_MERIN_ACTIVE_USER_ID') || (admin ? admin.id : null);
  const currentUsers = localStorage.getItem('AP_MERIN_SYSTEM_USERS') ? JSON.parse(localStorage.getItem('AP_MERIN_SYSTEM_USERS')) : null;
  syncUsersToBackend(currentUsers, admin, activeId);
}

function getAllUsers() {
  const stored = localStorage.getItem('AP_MERIN_SYSTEM_USERS');
  let users = null;
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length >= 2) {
        users = parsed;
      }
    } catch (e) {}
  }
  if (!users) {
    users = JSON.parse(JSON.stringify(DEFAULT_SYSTEM_USERS));
  }
  // Guarantee exactly 5 user slots
  while (users.length < 5) {
    const nextIdx = users.length + 1;
    users.push({
      id: `user_${nextIdx}`,
      name: `User ${nextIdx}`,
      email: '',
      password: '',
      role: 'Staff Member',
      defaultCc: 'project@apmerinservices.com.my',
      signatureKey: `AP_MERIN_SIG_user_${nextIdx}`,
      isAdmin: false
    });
  }
  users.forEach((u, idx) => {
    const def = DEFAULT_SYSTEM_USERS[idx] || {};
    if (!u.id) u.id = def.id || `user_${idx + 1}`;
    if (!u.name || u.name.startsWith('User ')) u.name = def.name || u.name;
    if ((!u.email || !u.email.trim()) && def.email) u.email = def.email;
    if ((!u.password || !u.password.trim()) && def.password) u.password = def.password;
    if ((!u.role || !u.role.trim() || u.role === 'Staff Member') && def.role) u.role = def.role;
    if ((!u.defaultCc || !u.defaultCc.trim() || u.defaultCc === 'project@apmerinservices.com.my') && def.defaultCc) u.defaultCc = def.defaultCc;
    if (!u.signatureKey) u.signatureKey = def.signatureKey || `AP_MERIN_SIG_${u.id}`;
  });
  localStorage.setItem('AP_MERIN_SYSTEM_USERS', JSON.stringify(users));
  return users;
}

function saveAllUsers(users) {
  if (Array.isArray(users)) {
    users.forEach((u, idx) => {
      if (!u.id) u.id = (DEFAULT_SYSTEM_USERS[idx] && DEFAULT_SYSTEM_USERS[idx].id) || `user_${idx + 1}`;
      if (!u.signatureKey) u.signatureKey = (DEFAULT_SYSTEM_USERS[idx] && DEFAULT_SYSTEM_USERS[idx].signatureKey) || `AP_MERIN_SIG_${u.id}`;
    });
  }
  localStorage.setItem('AP_MERIN_SYSTEM_USERS', JSON.stringify(users));
  const activeId = localStorage.getItem('AP_MERIN_ACTIVE_USER_ID');
  const currentAdmin = localStorage.getItem('AP_MERIN_ADMIN_USER') ? JSON.parse(localStorage.getItem('AP_MERIN_ADMIN_USER')) : null;
  syncUsersToBackend(users, currentAdmin, activeId);
}

function getActiveUser() {
  const activeId = localStorage.getItem('AP_MERIN_ACTIVE_USER_ID');
  if (activeId === 'user_admin' || activeId === 'admin') {
    return getAdminUser();
  }
  const users = getAllUsers();
  if (activeId) {
    const found = users.find(u => u.id === activeId || (u.email && u.email.toLowerCase() === activeId.toLowerCase()) || (u.name && u.name.toLowerCase() === activeId.toLowerCase()));
    if (found) {
      if (!found.signatureKey) found.signatureKey = `AP_MERIN_SIG_${found.id || 'user_3'}`;
      return found;
    }
  }
  return users[0]; // Default to Darvwesvaar
}

function setActiveUser(userOrId) {
  let found = null;
  if (typeof userOrId === 'string') {
    if (userOrId === 'user_admin' || userOrId.toLowerCase() === 'admin' || userOrId.toLowerCase() === 'admin@apmerinservices.com.my') {
      found = getAdminUser();
    } else {
      const users = getAllUsers();
      found = users.find(u => u.id === userOrId || (u.email && u.email.toLowerCase() === userOrId.toLowerCase()) || (u.name && u.name.toLowerCase() === userOrId.toLowerCase()));
    }
  } else {
    found = userOrId;
  }

  if (found) {
    localStorage.setItem('AP_MERIN_ACTIVE_USER_ID', found.id);
    updateActiveUserHeaderUI(found);
    syncEmailSettingsWithActiveUser(found);
    renderOutlookSignature();
    showToast(`Signed in as ${found.name} (${found.email})`, 'success');
  }
}

function updateActiveUserHeaderUI(user) {
  const badge = document.getElementById('activeUserBadge');
  const nameEl = document.getElementById('activeUserName');
  const emailEl = document.getElementById('activeUserEmail');
  const avatarEl = document.getElementById('activeUserAvatar');

  if (badge) badge.classList.remove('hidden');
  if (nameEl) {
    if (user.isAdmin) {
      nameEl.innerHTML = `${user.name} <span class="ml-1 text-[9px] px-1.5 py-0.5 bg-purple-900/80 text-purple-200 border border-purple-500/50 rounded font-bold uppercase tracking-wider">Admin</span>`;
    } else {
      nameEl.textContent = user.name;
    }
  }
  if (emailEl) emailEl.textContent = user.email ? `(${user.email})` : '';
  if (avatarEl) {
    avatarEl.textContent = (user.name || 'U').charAt(0).toUpperCase();
    if (user.isAdmin) {
      avatarEl.className = 'w-6 h-6 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center text-xs font-bold ring-1 ring-purple-400/50 shadow-sm';
    } else if (user.id === 'user_kirthana') {
      avatarEl.className = 'w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs font-bold';
    } else {
      avatarEl.className = 'w-6 h-6 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-bold';
    }
  }

  // Also dynamically update Quotation Comparator Mailbox badge
  const compareMailbox = document.getElementById('compareMailboxUserBadge');
  if (compareMailbox) {
    compareMailbox.textContent = (user && user.email) ? user.email : 'project@apmerinservices.com.my';
  }
}

// ==========================================
// MULTI-TIER SIGNATURE STORAGE (FULL LOSSLESS RESOLUTION)
// (Guarantees zero localStorage QuotaExceededError and permanent retention in IndexedDB)
// ==========================================
window._AP_MERIN_SIG_CACHE = window._AP_MERIN_SIG_CACHE || {};

// Preserve 100% original, lossless resolution for all signature graphics, banners, and logos.
// Destructive downscaling to 480px is completely removed so high-DPI retina sharpness is preserved.
async function compressSignatureImages(html) {
  return html;
}


function getCandidateSignatureKeys(user) {
  if (!user || user.target || user.preventDefault || (!user.id && !user.name && !user.email)) {
    user = (typeof getActiveUser === 'function' ? getActiveUser() : null) || {};
  }
  const candidateKeys = [];
  if (user.signatureKey) candidateKeys.push(user.signatureKey);
  if (user.id) {
    candidateKeys.push(`AP_MERIN_SIG_${user.id}`);
  }
  if (user.name) {
    const cleanName = user.name.toLowerCase().replace(/\s+/g, '_');
    candidateKeys.push(`AP_MERIN_SIG_${cleanName}`);
    candidateKeys.push(`AP_MERIN_SIG_user_${cleanName}`);
  }
  if (user.email) {
    const local = user.email.split('@')[0].toLowerCase();
    candidateKeys.push(`AP_MERIN_SIG_${local}`);
    candidateKeys.push(`AP_MERIN_SIG_user_${local}`);
  }
  return Array.from(new Set(candidateKeys.filter(Boolean)));
}

async function saveSignatureToStorage(key, value, syncBackend = true, userId = '') {
  window._AP_MERIN_SIG_CACHE[key] = value;

  // 1. Try localStorage with graceful catch
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch (err) {
    console.warn('localStorage setItem quota reached, backing up to IndexedDB:', err);
  }

  // 2. Try IndexedDB backup
  try {
    if (window.indexedDB) {
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open('AP_MERIN_SIGNATURES_DB', 1);
        req.onupgradeneeded = (e) => {
          const d = e.target.result;
          if (!d.objectStoreNames.contains('signatures')) {
            d.createObjectStore('signatures');
          }
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const tx = db.transaction('signatures', 'readwrite');
      const store = tx.objectStore('signatures');
      if (value) {
        store.put(value, key);
      } else {
        store.delete(key);
      }
    }
  } catch (idbErr) {
    console.warn('IndexedDB write error:', idbErr);
  }

  // 3. Permanent Backend Dual-Persistence (SQLite & JSON file)
  if (syncBackend && key) {
    try {
      await fetch('/api/settings/signatures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key, html: value || '', userId: userId || '' })
      });
    } catch (err) {
      console.warn('Background signature sync error:', err);
    }
  }
}

async function preloadSignaturesFromIndexedDB() {
  if (!window.indexedDB) return;
  try {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open('AP_MERIN_SIGNATURES_DB', 1);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('signatures')) {
          d.createObjectStore('signatures');
        }
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction('signatures', 'readonly');
    const store = tx.objectStore('signatures');
    const allKeysReq = store.getAllKeys ? store.getAllKeys() : null;
    if (allKeysReq) {
      allKeysReq.onsuccess = () => {
        const keys = allKeysReq.result || [];
        keys.forEach(k => {
          const valReq = store.get(k);
          valReq.onsuccess = () => {
            if (valReq.result) {
              window._AP_MERIN_SIG_CACHE[k] = valReq.result;
              const active = getActiveUser();
              if (active && (active.signatureKey === k || `AP_MERIN_SIG_${active.id}` === k)) {
                renderOutlookSignature();
              }
            }
          };
        });
      };
    }
  } catch (_) {}
}

function getUserDesignatedSignature(user) {
  // If user is falsy, an Event object, or invalid, resolve to active user
  if (!user || user.target || user.preventDefault || (!user.id && !user.name && !user.email)) {
    user = (typeof getActiveUser === 'function' ? getActiveUser() : null) || {};
  }
  if (!user || (!user.id && !user.name && !user.email)) return window.DEFAULT_AP_MERIN_SIGNATURE || '';

  const candidateKeys = getCandidateSignatureKeys(user);

  // 1. Check in-memory cache for ANY candidate key
  for (const k of candidateKeys) {
    if (window._AP_MERIN_SIG_CACHE && window._AP_MERIN_SIG_CACHE[k] && window._AP_MERIN_SIG_CACHE[k].trim().length > 0) {
      return window._AP_MERIN_SIG_CACHE[k];
    }
  }

  // 2. Check localStorage for ANY candidate key
  for (const k of candidateKeys) {
    try {
      const customSig = localStorage.getItem(k);
      if (customSig && customSig.trim().length > 0) {
        window._AP_MERIN_SIG_CACHE[k] = customSig;
        return customSig;
      }
    } catch (_) {}
  }

  // 3. Fallback only if no custom signature was ever saved for this user
  if (user.id === 'user_kirthana' || user.id === 'user_2' || (user.email && user.email.toLowerCase().includes('sales02'))) {
    return window.DEFAULT_SIGNATURE_KIRTHANA || window.DEFAULT_AP_MERIN_SIGNATURE || '';
  }
  if (user.id === 'user_darvwesvaar' || user.id === 'user_1' || (user.email && user.email.toLowerCase().includes('project'))) {
    return window.DEFAULT_SIGNATURE_DARVWESVAAR || window.DEFAULT_AP_MERIN_SIGNATURE || '';
  }

  return window.DEFAULT_AP_MERIN_SIGNATURE || '<p>Best regards,<br><strong>AP Merin Services</strong></p>';
}

function syncEmailSettingsWithActiveUser(user) {
  if (!user) user = getActiveUser();

  const cfg = {
    smtp_host: 'smtppro47.mschosting.network',
    smtp_port: 465,
    security_mode: 'ssl',
    username: user.email || 'project@apmerinservices.com.my',
    password: user.password || '',
    sender_name: user.name || 'AP Merin Services',
    sender_email: user.email || 'project@apmerinservices.com.my',
    default_cc: user.defaultCc || 'project@apmerinservices.com.my',
    delay_seconds: 1.5,
    include_signature: true
  };

  localStorage.setItem('AP_MERIN_EMAIL_CONFIG', JSON.stringify(cfg));

  // Update Settings Form fields
  if (document.getElementById('cfgSenderName')) document.getElementById('cfgSenderName').value = cfg.sender_name;
  if (document.getElementById('cfgUsername')) document.getElementById('cfgUsername').value = cfg.username;
  if (document.getElementById('cfgPassword')) document.getElementById('cfgPassword').value = cfg.password;
  if (document.getElementById('cfgSmtpHost')) document.getElementById('cfgSmtpHost').value = cfg.smtp_host;
  if (document.getElementById('cfgSmtpPort')) document.getElementById('cfgSmtpPort').value = cfg.smtp_port;
  if (document.getElementById('cfgSecurityMode')) document.getElementById('cfgSecurityMode').value = cfg.security_mode;
  if (document.getElementById('cfgDefaultCc')) document.getElementById('cfgDefaultCc').value = cfg.default_cc;
  if (document.getElementById('cfgDelaySeconds')) document.getElementById('cfgDelaySeconds').value = cfg.delay_seconds;

  // Pre-fill CC bar
  const ccInput = document.getElementById('emailCc');
  if (ccInput) {
    ccInput.value = cfg.default_cc;
    updateCcCount();
  }
}

// GLOBAL EMAIL STUDIO STATE
let quill = null;
let companyGroups = [];
let attachedFiles = [];

function initQuillEditor() {
  const editorEl = document.getElementById('editor');
  if (!editorEl) return;

  if (quill) return; // already initialized

  if (typeof Quill === 'undefined') {
    console.warn('Quill is loading, retrying in 150ms...');
    setTimeout(initQuillEditor, 150);
    return;
  }

  const FONT_STACK_MAP = {
    'trebuchet-ms': "'Trebuchet MS', 'Lucida Sans Unicode', 'Lucida Grande', 'Lucida Sans', Arial, sans-serif",
    'century-gothic': "'Century Gothic', AppleGothic, 'Segoe UI', Arial, sans-serif",
    'arial': "Arial, Helvetica, sans-serif",
    'calibri': "Calibri, Candara, Segoe, 'Segoe UI', sans-serif",
    'georgia': "Georgia, serif",
    'helvetica': "'Helvetica Neue', Helvetica, Arial, sans-serif",
    'inter': "'Inter', sans-serif",
    'lucida-sans': "'Lucida Sans', 'Lucida Sans Unicode', 'Lucida Grande', sans-serif",
    'tahoma': "Tahoma, Verdana, Segoe, sans-serif",
    'times-new-roman': "'Times New Roman', Times, Baskerville, Georgia, serif",
    'verdana': "Verdana, Geneva, sans-serif",
    'courier-new': "'Courier New', Courier, monospace"
  };

  // Register Quill Style Attributors so font family and sizes apply inline CSS styles for email clients
  try {
    const Font = Quill.import('attributors/style/font');
    Font.whitelist = [
      'trebuchet-ms',
      'century-gothic',
      'arial',
      'calibri',
      'georgia',
      'helvetica',
      'inter',
      'lucida-sans',
      'tahoma',
      'times-new-roman',
      'verdana',
      'courier-new'
    ];
    const origFontAdd = Font.add;
    Font.add = function(node, value) {
      if (value && FONT_STACK_MAP[value]) {
        node.style.fontFamily = FONT_STACK_MAP[value];
        return true;
      }
      return origFontAdd ? origFontAdd.call(this, node, value) : true;
    };
    Quill.register(Font, true);

    const Size = Quill.import('attributors/style/size');
    Size.whitelist = ['8px', '9px', '10px', '11px', '12px', '13px', '13.5px', '14px', '15px', '16px', '18px', '20px', '22px', '24px', '26px', '28px', '30px', '32px', '36px', '40px', '44px', '48px', '56px', '64px', '72px'];
    Quill.register(Size, true);
  } catch (e) {
    console.warn('Quill attributor registration notice:', e);
  }

  const toolbarOptions = [
    [{ 'font': [
      'trebuchet-ms',
      'century-gothic',
      'arial',
      'calibri',
      'georgia',
      'helvetica',
      'inter',
      'lucida-sans',
      'tahoma',
      'times-new-roman',
      'verdana',
      'courier-new'
    ] }],
    [{ 'size': ['8px', '9px', '10px', '11px', '12px', '13px', '13.5px', '14px', '15px', '16px', '18px', '20px', '22px', '24px', '26px', '28px', '30px', '32px', '36px', '40px', '44px', '48px', '56px', '64px', '72px'] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'color': [
      // Row 1: Grayscale & Neutrals
      '#000000', '#262626', '#4b5563', '#6b7280', '#9ca3af', '#cbd5e1', '#ffffff',
      // Row 2: AP Merin Brand & Corporate Blues
      '#072a4a', '#004b87', '#008fa1', '#0284c7', '#06b6d4', '#0d9488', '#14b8a6',
      // Row 3: Royal Blues & Purples
      '#1e3a8a', '#1d4ed8', '#2563eb', '#3b82f6', '#6366f1', '#7c3aed', '#a855f7',
      // Row 4: Reds & Warm Ambers
      '#7f1d1d', '#991b1b', '#dc2626', '#ef4444', '#f97316', '#d97706', '#eab308',
      // Row 5: Greens & Earth Tones
      '#14532d', '#166534', '#15803d', '#16a34a', '#22c55e', '#84cc16', '#78350f'
    ] }, { 'background': [
      false,
      '#ffff00', // vivid highlighter yellow
      '#66ff66', // vivid highlighter green
      '#00ffff', // vivid highlighter cyan
      '#ffb347', // vivid highlighter orange
      '#ff69b4', // vivid highlighter pink
      '#e6e6fa', // soft lavender
      '#ffcccc', // soft red
      '#cce5ff', // soft blue
      '#d4edda', // soft sage
      '#fff3cd'  // light parchment
    ] }],
    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
    [{ 'align': [] }],
    ['link', 'image'],
    ['clean']
  ];

  quill = new Quill('#editor', {
    theme: 'snow',
    placeholder: 'Click here to type your email message... (Paste text, tables, and images directly with Ctrl+V)',
    modules: {
      toolbar: toolbarOptions
    }
  });

  // Initialize interactive image resizer controller
  initQuillImageResizer(quill);

  // Keep toolbar pinned at top of editor-wrapper
  const toolbar = document.querySelector('.ql-toolbar');
  const canvasWrapper = document.getElementById('emailCanvasWrapper');
  const editorWrapper = document.querySelector('.editor-wrapper');
  if (toolbar && canvasWrapper && editorWrapper) {
    editorWrapper.insertBefore(toolbar, canvasWrapper);
  }

  // Ensure typing area is clickable and focused
  if (canvasWrapper) {
    canvasWrapper.addEventListener('click', (e) => {
      const sigWrapper = document.getElementById('outlookSignatureWrapper');
      if (sigWrapper && sigWrapper.contains(e.target)) return;
      if (e.target.closest('button, a, input, select, textarea')) return;
      if (quill) quill.focus();
    });
  }

  // Handle direct screenshot/photo pasting from clipboard
  const handleComposerPaste = (event) => {
    const clipboardData = event.clipboardData || window.clipboardData;
    if (!clipboardData) return;

    let imageBlob = null;
    if (clipboardData.items) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.type && item.type.startsWith('image/')) {
          imageBlob = item.getAsFile();
          break;
        }
      }
    }
    if (!imageBlob && clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const file = clipboardData.files[i];
        if (file.type && file.type.startsWith('image/')) {
          imageBlob = file;
          break;
        }
      }
    }

    if (imageBlob) {
      event.preventDefault();
      event.stopPropagation();
      const reader = new FileReader();
      reader.onload = (e) => {
        if (!quill) return;
        const dataUrl = e.target.result;
        const tempImg = new Image();
        tempImg.onload = () => {
          const naturalWidth = tempImg.naturalWidth;
          const naturalHeight = tempImg.naturalHeight;
          const range = quill.getSelection(true) || { index: quill.getLength() };
          quill.insertEmbed(range.index, 'image', dataUrl);
          quill.setSelection(range.index + 1);

          setTimeout(() => {
            const imgs = quill.root.querySelectorAll('img');
            for (let j = imgs.length - 1; j >= 0; j--) {
              const im = imgs[j];
              if (im.src === dataUrl || (!im.hasAttribute('data-exact-sized') && (im.naturalWidth === naturalWidth || im.width === naturalWidth))) {
                im.setAttribute('data-exact-sized', 'true');
                im.setAttribute('width', naturalWidth);
                im.setAttribute('height', naturalHeight);
                im.style.width = naturalWidth + 'px';
                im.style.height = naturalHeight + 'px';
                im.style.maxWidth = '100%';
                im.style.height = 'auto';
                break;
              }
            }
          }, 25);
          showToast(`Photo pasted at exact size (${naturalWidth} × ${naturalHeight} px)!`, 'success');
        };
        tempImg.src = dataUrl;
      };
      reader.readAsDataURL(imageBlob);
    }
    // If text was pasted, let default Quill behavior paste it naturally without interference
  };

  quill.root.addEventListener('paste', handleComposerPaste);
  if (canvasWrapper) {
    canvasWrapper.addEventListener('paste', handleComposerPaste);
  }
}

// ============================================================
// INTERACTIVE FREEHAND IMAGE RESIZER & CONTROLLER
// ============================================================
let activeSelectedImg = null;
let imageResizeToolbarEl = null;
let imageResizeOverlayEl = null;
let isResizingImage = false;

function initQuillImageResizer(quillInstance) {
  if (!quillInstance || !quillInstance.root) return;

  // Create corner handles overlay if not exists
  if (!imageResizeOverlayEl) {
    imageResizeOverlayEl = document.createElement('div');
    imageResizeOverlayEl.className = 'image-resize-overlay';
    imageResizeOverlayEl.style.display = 'none';
    imageResizeOverlayEl.innerHTML = `
      <div class="image-resize-handle image-resize-handle-nw" data-corner="nw" title="Drag corner to resize"></div>
      <div class="image-resize-handle image-resize-handle-ne" data-corner="ne" title="Drag corner to resize"></div>
      <div class="image-resize-handle image-resize-handle-sw" data-corner="sw" title="Drag corner to resize"></div>
      <div class="image-resize-handle image-resize-handle-se" data-corner="se" title="Drag corner to resize"></div>
      <div class="image-dimension-badge" id="imgDimensionBadgeStudio"></div>
    `;
    document.body.appendChild(imageResizeOverlayEl);

    // Attach corner drag listeners (mouse and touch)
    imageResizeOverlayEl.addEventListener('mousedown', handleStudioCornerDragStart);
    imageResizeOverlayEl.addEventListener('touchstart', handleStudioCornerDragStart, { passive: false });
  }

  // Create floating toolbar if not exists (WITHOUT 25%, 50%, 75%, 100% presets)
  if (!imageResizeToolbarEl) {
    imageResizeToolbarEl = document.createElement('div');
    imageResizeToolbarEl.className = 'image-resize-toolbar';
    imageResizeToolbarEl.style.display = 'none';
    imageResizeToolbarEl.innerHTML = `
      <button type="button" class="btn-img-action" data-action="reset-orig" title="Reset to Original Copied Size">
        <i class="fa-solid fa-arrows-rotate"></i> <span>Original Size</span>
      </button>
      <div class="toolbar-divider"></div>
      <button type="button" class="btn-img-action" data-align="left" title="Align Left"><i class="fa-solid fa-align-left"></i></button>
      <button type="button" class="btn-img-action" data-align="center" title="Align Center"><i class="fa-solid fa-align-center"></i></button>
      <button type="button" class="btn-img-action" data-align="right" title="Align Right"><i class="fa-solid fa-align-right"></i></button>
      <div class="toolbar-divider"></div>
      <button type="button" class="btn-img-action btn-img-delete" title="Delete Image"><i class="fa-solid fa-trash"></i></button>
    `;
    document.body.appendChild(imageResizeToolbarEl);

    // Toolbar action clicks
    imageResizeToolbarEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('.btn-img-action');
      if (!btn || !activeSelectedImg) return;

      if (btn.dataset.action === 'reset-orig') {
        const natW = activeSelectedImg.naturalWidth;
        const natH = activeSelectedImg.naturalHeight;
        if (natW && natH) {
          activeSelectedImg.style.width = natW + 'px';
          activeSelectedImg.style.height = natH + 'px';
          activeSelectedImg.setAttribute('width', natW);
          activeSelectedImg.setAttribute('height', natH);
          activeSelectedImg.style.maxWidth = '100%';
        } else {
          activeSelectedImg.style.width = 'auto';
          activeSelectedImg.style.height = 'auto';
          activeSelectedImg.removeAttribute('width');
          activeSelectedImg.removeAttribute('height');
        }
        repositionStudioImageOverlayAndToolbar(activeSelectedImg);
      } else if (btn.dataset.align) {
        const al = btn.dataset.align;
        if (al === 'left') {
          activeSelectedImg.style.display = 'inline-block';
          activeSelectedImg.style.float = 'left';
          activeSelectedImg.style.margin = '0 16px 12px 0';
        } else if (al === 'center') {
          activeSelectedImg.style.display = 'block';
          activeSelectedImg.style.float = 'none';
          activeSelectedImg.style.margin = '12px auto';
        } else if (al === 'right') {
          activeSelectedImg.style.display = 'inline-block';
          activeSelectedImg.style.float = 'right';
          activeSelectedImg.style.margin = '0 0 12px 16px';
        }
        repositionStudioImageOverlayAndToolbar(activeSelectedImg);
      } else if (btn.classList.contains('btn-img-delete')) {
        const blot = Quill.find(activeSelectedImg);
        if (blot) blot.deleteAt(0);
        else activeSelectedImg.remove();
        deselectImage();
      }
    });
  }

  // Click on image inside editor
  quillInstance.root.addEventListener('click', (e) => {
    if (e.target && e.target.tagName === 'IMG') {
      selectImage(e.target);
    } else if (!isResizingImage) {
      deselectImage();
    }
  });

  // Reposition on scroll or resize
  window.addEventListener('scroll', () => {
    if (activeSelectedImg && !isResizingImage) repositionStudioImageOverlayAndToolbar(activeSelectedImg);
  }, true);
  window.addEventListener('resize', () => {
    if (activeSelectedImg && !isResizingImage) repositionStudioImageOverlayAndToolbar(activeSelectedImg);
  });

  // Escape key deselects image
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') deselectImage();
  });

  // Clicking outside deselects image
  document.addEventListener('mousedown', (e) => {
    if (isResizingImage) return;
    if (imageResizeToolbarEl && imageResizeToolbarEl.contains(e.target)) return;
    if (imageResizeOverlayEl && imageResizeOverlayEl.contains(e.target)) return;
    if (e.target.tagName === 'IMG' && quillInstance.root.contains(e.target)) return;
    deselectImage();
  });
}

function selectImage(img) {
  if (activeSelectedImg && activeSelectedImg !== img) {
    deselectImage();
  }
  activeSelectedImg = img;
  img.classList.add('img-selected');
  repositionStudioImageOverlayAndToolbar(img);
  if (imageResizeOverlayEl) imageResizeOverlayEl.style.display = 'block';
  if (imageResizeToolbarEl) imageResizeToolbarEl.style.display = 'flex';
}

function deselectImage() {
  if (activeSelectedImg) {
    activeSelectedImg.classList.remove('img-selected');
    activeSelectedImg = null;
  }
  if (imageResizeOverlayEl) {
    imageResizeOverlayEl.style.display = 'none';
  }
  if (imageResizeToolbarEl) {
    imageResizeToolbarEl.style.display = 'none';
  }
  isResizingImage = false;
}

function repositionStudioImageOverlayAndToolbar(img) {
  if (!img) return;
  const rect = img.getBoundingClientRect();
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;

  // Reposition corner handles
  if (imageResizeOverlayEl) {
    const nw = imageResizeOverlayEl.querySelector('.image-resize-handle-nw');
    const ne = imageResizeOverlayEl.querySelector('.image-resize-handle-ne');
    const sw = imageResizeOverlayEl.querySelector('.image-resize-handle-sw');
    const se = imageResizeOverlayEl.querySelector('.image-resize-handle-se');
    const badge = imageResizeOverlayEl.querySelector('#imgDimensionBadgeStudio');

    const handleOffset = 7; // Half handle size
    if (nw) { nw.style.top = `${rect.top + scrollY - handleOffset}px`; nw.style.left = `${rect.left + scrollX - handleOffset}px`; }
    if (ne) { ne.style.top = `${rect.top + scrollY - handleOffset}px`; ne.style.left = `${rect.right + scrollX - handleOffset}px`; }
    if (sw) { sw.style.top = `${rect.bottom + scrollY - handleOffset}px`; sw.style.left = `${rect.left + scrollX - handleOffset}px`; }
    if (se) { se.style.top = `${rect.bottom + scrollY - handleOffset}px`; se.style.left = `${rect.right + scrollX - handleOffset}px`; }

    if (badge) {
      const curW = Math.round(rect.width);
      const curH = Math.round(rect.height);
      badge.textContent = `${curW} × ${curH} px`;
      badge.style.top = `${rect.bottom + scrollY + 8}px`;
      badge.style.left = `${rect.left + scrollX + (rect.width / 2)}px`;
    }
  }

  // Reposition floating toolbar
  if (imageResizeToolbarEl) {
    const tbRect = imageResizeToolbarEl.getBoundingClientRect();
    let top = rect.top + scrollY - 46;
    if (top < scrollY + 10) {
      top = rect.bottom + scrollY + 36;
    }
    let left = rect.left + scrollX + (rect.width / 2) - (tbRect.width / 2);
    if (left < 10) left = 10;
    if (left + tbRect.width > window.innerWidth - 10) {
      left = window.innerWidth - tbRect.width - 10;
    }
    imageResizeToolbarEl.style.top = `${top}px`;
    imageResizeToolbarEl.style.left = `${left}px`;
  }
}

function handleStudioCornerDragStart(e) {
  const handle = e.target.closest('.image-resize-handle');
  if (!handle || !activeSelectedImg) return;

  e.preventDefault();
  e.stopPropagation();

  isResizingImage = true;
  const corner = handle.dataset.corner;
  const startX = e.clientX !== undefined ? e.clientX : e.touches[0].clientX;
  const startY = e.clientY !== undefined ? e.clientY : e.touches[0].clientY;

  const startW = activeSelectedImg.offsetWidth || activeSelectedImg.naturalWidth || 200;
  const startH = activeSelectedImg.offsetHeight || activeSelectedImg.naturalHeight || 150;
  const aspectRatio = startW / (startH || 1);

  const badge = imageResizeOverlayEl ? imageResizeOverlayEl.querySelector('#imgDimensionBadgeStudio') : null;
  if (badge) badge.classList.add('active');

  function onPointerMove(ev) {
    if (!isResizingImage || !activeSelectedImg) return;
    ev.preventDefault();

    const clientX = ev.clientX !== undefined ? ev.clientX : (ev.touches ? ev.touches[0].clientX : startX);
    const deltaX = clientX - startX;

    let newWidth = startW;
    if (corner === 'se') {
      newWidth = startW + deltaX;
    } else if (corner === 'sw') {
      newWidth = startW - deltaX;
    } else if (corner === 'ne') {
      newWidth = startW + deltaX;
    } else if (corner === 'nw') {
      newWidth = startW - deltaX;
    }

    // Restrict minimum width to 35px
    newWidth = Math.max(35, Math.round(newWidth));
    const newHeight = Math.max(20, Math.round(newWidth / aspectRatio));

    activeSelectedImg.style.width = newWidth + 'px';
    activeSelectedImg.style.height = newHeight + 'px';
    activeSelectedImg.setAttribute('width', newWidth);
    activeSelectedImg.setAttribute('height', newHeight);
    activeSelectedImg.style.maxWidth = '100%';

    repositionStudioImageOverlayAndToolbar(activeSelectedImg);
  }

  function onPointerUp(ev) {
    isResizingImage = false;
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('mouseup', onPointerUp);
    window.removeEventListener('touchmove', onPointerMove);
    window.removeEventListener('touchend', onPointerUp);

    if (badge) badge.classList.remove('active');
    if (activeSelectedImg) {
      repositionStudioImageOverlayAndToolbar(activeSelectedImg);
    }
  }

  window.addEventListener('mousemove', onPointerMove, { passive: false });
  window.addEventListener('mouseup', onPointerUp);
  window.addEventListener('touchmove', onPointerMove, { passive: false });
  window.addEventListener('touchend', onPointerUp);
}

function renderOutlookSignature() {
  const sigWrapper = document.getElementById('outlookSignatureWrapper');
  const sigDisplay = document.getElementById('outlookSignatureDisplay');
  const chk = document.getElementById('chkIncludeSignature');
  const isIncluded = chk ? chk.checked : true;

  if (!sigWrapper || !sigDisplay) return;

  if (!isIncluded) {
    sigWrapper.classList.add('hidden');
    return;
  }

  const user = getActiveUser();
  const sigHtml = getUserDesignatedSignature(user);

  sigWrapper.classList.remove('hidden');
  sigDisplay.innerHTML = sigHtml || '<p class="text-slate-400 italic">No signature loaded.</p>';
}

let _currentSigEditingUser = null;
let _isSigToolbarInitialized = false;

function syncSigToolbarWithSelection() {
  const visualEditor = document.getElementById('sigVisualEditor');
  if (!visualEditor || visualEditor.style.display === 'none') return;

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  const range = sel.getRangeAt(0);
  let node = range.commonAncestorContainer;
  if (!node) return;
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentElement;
  }
  if (!node || !visualEditor.contains(node)) return;

  const comp = window.getComputedStyle(node);
  if (!comp) return;

  // 1. Font Size
  const sizeSelect = document.getElementById('sigFontSize');
  if (sizeSelect) {
    const computedFontSize = comp.fontSize; // e.g. "20px", "14px", "40px"
    const numPx = parseFloat(computedFontSize);
    if (!isNaN(numPx) && numPx > 0) {
      let matchedIndex = -1;
      let minDiff = 0.75;
      for (let i = 0; i < sizeSelect.options.length; i++) {
        const optVal = parseFloat(sizeSelect.options[i].value);
        const diff = Math.abs(optVal - numPx);
        if (diff < minDiff) {
          minDiff = diff;
          matchedIndex = i;
        }
      }

      // Remove any existing temporary option
      const oldTemp = sizeSelect.querySelector('option[data-temporary="true"]');
      if (oldTemp) oldTemp.remove();

      if (matchedIndex !== -1) {
        sizeSelect.selectedIndex = matchedIndex;
      } else {
        // Create temporary option for exact computed size
        const roundedPx = Math.round(numPx * 10) / 10;
        const tempOpt = new Option(`${roundedPx}px`, `${roundedPx}px`);
        tempOpt.setAttribute('data-temporary', 'true');
        sizeSelect.add(tempOpt);
        sizeSelect.value = `${roundedPx}px`;
      }
    }
  }

  // 2. Font Family
  const fontSelect = document.getElementById('sigFontFamily');
  if (fontSelect) {
    const compFamily = (comp.fontFamily || '').toLowerCase().replace(/['"]/g, '');
    let matchedFamilyIndex = -1;
    for (let i = 0; i < fontSelect.options.length; i++) {
      const optVal = fontSelect.options[i].value.toLowerCase().replace(/['"]/g, '');
      const optText = fontSelect.options[i].text.toLowerCase();
      const primaryOpt = optVal.split(',')[0].trim();
      if (compFamily.includes(primaryOpt) || compFamily.includes(optText) || optVal.includes(compFamily)) {
        matchedFamilyIndex = i;
        break;
      }
    }
    if (matchedFamilyIndex !== -1) {
      fontSelect.selectedIndex = matchedFamilyIndex;
    }
  }

  // 3. Formatting Buttons Active State
  const updateBtnActive = (cmd, isActive) => {
    const btn = document.querySelector(`#sigRichToolbar [data-sig-cmd="${cmd}"]`);
    if (btn) {
      btn.classList.toggle('active', !!isActive);
    }
  };

  try {
    const isBold = document.queryCommandState('bold') || comp.fontWeight >= 600 || comp.fontWeight === 'bold';
    updateBtnActive('bold', isBold);

    const isItalic = document.queryCommandState('italic') || comp.fontStyle === 'italic';
    updateBtnActive('italic', isItalic);

    const isUnderline = document.queryCommandState('underline') || (comp.textDecorationLine && comp.textDecorationLine.includes('underline'));
    updateBtnActive('underline', isUnderline);

    const isStrike = document.queryCommandState('strikeThrough') || (comp.textDecorationLine && comp.textDecorationLine.includes('line-through'));
    updateBtnActive('strikeThrough', isStrike);

    // Text Alignment
    const align = comp.textAlign || 'left';
    updateBtnActive('justifyLeft', align === 'left' || align === 'start');
    updateBtnActive('justifyCenter', align === 'center');
    updateBtnActive('justifyRight', align === 'right' || align === 'end');
  } catch (_) {}

  // 4. Text Color
  const textColorInput = document.getElementById('sigTextColor');
  if (textColorInput && comp.color) {
    const rgb = comp.color.match(/\d+/g);
    if (rgb && rgb.length >= 3) {
      const hex = '#' + ((1 << 24) + (parseInt(rgb[0]) << 16) + (parseInt(rgb[1]) << 8) + parseInt(rgb[2])).toString(16).slice(1);
      textColorInput.value = hex;
    }
  }
}

function applySigFontSize(sizeVal) {
  const visualEditor = document.getElementById('sigVisualEditor');
  if (!visualEditor) return;
  visualEditor.focus();

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) {
    showToast('Please highlight text in the signature canvas to apply styling.', 'info');
    return;
  }

  const range = sel.getRangeAt(0);
  if (!visualEditor.contains(range.commonAncestorContainer)) return;

  // Check if selection is within a single element whose entire text is selected
  let commonNode = range.commonAncestorContainer;
  if (commonNode.nodeType === Node.TEXT_NODE) {
    commonNode = commonNode.parentElement;
  }
  
  if (commonNode && commonNode !== visualEditor && commonNode.textContent.trim() === range.toString().trim()) {
    commonNode.style.fontSize = sizeVal;
    commonNode.style.lineHeight = 'normal';
    commonNode.querySelectorAll('*').forEach(child => {
      if (child.style && child.style.fontSize) {
        child.style.fontSize = '';
      }
    });
    syncSigToolbarWithSelection();
    return;
  }

  // Use browser native fontSize splitting
  try {
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontSize', false, '7');
  } catch (err) {
    console.warn('execCommand fontSize error:', err);
  }

  const fontTags = visualEditor.querySelectorAll('font[size="7"], font[size="6"]');
  if (fontTags.length > 0) {
    fontTags.forEach(f => {
      const span = document.createElement('span');
      span.style.fontSize = sizeVal;
      span.style.lineHeight = 'normal';
      span.innerHTML = f.innerHTML;
      span.querySelectorAll('*').forEach(child => {
        if (child.style && child.style.fontSize) {
          child.style.fontSize = '';
        }
      });
      f.parentNode.replaceChild(span, f);
    });
  } else {
    try {
      const span = document.createElement('span');
      span.style.fontSize = sizeVal;
      span.style.lineHeight = 'normal';
      const frag = range.extractContents();
      const div = document.createElement('div');
      div.appendChild(frag);
      div.querySelectorAll('*').forEach(el => {
        if (el.style && el.style.fontSize) el.style.fontSize = '';
      });
      while (div.firstChild) {
        span.appendChild(div.firstChild);
      }
      range.insertNode(span);
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      sel.addRange(newRange);
    } catch (_) {}
  }

  // Also clean any ancestor spans if all their text was in selection
  let p = range.commonAncestorContainer;
  if (p && p.nodeType === Node.TEXT_NODE) p = p.parentElement;
  while (p && p !== visualEditor) {
    if (p.tagName === 'SPAN' && p.textContent.trim() === range.toString().trim()) {
      p.style.fontSize = sizeVal;
    }
    p = p.parentElement;
  }

  syncSigToolbarWithSelection();
}

function applySigInlineStyle(styleProp, styleVal) {
  const visualEditor = document.getElementById('sigVisualEditor');
  if (!visualEditor) return;
  visualEditor.focus();

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) {
    showToast('Please highlight text in the signature canvas to apply styling.', 'info');
    return;
  }

  const range = sel.getRangeAt(0);
  if (!visualEditor.contains(range.commonAncestorContainer)) return;

  try {
    document.execCommand('styleWithCSS', false, true);
  } catch (_) {}

  if (styleProp === 'fontFamily') {
    document.execCommand('fontName', false, styleVal);
    visualEditor.querySelectorAll('font[face]').forEach(f => {
      const span = document.createElement('span');
      span.style.fontFamily = styleVal;
      span.innerHTML = f.innerHTML;
      span.querySelectorAll('*').forEach(child => {
        if (child.style && child.style.fontFamily) {
          child.style.fontFamily = '';
        }
      });
      f.parentNode.replaceChild(span, f);
    });
    syncSigToolbarWithSelection();
  } else if (styleProp === 'fontSize') {
    applySigFontSize(styleVal);
  }
}

function initSignatureRichToolbar() {
  if (_isSigToolbarInitialized) return;
  _isSigToolbarInitialized = true;

  const visualEditor = document.getElementById('sigVisualEditor');
  const sigHtmlSource = document.getElementById('sigHtmlSource');
  const fontSelect = document.getElementById('sigFontFamily');
  const sizeSelect = document.getElementById('sigFontSize');
  const textColorInput = document.getElementById('sigTextColor');
  const bgColorInput = document.getElementById('sigBgColor');
  const btnToggleHtml = document.getElementById('btnSigToggleHtml');
  const btnLink = document.getElementById('btnSigLink');
  const btnImg = document.getElementById('btnSigInsertImg');
  const fileInput = document.getElementById('sigImageFileInput');
  const btnClearFormat = document.getElementById('btnSigClearFormat');

  // Sync toolbar formatting with caret / cursor selection
  if (visualEditor) {
    visualEditor.addEventListener('mouseup', syncSigToolbarWithSelection);
    visualEditor.addEventListener('keyup', syncSigToolbarWithSelection);
    visualEditor.addEventListener('click', syncSigToolbarWithSelection);
    visualEditor.addEventListener('focus', syncSigToolbarWithSelection);
  }

  document.addEventListener('selectionchange', () => {
    const modal = document.getElementById('signatureModal');
    if (modal && modal.classList.contains('active')) {
      syncSigToolbarWithSelection();
    }
  });

  // Command buttons (bold, italic, underline, strikeThrough, justifyLeft, justifyCenter, justifyRight, lists)
  document.querySelectorAll('#sigRichToolbar [data-sig-cmd]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (sigHtmlSource && sigHtmlSource.style.display !== 'none') {
        showToast('Please switch back to Visual mode to format text.', 'info');
        return;
      }
      const cmd = btn.getAttribute('data-sig-cmd');
      if (cmd && visualEditor) {
        visualEditor.focus();
        document.execCommand(cmd, false, null);
        syncSigToolbarWithSelection();
      }
    });
  });

  // Font Family
  if (fontSelect) {
    fontSelect.addEventListener('change', () => {
      if (sigHtmlSource && sigHtmlSource.style.display !== 'none') return;
      applySigInlineStyle('fontFamily', fontSelect.value);
    });
  }

  // Font Size
  if (sizeSelect) {
    sizeSelect.addEventListener('change', () => {
      if (sigHtmlSource && sigHtmlSource.style.display !== 'none') return;
      applySigInlineStyle('fontSize', sizeSelect.value);
    });
  }

  // Text Color
  if (textColorInput) {
    textColorInput.addEventListener('input', () => {
      if (sigHtmlSource && sigHtmlSource.style.display !== 'none') return;
      if (visualEditor) {
        visualEditor.focus();
        document.execCommand('foreColor', false, textColorInput.value);
        syncSigToolbarWithSelection();
      }
    });
  }

  // Highlight / Background Color
  if (bgColorInput) {
    bgColorInput.addEventListener('input', () => {
      if (sigHtmlSource && sigHtmlSource.style.display !== 'none') return;
      if (visualEditor) {
        visualEditor.focus();
        try {
          document.execCommand('styleWithCSS', false, true);
        } catch (_) {}
        if (!document.execCommand('hiliteColor', false, bgColorInput.value)) {
          document.execCommand('backColor', false, bgColorInput.value);
        }
        syncSigToolbarWithSelection();
      }
    });
  }

  // Insert Link
  if (btnLink) {
    btnLink.addEventListener('click', () => {
      if (sigHtmlSource && sigHtmlSource.style.display !== 'none') return;
      if (!visualEditor) return;
      visualEditor.focus();
      const url = prompt('Enter the destination web link (URL):', 'https://');
      if (url && url.trim() && url !== 'https://') {
        document.execCommand('createLink', false, url.trim());
      }
    });
  }

  // Insert / Upload Image
  if (btnImg && fileInput) {
    btnImg.addEventListener('click', () => {
      if (sigHtmlSource && sigHtmlSource.style.display !== 'none') {
        showToast('Please switch to Visual mode to insert images.', 'info');
        return;
      }
      fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      if (!fileInput.files || !fileInput.files.length) return;
      const file = fileInput.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        const tempImg = new Image();
        tempImg.onload = () => {
          const nw = tempImg.naturalWidth;
          const nh = tempImg.naturalHeight;
          const img = document.createElement('img');
          img.src = dataUrl;
          img.setAttribute('width', nw);
          img.setAttribute('height', nh);
          img.style.width = nw + 'px';
          img.style.height = nh + 'px';
          img.style.maxWidth = '100%';
          img.style.height = 'auto';

          if (visualEditor) {
            visualEditor.focus();
            const sel = window.getSelection();
            if (sel && sel.rangeCount) {
              const range = sel.getRangeAt(0);
              range.insertNode(img);
            } else {
              visualEditor.appendChild(img);
            }
          }
          showToast(`Image inserted (${nw} × ${nh} px)!`, 'success');
        };
        tempImg.src = dataUrl;
      };
      reader.readAsDataURL(file);
      fileInput.value = '';
    });
  }

  // Clear Formatting
  if (btnClearFormat) {
    btnClearFormat.addEventListener('click', () => {
      if (sigHtmlSource && sigHtmlSource.style.display !== 'none') return;
      if (visualEditor) {
        visualEditor.focus();
        document.execCommand('removeFormat', false, null);
        syncSigToolbarWithSelection();
      }
    });
  }

  // Toggle HTML Source Mode
  if (btnToggleHtml) {
    btnToggleHtml.addEventListener('click', () => {
      if (!visualEditor || !sigHtmlSource) return;
      const isViewingHtml = sigHtmlSource.style.display !== 'none';
      if (isViewingHtml) {
        // Switch back to Visual Editor
        visualEditor.innerHTML = sigHtmlSource.value;
        sigHtmlSource.style.display = 'none';
        visualEditor.style.display = 'block';
        btnToggleHtml.innerHTML = '<i class="fa-solid fa-code"></i> <span>HTML</span>';
        btnToggleHtml.classList.remove('active');
        visualEditor.focus();
        showToast('Switched to Visual Signature Canvas.', 'info');
      } else {
        // Switch to HTML Source View
        sigHtmlSource.value = visualEditor.innerHTML;
        visualEditor.style.display = 'none';
        sigHtmlSource.style.display = 'block';
        btnToggleHtml.innerHTML = '<i class="fa-solid fa-eye"></i> <span>Visual</span>';
        btnToggleHtml.classList.add('active');
        sigHtmlSource.focus();
        showToast('Switched to HTML Source Code View.', 'info');
      }
    });
  }
}

function openSignatureModal(targetUser = null) {
  initSignatureRichToolbar();

  const modal = document.getElementById('signatureModal');
  const visualEditor = document.getElementById('sigVisualEditor');
  const sigHtmlSource = document.getElementById('sigHtmlSource');
  const btnToggleHtml = document.getElementById('btnSigToggleHtml');

  // Reset HTML source view back to visual editor
  if (sigHtmlSource && visualEditor) {
    sigHtmlSource.style.display = 'none';
    visualEditor.style.display = 'block';
  }
  if (btnToggleHtml) {
    btnToggleHtml.innerHTML = '<i class="fa-solid fa-code"></i> <span>HTML</span>';
    btnToggleHtml.classList.remove('active');
  }

  // Sanitize targetUser (ignore Event objects passed from event listeners)
  let user = null;
  if (targetUser && typeof targetUser === 'object' && !('target' in targetUser) && !('preventDefault' in targetUser) && (targetUser.id || targetUser.name || targetUser.email)) {
    user = targetUser;
  } else {
    user = getActiveUser();
  }
  if (!user) {
    const allUsers = typeof getAllUsers === 'function' ? getAllUsers() : [];
    user = allUsers[0] || {};
  }
  _currentSigEditingUser = user;

  let currentSig = getUserDesignatedSignature(user);

  // If the active user is being edited and the main email studio screen is already displaying a signature,
  // prioritize the exact signature the user currently sees on screen over any fallback!
  const activeUser = getActiveUser();
  const isActiveUser = activeUser && (activeUser.id === user.id || activeUser.signatureKey === user.signatureKey);
  if (isActiveUser) {
    const sigDisplay = document.getElementById('outlookSignatureDisplay');
    if (sigDisplay && sigDisplay.innerHTML && !sigDisplay.innerHTML.includes('No signature loaded')) {
      const onScreenHtml = sigDisplay.innerHTML.trim();
      if (onScreenHtml && onScreenHtml.length > 50) {
        currentSig = onScreenHtml;
      }
    }
  }

  const titleEl = document.getElementById('signatureModalTitle');
  if (titleEl) {
    titleEl.innerHTML = `<i class="fa-solid fa-signature text-indigo-600"></i> Email Signature &mdash; <span class="text-indigo-600 font-bold">${escapeHtml(user.name || 'User')}</span>`;
  }
  const nameSpan = document.getElementById('sigActiveUserName');
  const emailSpan = document.getElementById('sigActiveUserEmail');
  if (nameSpan) nameSpan.textContent = user.name || 'User';
  if (emailSpan) emailSpan.textContent = user.email ? `(${user.email})` : '(No email configured)';

  if (visualEditor) {
    visualEditor.innerHTML = currentSig || '';
    setTimeout(() => {
      syncSigToolbarWithSelection();
    }, 50);
  }
  if (modal) modal.classList.add('active');
}

function closeSignatureModal() {
  const modal = document.getElementById('signatureModal');
  if (modal) modal.classList.remove('active');
  _currentSigEditingUser = null;
}

function cleanOutlookHtml(html) {
  if (!html) return '';
  let clean = html;

  // Extract fragment between StartFragment and EndFragment if present from Outlook
  const startFrag = '<!--StartFragment-->';
  const endFrag = '<!--EndFragment-->';
  const sIdx = clean.indexOf(startFrag);
  const eIdx = clean.indexOf(endFrag);
  if (sIdx !== -1 && eIdx !== -1) {
    clean = clean.substring(sIdx + startFrag.length, eIdx).trim();
  }

  // Remove script tags
  clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(clean, 'text/html');

    // 1. Process all table cells
    allTds = doc.querySelectorAll('td');
    allTds.forEach(td => {
      // Ensure vertical alignment is top
      td.style.verticalAlign = 'top';

      // If cell only contains whitespace or &nbsp; and has height or no images/tables, collapse line-height
      const txt = td.textContent.replace(/\u00a0/g, ' ').trim();
      const hasImg = td.querySelector('img');
      const hasTable = td.querySelector('table');
      if (!txt && !hasImg && !hasTable) {
        td.style.fontSize = '0px';
        td.style.lineHeight = '0px';
        td.style.msoLineHeightRule = 'exactly';
      }

      // Check if this is the text cell next to the vertical separator line
      const prev = td.previousElementSibling;
      if (prev && prev.tagName === 'TD') {
        const prevImg = prev.querySelector('img');
        if (prevImg) {
          const w = parseInt(prevImg.getAttribute('width') || prevImg.style.width || '100');
          if (w <= 20) {
            // Guarantee at least 12px left padding so text never touches or collides with the separator line
            const curPad = td.style.paddingLeft ? parseInt(td.style.paddingLeft) : 0;
            if (curPad < 12) {
              td.style.paddingLeft = '12px';
            }
          }
        }
      }
    });

    // 2. Ensure outer tables center nicely and don't collapse
    const tables = doc.querySelectorAll('table');
    tables.forEach(t => {
      t.style.borderCollapse = 'collapse';
      t.style.msoTableLspace = '0pt';
      t.style.msoTableRspace = '0pt';
    });

    return doc.body.innerHTML.trim();
  } catch (_) {
    return clean.trim();
  }
}

async function pasteFromClipboardIntoSignature() {
  const visualEditor = document.getElementById('sigVisualEditor');
  if (!visualEditor) return;

  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        if (item.types.includes('text/html')) {
          const blob = await item.getType('text/html');
          const html = await blob.text();
          visualEditor.innerHTML = cleanOutlookHtml(html);
          showToast('Outlook signature pasted with original layout & resolution!', 'success');
          return;
        } else if (item.types.some(t => t.startsWith('image/'))) {
          const imgType = item.types.find(t => t.startsWith('image/'));
          const blob = await item.getType(imgType);
          const reader = new FileReader();
          reader.onload = (ev) => {
            const dataUrl = ev.target.result;
            const tempImg = new Image();
            tempImg.onload = () => {
              const nw = tempImg.naturalWidth;
              const nh = tempImg.naturalHeight;
              const img = document.createElement('img');
              img.src = dataUrl;
              img.setAttribute('width', nw);
              img.setAttribute('height', nh);
              img.style.width = nw + 'px';
              img.style.height = nh + 'px';
              img.style.maxWidth = '100%';
              img.style.height = 'auto';
              visualEditor.appendChild(img);
              showToast(`Image pasted into signature at exact copied size (${nw} × ${nh} px)!`, 'success');
            };
            tempImg.src = dataUrl;
          };
          reader.readAsDataURL(blob);
          return;
        } else if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          const text = await blob.text();
          visualEditor.innerText = text;
          showToast('Signature text pasted from clipboard!', 'success');
          return;
        }
      }
    }
  } catch (_) {
    // If navigator.clipboard is restricted, focus editor and let user Ctrl+V
  }

  visualEditor.focus();
  showToast('Please press Ctrl + V in the box to paste your signature.', 'info');
}

function clearSignatureInModal() {
  const visualEditor = document.getElementById('sigVisualEditor');
  const sigHtmlSource = document.getElementById('sigHtmlSource');
  if (visualEditor) {
    visualEditor.innerHTML = '';
    visualEditor.focus();
  }
  if (sigHtmlSource) {
    sigHtmlSource.value = '';
    sigHtmlSource.focus();
  }
  showToast('Signature canvas cleared.', 'info');
}

async function saveSignatureFromModal() {
  const btnSave = document.getElementById('btnSaveSignature');
  const origBtnHtml = btnSave ? btnSave.innerHTML : '';
  if (btnSave) {
    btnSave.disabled = true;
    btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }

  try {
    const visualEditor = document.getElementById('sigVisualEditor');
    const sigHtmlSource = document.getElementById('sigHtmlSource');
    if (sigHtmlSource && sigHtmlSource.style.display !== 'none' && visualEditor) {
      visualEditor.innerHTML = sigHtmlSource.value;
    }
    let newSig = visualEditor ? visualEditor.innerHTML.trim() : '';

    // Clean empty tags
    if (newSig === '<p><br></p>' || newSig === '<br>' || newSig === '<div><br></div>' || newSig === '<p></p>') {
      newSig = '';
    }

    if (newSig) {
      newSig = await compressSignatureImages(newSig);
    }

    const user = _currentSigEditingUser || getActiveUser() || {};
    const sigKey = user.signatureKey || (user.id ? `AP_MERIN_SIG_${user.id}` : 'AP_MERIN_SIG_user_1');
    const candidateKeys = getCandidateSignatureKeys(user);

    // 1. Update in-memory cache for all candidate keys immediately
    candidateKeys.forEach(k => {
      window._AP_MERIN_SIG_CACHE[k] = newSig;
    });

    // 2. Persist canonical key to localStorage, clean other aliases from localStorage to save quota
    try {
      if (newSig) {
        localStorage.setItem(sigKey, newSig);
      } else {
        localStorage.removeItem(sigKey);
      }
      candidateKeys.forEach(k => {
        if (k !== sigKey) {
          try { localStorage.removeItem(k); } catch (_) {}
        }
      });
    } catch (quotaErr) {
      console.warn('localStorage setItem quota reached, backing up to IndexedDB:', quotaErr);
    }

    // 3. Persist to IndexedDB for all candidate keys
    try {
      if (window.indexedDB) {
        const db = await new Promise((res, rej) => {
          const req = indexedDB.open('AP_MERIN_SIGNATURES_DB', 1);
          req.onupgradeneeded = (e) => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains('signatures')) {
              d.createObjectStore('signatures');
            }
          };
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        const tx = db.transaction('signatures', 'readwrite');
        const store = tx.objectStore('signatures');
        candidateKeys.forEach(k => {
          if (newSig) store.put(newSig, k);
          else store.delete(k);
        });
      }
    } catch (_) {}

    // 4. Await permanent backend persistence (SQLite & JSON bundle)
    try {
      await fetch('/api/settings/signatures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: sigKey, html: newSig, userId: user.id || '' })
      });
    } catch (backendErr) {
      console.warn('Backend signature sync error:', backendErr);
    }

    const chk = document.getElementById('chkIncludeSignature');
    if (chk) chk.checked = true;

    // Always re-render active signature display immediately
    renderOutlookSignature();

    closeSignatureModal();
    showToast(`Signature saved for ${user.name || 'User'}!`, 'success');
  } catch (err) {
    console.error('Error in saveSignatureFromModal:', err);
    closeSignatureModal();
    showToast('Signature saved!', 'success');
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.innerHTML = origBtnHtml;
    }
  }
}

async function resetSignatureToDefault() {
  const user = _currentSigEditingUser || getActiveUser() || {};
  if (!confirm(`Are you sure you want to reset the signature for ${user.name || 'User'} to the default template? Any custom modifications will be cleared.`)) {
    return;
  }
  const sigKey = user.signatureKey || (user.id ? `AP_MERIN_SIG_${user.id}` : 'AP_MERIN_SIG_user_1');
  const candidateKeys = getCandidateSignatureKeys(user);

  candidateKeys.forEach(k => {
    delete window._AP_MERIN_SIG_CACHE[k];
    try { localStorage.removeItem(k); } catch (_) {}
  });

  await saveSignatureToStorage(sigKey, '', true, user.id || '');

  const defaultSig = getUserDesignatedSignature(user);
  const visualEditor = document.getElementById('sigVisualEditor');
  const sigHtmlSource = document.getElementById('sigHtmlSource');

  if (visualEditor) {
    visualEditor.innerHTML = defaultSig;
  }
  if (sigHtmlSource) {
    sigHtmlSource.value = defaultSig;
  }

  const active = getActiveUser();
  if (active && (active.id === user.id || active.signatureKey === sigKey)) {
    renderOutlookSignature();
  }
  showToast(`Reset to official ${user.name || 'AP Merin'} signature!`, 'success');
}

// RECIPIENT DELIVERY MANAGEMENT
// deliveryGroups: Array of { id: string, emails: string[] }
// - If emails.length === 1 -> Individual delivery (sent separately to that 1 recipient)
// - If emails.length > 1  -> Bulked together delivery (all emails sent together in To: of 1 email)
let deliveryGroups = [];

function parseEmailString(text) {
  if (!text) return [];
  const regex = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g;
  const matches = text.match(regex) || [];
  return matches.map(e => e.trim().toLowerCase());
}

function handleAddCompanyGroup() {
  const emailsInput = document.getElementById('inputCompanyEmails');
  const emailText = emailsInput ? emailsInput.value.trim() : '';

  if (!emailText) {
    showToast('Please enter at least one email address.', 'error');
    return;
  }

  const found = parseEmailString(emailText);
  if (found.length === 0) {
    showToast('No valid email addresses found in input.', 'error');
    return;
  }

  // Deduplicate within the submitted batch
  const uniqueInBatch = Array.from(new Set(found));

  // If 1 email was entered -> Individual delivery
  // If 2 or more emails were entered -> Bulked delivery (sent together in To:)
  deliveryGroups.push({
    id: 'grp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    emails: uniqueInBatch
  });

  // Automatically remember and learn new recipient addresses in contacts database
  autoSaveContacts(uniqueInBatch);

  if (emailsInput) emailsInput.value = '';

  renderRecipientList();

  if (uniqueInBatch.length > 1) {
    showToast(`Compiled ${uniqueInBatch.length} emails into a bulk delivery (sent together in To:)!`, 'success');
  } else {
    showToast(`Added individual recipient: ${uniqueInBatch[0]}`, 'success');
  }
}

function addEmailToGroup(groupId, email) {
  const grp = deliveryGroups.find(g => g.id === groupId);
  if (!grp) return;
  const clean = email.trim().toLowerCase();
  if (!clean || !clean.includes('@')) return;
  if (!grp.emails.includes(clean)) {
    grp.emails.push(clean);
    renderRecipientList();
    showToast(`Added ${clean} to group!`, 'success');
  }
}

function removeEmailFromGroup(groupId, email) {
  const grp = deliveryGroups.find(g => g.id === groupId);
  if (!grp) return;
  grp.emails = grp.emails.filter(e => e !== email);
  if (grp.emails.length === 0) {
    deliveryGroups = deliveryGroups.filter(g => g.id !== groupId);
  }
  renderRecipientList();
}

function removeGroup(groupId) {
  deliveryGroups = deliveryGroups.filter(g => g.id !== groupId);
  renderRecipientList();
}

function splitGroupIntoIndividuals(groupId) {
  const idx = deliveryGroups.findIndex(g => g.id === groupId);
  if (idx === -1) return;
  const grp = deliveryGroups[idx];
  const newItems = grp.emails.map(email => ({
    id: 'grp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    emails: [email]
  }));
  deliveryGroups.splice(idx, 1, ...newItems);
  renderRecipientList();
  showToast(`Split into ${newItems.length} individual email deliveries.`, 'info');
}

function clearAllRecipients() {
  if (deliveryGroups.length === 0) return;
  if (confirm("Clear all recipient deliveries?")) {
    deliveryGroups = [];
    renderRecipientList();
    showToast('All recipients cleared.', 'info');
  }
}

function getAllUniqueEmails() {
  const set = new Set();
  deliveryGroups.forEach(g => {
    (g.emails || []).forEach(e => set.add(e));
  });
  return Array.from(set);
}

function updateRecipientCounts() {
  const recipientCountEl = document.getElementById('recipientCount');
  const companyCountEl = document.getElementById('companyCount');
  const btnSendBatchText = document.getElementById('btnSendBatchText');

  const totalDeliveries = deliveryGroups.length;
  const totalEmails = getAllUniqueEmails().length;

  if (recipientCountEl) {
    if (totalDeliveries === totalEmails) {
      recipientCountEl.textContent = totalEmails;
    } else {
      recipientCountEl.textContent = `${totalEmails} in ${totalDeliveries} emails`;
    }
  }
  if (companyCountEl) companyCountEl.textContent = totalDeliveries;

  if (btnSendBatchText) {
    if (totalDeliveries === 0) {
      btnSendBatchText.textContent = 'Send to All';
    } else if (totalDeliveries === totalEmails) {
      btnSendBatchText.textContent = `Send to All (${totalEmails})`;
    } else {
      btnSendBatchText.textContent = `Send ${totalDeliveries} Email(s) (${totalEmails} recipients)`;
    }
  }
}

function renderRecipientList() {
  const container = document.getElementById('companyGroupsList');
  if (!container) return;

  container.innerHTML = '';

  if (deliveryGroups.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-state-text';
    emptyDiv.id = 'emptyRecipientsText';
    emptyDiv.innerHTML = '<i class="fa-regular fa-envelope-open"></i> No recipients added yet';
    container.appendChild(emptyDiv);
    updateRecipientCounts();
    return;
  }

  deliveryGroups.forEach(grp => {
    // Case 1: Individual Delivery (1 email)
    if (grp.emails.length === 1) {
      const email = grp.emails[0];
      const card = document.createElement('div');
      card.className = 'recipient-single-card';
      card.dataset.id = grp.id;
      card.innerHTML = `
        <div class="recipient-single-left">
          <i class="fa-regular fa-envelope text-slate-400"></i>
          <span class="recipient-email" title="${escapeHtml(email)}">${escapeHtml(email)}</span>
          <span class="badge-single">Individual</span>
        </div>
        <button type="button" class="btn-remove-group" title="Remove ${escapeHtml(email)}">&times;</button>
      `;

      card.querySelector('.btn-remove-group').addEventListener('click', (e) => {
        e.stopPropagation();
        removeGroup(grp.id);
      });

      container.appendChild(card);
    } 
    // Case 2: Bulked Delivery (2+ emails sent together in To:)
    else {
      const card = document.createElement('div');
      card.className = 'recipient-group-card';
      card.dataset.id = grp.id;
      card.innerHTML = `
        <div class="recipient-group-header">
          <div class="recipient-group-title">
            <i class="fa-solid fa-users text-indigo-600"></i>
            <span class="font-bold text-xs text-slate-800">Bulked (${grp.emails.length} emails)</span>
            <span class="badge-together">Sent together in To:</span>
          </div>
          <div class="recipient-group-actions">
            <button type="button" class="btn-group-action btn-split-group" title="Split into individual separate emails">
              <i class="fa-solid fa-arrows-split-up-and-left"></i>
            </button>
            <button type="button" class="btn-group-action btn-add-more-to-group" title="Add another email to this bulk delivery">
              <i class="fa-solid fa-plus"></i>
            </button>
            <button type="button" class="btn-group-action btn-remove-group" title="Remove entire group">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>

        <div class="recipient-group-chips">
          ${grp.emails.map(em => `
            <span class="recipient-tag">
              <span>${escapeHtml(em)}</span>
              <button type="button" class="btn-remove-tag" data-email="${escapeHtml(em)}" title="Remove">&times;</button>
            </span>
          `).join('')}
        </div>

        <div class="inline-add-box" style="display: none;">
          <input type="email" class="form-control form-control-sm inline-email-inp" placeholder="Add email to this delivery...">
          <button type="button" class="btn btn-sm btn-primary inline-add-btn">Add</button>
          <button type="button" class="btn btn-sm btn-outline inline-cancel-btn">Cancel</button>
        </div>
      `;

      // Tag removal listeners
      card.querySelectorAll('.btn-remove-tag').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const emailToRemove = btn.getAttribute('data-email');
          removeEmailFromGroup(grp.id, emailToRemove);
        });
      });

      // Split into individuals listener
      card.querySelector('.btn-split-group').addEventListener('click', (e) => {
        e.stopPropagation();
        splitGroupIntoIndividuals(grp.id);
      });

      // Inline add toggle
      const inlineBox = card.querySelector('.inline-add-box');
      card.querySelector('.btn-add-more-to-group').addEventListener('click', (e) => {
        e.stopPropagation();
        inlineBox.style.display = inlineBox.style.display === 'none' ? 'flex' : 'none';
        if (inlineBox.style.display === 'flex') {
          const inp = inlineBox.querySelector('.inline-email-inp');
          if (inp) inp.focus();
        }
      });

      // Inline add submission
      const saveInline = () => {
        const inp = inlineBox.querySelector('.inline-email-inp');
        const val = inp ? inp.value.trim() : '';
        if (!val) return;
        const found = parseEmailString(val);
        if (found.length === 0) {
          showToast('Please enter a valid email address.', 'error');
          return;
        }
        found.forEach(em => addEmailToGroup(grp.id, em));
      };

      card.querySelector('.inline-add-btn').addEventListener('click', saveInline);
      card.querySelector('.inline-email-inp').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveInline();
        if (e.key === 'Escape') inlineBox.style.display = 'none';
      });
      card.querySelector('.inline-cancel-btn').addEventListener('click', () => {
        inlineBox.style.display = 'none';
      });

      // Remove entire group listener
      card.querySelector('.btn-remove-group').addEventListener('click', (e) => {
        e.stopPropagation();
        removeGroup(grp.id);
      });

      container.appendChild(card);
    }
  });

  updateRecipientCounts();
}

// Backward-compatibility aliases
function renderCompanyGroups() {
  renderRecipientList();
}
function addEmailsToCompanyGroup(rawName, emailList) {
  if (!emailList || emailList.length === 0) return 0;
  const cleanEmails = emailList.map(e => e.trim().toLowerCase()).filter(e => e.includes('@'));
  if (cleanEmails.length === 0) return 0;
  deliveryGroups.push({
    id: 'grp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    emails: Array.from(new Set(cleanEmails))
  });
  renderRecipientList();
  return cleanEmails.length;
}

// CC MANAGEMENT
function updateCcCount() {
  const ccInput = document.getElementById('emailCc');
  const countBadge = document.getElementById('ccCountBadge');
  const countLabel = document.getElementById('ccCountLabel');
  if (!ccInput || !countBadge || !countLabel) return;

  const emails = parseEmailString(ccInput.value);
  countLabel.textContent = `${emails.length} Colleague${emails.length !== 1 ? 's' : ''}`;
  if (emails.length > 0) {
    countBadge.classList.add('has-cc');
  } else {
    countBadge.classList.remove('has-cc');
  }
}

function saveCurrentCcAsDefault() {
  const ccInput = document.getElementById('emailCc');
  const val = ccInput ? ccInput.value.trim() : '';
  const user = getActiveUser();
  if (!user) return;
  user.defaultCc = val;

  if (user.isAdmin) {
    saveAdminUser(user);
  } else {
    const users = getAllUsers();
    const idx = users.findIndex(u => u.id === user.id || (u.email && u.email.toLowerCase() === (user.email || '').toLowerCase()));
    if (idx !== -1) {
      users[idx].defaultCc = val;
      saveAllUsers(users);
    }
  }

  // Also update current active email config in localStorage
  try {
    const storedCfg = localStorage.getItem('AP_MERIN_EMAIL_CONFIG');
    if (storedCfg) {
      const cfg = JSON.parse(storedCfg);
      cfg.default_cc = val;
      localStorage.setItem('AP_MERIN_EMAIL_CONFIG', JSON.stringify(cfg));
    }
  } catch (_) {}

  showToast(`Default CC saved for ${user.name}!`, 'success');
}

// ATTACHMENTS
function handleAttachmentFiles(files) {
  if (!files || files.length === 0) return;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    // Prevent duplicate upload of the exact same file
    const isAlreadyAttached = attachedFiles.some(f => f.name === file.name && f.size === file.size);
    if (isAlreadyAttached) continue;

    const reader = new FileReader();
    reader.onload = (e) => {
      // Secondary check in case reader callbacks race
      if (attachedFiles.some(f => f.name === file.name && f.size === file.size)) return;
      attachedFiles.push({
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        dataUrl: e.target.result
      });
      renderAttachmentsList();
    };
    reader.readAsDataURL(file);
  }
}

function removeAttachment(index) {
  attachedFiles.splice(index, 1);
  renderAttachmentsList();
}

function renderAttachmentsList() {
  const listEl = document.getElementById('attachmentList');
  const countEl = document.getElementById('attachmentCount');
  if (countEl) countEl.textContent = attachedFiles.length;
  if (!listEl) return;

  listEl.innerHTML = '';
  attachedFiles.forEach((file, idx) => {
    const sizeKb = (file.size / 1024).toFixed(1);
    const li = document.createElement('li');
    li.className = 'attachment-item';
    li.innerHTML = `
      <span><i class="fa-solid fa-file text-indigo-600"></i> ${escapeHtml(file.name)} (${sizeKb} KB)</span>
      <span class="remove-att" title="Remove">&times;</span>
    `;
    li.querySelector('.remove-att').addEventListener('click', () => removeAttachment(idx));
    listEl.appendChild(li);
  });
}

// EMAIL SETTINGS MODAL
function openEmailSettingsModal() {
  const modal = document.getElementById('emailSettingsModal');
  const alertEl = document.getElementById('connectionStatusAlert');
  if (alertEl) alertEl.className = 'status-alert hidden';

  const user = getActiveUser();
  syncEmailSettingsWithActiveUser(user);

  if (modal) modal.classList.add('active');
}

function closeEmailSettingsModal() {
  const modal = document.getElementById('emailSettingsModal');
  if (modal) modal.classList.remove('active');
}

function applyProviderPreset(preset) {
  const host = document.getElementById('cfgSmtpHost');
  const port = document.getElementById('cfgSmtpPort');
  const sec = document.getElementById('cfgSecurityMode');

  document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
  const currentBtn = document.querySelector(`.btn-preset[data-preset="${preset}"]`);
  if (currentBtn) currentBtn.classList.add('active');

  if (preset === 'apmerin') {
    if (host) host.value = 'smtppro47.mschosting.network';
    if (port) port.value = '465';
    if (sec) sec.value = 'ssl';
  } else if (preset === 'office365') {
    if (host) host.value = 'smtp.office365.com';
    if (port) port.value = '587';
    if (sec) sec.value = 'tls';
  } else if (preset === 'gmail') {
    if (host) host.value = 'smtp.gmail.com';
    if (port) port.value = '587';
    if (sec) sec.value = 'tls';
    alert('Note for Gmail: Please use an App Password generated in your Google Account security settings.');
  }
}

function saveEmailSettingsFromModal() {
  const senderName = (document.getElementById('cfgSenderName').value || '').trim();
  const username = (document.getElementById('cfgUsername').value || '').trim();
  const password = document.getElementById('cfgPassword').value || '';
  const smtpHost = (document.getElementById('cfgSmtpHost').value || '').trim();
  const smtpPort = parseInt(document.getElementById('cfgSmtpPort').value) || 465;
  const secMode = document.getElementById('cfgSecurityMode').value || 'ssl';
  const defCc = (document.getElementById('cfgDefaultCc').value || '').trim();
  const delaySec = parseFloat(document.getElementById('cfgDelaySeconds').value) || 1.5;

  if (!username || !password || !smtpHost) {
    showToast('Username, Password, and SMTP Host are required.', 'error');
    return;
  }

  // Update active user profile
  const user = getActiveUser();
  user.name = senderName || user.name;
  user.email = username;
  user.password = password;
  user.defaultCc = defCc;

  const users = getAllUsers();
  const idx = users.findIndex(u => u.id === user.id);
  if (idx !== -1) {
    users[idx] = user;
    saveAllUsers(users);
  }

  syncEmailSettingsWithActiveUser(user);
  closeEmailSettingsModal();
  showToast(`Email settings updated for ${user.name}!`, 'success');
}

async function testSmtpConnection() {
  const alertEl = document.getElementById('connectionStatusAlert');
  if (!alertEl) return;
  alertEl.className = 'status-alert';
  alertEl.style.display = 'block';
  alertEl.textContent = 'Connecting to SMTP server...';

  const username = (document.getElementById('cfgUsername').value || '').trim();
  const password = document.getElementById('cfgPassword').value || '';
  const host = (document.getElementById('cfgSmtpHost').value || '').trim();
  const port = parseInt(document.getElementById('cfgSmtpPort').value) || 465;

  if (!username || !password || !host) {
    alertEl.className = 'status-alert error';
    alertEl.textContent = '✗ Please enter Username, Password, and Host first.';
    return;
  }

  const payload = {
    smtp_config: {
      smtp_host: host,
      smtp_port: port,
      username: username,
      password: password
    },
    recipients: [username],
    subject: '[TEST CONNECTION] AP Merin Services',
    html_body: '<p>Connection test successful.</p>'
  };

  try {
    const res = await fetch('/.netlify/functions/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const rawText = await res.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (_) {
      data = { success: false, message: `Server HTTP ${res.status}: ${rawText.slice(0, 100)}` };
    }
    if (data.success) {
      alertEl.className = 'status-alert success';
      alertEl.textContent = '✓ Connected successfully! Credentials and port are verified.';
    } else {
      alertEl.className = 'status-alert error';
      alertEl.textContent = '✗ ' + (data.message || 'Connection failed.');
    }
  } catch (err) {
    alertEl.className = 'status-alert error';
    alertEl.textContent = '✗ Network request failed: ' + err.message;
  }
}

function normalizeFontFamilyStrings(html) {
  if (!html) return '';
  return html
    .replace(/font-family:\s*['"]?trebuchet-ms['"]?/gi, "font-family: 'Trebuchet MS', 'Lucida Sans Unicode', 'Lucida Grande', 'Lucida Sans', Arial, sans-serif")
    .replace(/font-family:\s*['"]?times-new-roman['"]?/gi, "font-family: 'Times New Roman', Times, Baskerville, Georgia, serif")
    .replace(/font-family:\s*['"]?courier-new['"]?/gi, "font-family: 'Courier New', Courier, monospace")
    .replace(/font-family:\s*['"]?lucida-sans['"]?/gi, "font-family: 'Lucida Sans', 'Lucida Sans Unicode', 'Lucida Grande', sans-serif")
    .replace(/font-family:\s*['"]?calibri['"]?/gi, "font-family: Calibri, Candara, Segoe, 'Segoe UI', sans-serif")
    .replace(/font-family:\s*['"]?arial['"]?/gi, "font-family: Arial, Helvetica, sans-serif");
}

function normalizeMessageBodyHtml(html) {
  if (!html) return '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Ensure all paragraphs and block text carry standard corporate font-size: 13.5px / 10pt (prevents oversized 16px rendering in Outlook/Gmail)
    doc.querySelectorAll('p, div, li, h1, h2, h3').forEach(el => {
      if (el.closest('.email-signature') || el.classList.contains('email-signature')) return;

      let style = el.getAttribute('style') || '';
      let styleParts = style.split(';').map(s => s.trim()).filter(Boolean);

      let hasFontSize = false;
      let hasFontFamily = false;
      let hasLineHeight = false;
      let hasColor = false;

      styleParts = styleParts.map(part => {
        const low = part.toLowerCase();
        if (low.startsWith('font-size')) hasFontSize = true;
        if (low.startsWith('font-family')) hasFontFamily = true;
        if (low.startsWith('line-height')) hasLineHeight = true;
        if (low.startsWith('color')) hasColor = true;
        return part;
      });

      // Standard business email typography
      if (!hasFontSize) {
        styleParts.push('font-size: 13.5px');
      }
      if (!hasFontFamily) {
        styleParts.push("font-family: 'Trebuchet MS', 'Lucida Sans Unicode', 'Lucida Grande', 'Lucida Sans', Arial, sans-serif");
      }
      if (!hasLineHeight) {
        styleParts.push('line-height: 1.5');
      }
      if (!hasColor) {
        styleParts.push('color: #000000');
      }

      el.setAttribute('style', styleParts.join('; '));
    });

    return normalizeFontFamilyStrings(doc.body.innerHTML);
  } catch (e) {
    return normalizeFontFamilyStrings(html);
  }
}

// EML EXPORT & DISPATCH COMPILATION
function getFullEmailHtml() {
  let messageBody = quill ? quill.root.innerHTML : '';
  const chkSig = document.getElementById('chkIncludeSignature');
  const isIncluded = chkSig ? chkSig.checked : true;

  const user = getActiveUser();
  let sigHtml = '';

  // Prioritize active on-screen signature display if present
  const sigDisplay = document.getElementById('outlookSignatureDisplay');
  if (sigDisplay && sigDisplay.innerHTML && !sigDisplay.innerHTML.includes('No signature loaded')) {
    const onScreenHtml = sigDisplay.innerHTML.trim();
    if (onScreenHtml && onScreenHtml.length > 50) {
      sigHtml = onScreenHtml;
    }
  }
  if (!sigHtml) {
    sigHtml = getUserDesignatedSignature(user);
  }

  messageBody = normalizeMessageBodyHtml(messageBody);

  if (isIncluded && sigHtml) {
    sigHtml = normalizeFontFamilyStrings(sigHtml);
    return `<div style="color: #000000;">${messageBody}</div><br><br><div class="email-signature" style="color: #000000;">${sigHtml}</div>`;
  }
  return `<div style="color: #000000;">${messageBody}</div>`;
}

function exportCurrentEmailAsEml() {
  const subject = (document.getElementById('emailSubject').value || 'Quotation - AP Merin Services').trim();
  const rawHtml = getFullEmailHtml();
  const toList = getAllUniqueEmails();
  const ccText = document.getElementById('emailCc').value || '';
  const ccList = parseEmailString(ccText);
  const user = getActiveUser();
  const fromAddr = user.email || 'project@apmerinservices.com.my';
  const fromName = user.name || 'AP Merin Services';

  const boundaryMixed = '----=_Part_Mixed_' + Math.random().toString(36).substring(2);
  const boundaryRelated = '----=_Part_Related_' + Math.random().toString(36).substring(2);

  // Extract inline images: data:(image/...);base64,...
  const inlineImages = [];
  const processedHtml = (rawHtml || '').replace(/src=["']data:(image\/[^;]+);base64,([^"']+)["']/gi, (match, mimeType, b64Data) => {
    const ext = mimeType.split('/')[1] || 'png';
    const cid = `image_${inlineImages.length}_${Date.now()}@apmerin.local`;
    const filename = `photo_${inlineImages.length + 1}.${ext}`;
    inlineImages.push({
      cid,
      mimeType,
      filename,
      base64Data: b64Data.replace(/\s+/g, '')
    });
    return `src="cid:${cid}"`;
  });

  const hasInlineImages = inlineImages.length > 0;
  const hasAttachments = attachedFiles && attachedFiles.length > 0;

  let eml = '';
  eml += `From: "${fromName}" <${fromAddr}>\r\n`;
  eml += `To: ${toList.length > 0 ? toList.join(', ') : fromAddr}\r\n`;
  if (ccList.length > 0) {
    eml += `Cc: ${ccList.join(', ')}\r\n`;
  }
  eml += `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=\r\n`;
  eml += `Date: ${new Date().toUTCString()}\r\n`;
  eml += `MIME-Version: 1.0\r\n`;

  function buildEmlRelated() {
    let part = '';
    part += `--${boundaryRelated}\r\n`;
    part += `Content-Type: text/html; charset="UTF-8"\r\n`;
    part += `Content-Transfer-Encoding: base64\r\n\r\n`;
    const b64Body = btoa(unescape(encodeURIComponent(processedHtml)));
    const chunks = b64Body.match(/.{1,76}/g) || [];
    part += chunks.join('\r\n') + '\r\n\r\n';

    for (const img of inlineImages) {
      part += `--${boundaryRelated}\r\n`;
      part += `Content-Type: ${img.mimeType}; name="${img.filename}"\r\n`;
      part += `Content-Transfer-Encoding: base64\r\n`;
      part += `Content-ID: <${img.cid}>\r\n`;
      part += `Content-Disposition: inline; filename="${img.filename}"\r\n\r\n`;
      const imgChunks = img.base64Data.match(/.{1,76}/g) || [];
      part += imgChunks.join('\r\n') + '\r\n\r\n';
    }
    part += `--${boundaryRelated}--\r\n`;
    return part;
  }

  if (!hasInlineImages && !hasAttachments) {
    eml += `Content-Type: text/html; charset="UTF-8"\r\n`;
    eml += `Content-Transfer-Encoding: base64\r\n\r\n`;
    const b64Body = btoa(unescape(encodeURIComponent(processedHtml)));
    const chunks = b64Body.match(/.{1,76}/g) || [];
    eml += chunks.join('\r\n') + '\r\n';
  } else if (hasInlineImages && !hasAttachments) {
    eml += `Content-Type: multipart/related; boundary="${boundaryRelated}"\r\n\r\n`;
    eml += buildEmlRelated();
  } else {
    eml += `Content-Type: multipart/mixed; boundary="${boundaryMixed}"\r\n\r\n`;
    if (hasInlineImages) {
      eml += `--${boundaryMixed}\r\n`;
      eml += `Content-Type: multipart/related; boundary="${boundaryRelated}"\r\n\r\n`;
      eml += buildEmlRelated() + '\r\n';
    } else {
      eml += `--${boundaryMixed}\r\n`;
      eml += `Content-Type: text/html; charset="UTF-8"\r\n`;
      eml += `Content-Transfer-Encoding: base64\r\n\r\n`;
      const b64Body = btoa(unescape(encodeURIComponent(processedHtml)));
      const chunks = b64Body.match(/.{1,76}/g) || [];
      eml += chunks.join('\r\n') + '\r\n\r\n';
    }

    for (const att of attachedFiles) {
      let b64 = att.dataUrl || '';
      if (b64.includes('base64,')) {
        b64 = b64.split('base64,')[1];
      }
      b64 = b64.replace(/\s+/g, '');
      eml += `--${boundaryMixed}\r\n`;
      eml += `Content-Type: ${att.type || 'application/octet-stream'}; name="${att.name}"\r\n`;
      eml += `Content-Transfer-Encoding: base64\r\n`;
      eml += `Content-Disposition: attachment; filename="${att.name}"\r\n\r\n`;
      const attChunks = b64.match(/.{1,76}/g) || [];
      eml += attChunks.join('\r\n') + '\r\n\r\n';
    }
    eml += `--${boundaryMixed}--\r\n`;
  }

  const blob = new Blob([eml], { type: 'message/rfc822' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${subject.replace(/[^a-zA-Z0-9_-]/g, '_') || 'Email_Draft'}.eml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Downloaded .EML draft with all inline photos & attachments!', 'success');
}

// TEST EMAIL
function openTestEmailModal() {
  const modal = document.getElementById('testEmailModal');
  const inp = document.getElementById('inputTestEmail');
  const user = getActiveUser();
  if (inp && !inp.value) inp.value = user.email || 'project@apmerinservices.com.my';
  if (modal) modal.classList.add('active');
}

function closeTestEmailModal() {
  const modal = document.getElementById('testEmailModal');
  if (modal) modal.classList.remove('active');
}

async function triggerTestSend() {
  const testEmail = (document.getElementById('inputTestEmail').value || '').trim();
  if (!testEmail || !testEmail.includes('@')) {
    showToast('Please enter a valid test recipient email.', 'error');
    return;
  }

  const subject = (document.getElementById('emailSubject').value || '').trim();
  const htmlBody = getFullEmailHtml();
  const ccText = document.getElementById('emailCc').value;
  const includeCc = document.getElementById('chkTestIncludeCc') ? document.getElementById('chkTestIncludeCc').checked : false;
  const ccEmails = includeCc ? parseEmailString(ccText) : [];

  if (!subject) {
    showToast('Please enter an email subject.', 'error');
    return;
  }
  if (!htmlBody || htmlBody === '<p><br></p>') {
    showToast('Email body cannot be empty.', 'error');
    return;
  }

  closeTestEmailModal();

  const user = getActiveUser();
  const payload = {
    recipients: [{ company: 'Self Test', emails: [testEmail] }],
    subject: '[TEST] ' + subject,
    html_body: htmlBody,
    cc_emails: ccEmails,
    attachments: attachedFiles.map(f => ({
      name: f.name,
      size: f.size,
      type: f.type,
      dataUrl: f.dataUrl
    })),
    smtp_config: {
      smtp_host: 'smtppro47.mschosting.network',
      smtp_port: 465,
      username: user.email,
      password: user.password,
      sender_name: user.name,
      sender_email: user.email
    }
  };

  executeDispatch(payload, `Sending Test Email to ${testEmail}...`);
}

// BATCH SENDING (DISPATCHES EACH DELIVERY GROUP: BULKED OR INDIVIDUAL)
async function triggerBatchSend() {
  if (deliveryGroups.length === 0) {
    showToast('Please add at least one recipient email address.', 'error');
    return;
  }

  const subject = (document.getElementById('emailSubject').value || '').trim();
  const htmlBody = getFullEmailHtml();
  const ccText = document.getElementById('emailCc').value;
  const ccEmails = parseEmailString(ccText);

  if (!subject) {
    showToast('Please enter an email subject.', 'error');
    return;
  }
  if (!htmlBody || htmlBody === '<p><br></p>') {
    showToast('Email body cannot be empty.', 'error');
    return;
  }

  // Each deliveryGroup represents one email transmission:
  // - 1 email in group: sent individually to that person
  // - 2+ emails in group: bulked together and sent in the same To: header
  const targetRecipients = deliveryGroups.map(grp => ({
    company: grp.emails.length > 1 ? `Bulked (${grp.emails.length})` : '',
    emails: grp.emails
  }));

  const totalDeliveries = deliveryGroups.length;
  const totalEmails = getAllUniqueEmails().length;

  let confirmMsg = `Are you ready to dispatch ${totalDeliveries} email(s) (${totalEmails} total recipient${totalEmails !== 1 ? 's' : ''})?\n\n`;
  confirmMsg += `Delivery Breakdown:\n`;
  deliveryGroups.slice(0, 8).forEach((grp, i) => {
    if (grp.emails.length > 1) {
      confirmMsg += `${i + 1}. [BULK TOGETHER] ${grp.emails.join(', ')}\n`;
    } else {
      confirmMsg += `${i + 1}. [INDIVIDUAL] ${grp.emails[0]}\n`;
    }
  });
  if (deliveryGroups.length > 8) {
    confirmMsg += `...and ${deliveryGroups.length - 8} more deliveries.\n`;
  }

  if (ccEmails.length > 0) {
    confirmMsg += `\nCC: ${ccEmails.join(', ')} will be copied on each email.`;
  }

  if (!confirm(confirmMsg)) return;

  const user = getActiveUser();
  const payload = {
    recipients: targetRecipients,
    subject: subject,
    html_body: htmlBody,
    cc_emails: ccEmails,
    attachments: attachedFiles.map(f => ({
      name: f.name,
      size: f.size,
      type: f.type,
      dataUrl: f.dataUrl
    })),
    smtp_config: {
      smtp_host: 'smtppro47.mschosting.network',
      smtp_port: 465,
      username: user.email,
      password: user.password,
      sender_name: user.name,
      sender_email: user.email
    }
  };

  const title = `Dispatching ${totalDeliveries} Email(s) (${totalEmails} recipients)...`;
  executeDispatch(payload, title);
}

// DISPATCH EXECUTION (PROGRESSIVE SEQUENTIAL DISPATCH WITH SAFE ERROR HANDLING)
let isDispatchCancelled = false;

async function executeDispatch(payload, title) {
  const modal = document.getElementById('emailProgressModal');
  const titleEl = document.getElementById('emailProgressModalTitle');
  const bar = document.getElementById('progressBarFill');
  const pct = document.getElementById('progressPercentage');
  const counts = document.getElementById('progressCounts');
  const statTot = document.getElementById('statTotal');
  const statSent = document.getElementById('statSent');
  const statFail = document.getElementById('statFailed');
  const logBody = document.getElementById('progressLogBody');

  const btnCancel = document.getElementById('btnCancelBatch');
  const btnDone = document.getElementById('btnFinishProgress');
  const btnClose = document.getElementById('btnCloseProgress');

  isDispatchCancelled = false;
  const deliveryList = payload.recipients || [];
  const total = deliveryList.length;

  // Auto-save all dispatched recipients and CC in contacts database
  const allDispatched = [];
  deliveryList.forEach(r => {
    if (r.to_emails && Array.isArray(r.to_emails)) {
      r.to_emails.forEach(e => allDispatched.push(e));
    }
    if (r.email) allDispatched.push(r.email);
  });
  if (payload.cc_emails && Array.isArray(payload.cc_emails)) {
    payload.cc_emails.forEach(e => allDispatched.push(e));
  }
  autoSaveContacts(allDispatched);

  titleEl.innerHTML = `<i class="fa-solid fa-paper-plane fa-spin text-indigo-600"></i> ${title}`;
  bar.style.width = '0%';
  pct.textContent = '0%';
  counts.textContent = `0 of ${total} dispatched`;
  statTot.textContent = total;
  statSent.textContent = '0';
  statFail.textContent = '0';
  logBody.innerHTML = '';

  btnCancel.style.display = 'inline-flex';
  btnDone.style.display = 'none';
  btnClose.style.display = 'none';

  modal.classList.add('active');

  let sentCount = 0;
  let failCount = 0;

  try {
    // Send each delivery group individually to guarantee no serverless timeouts
    for (let i = 0; i < total; i++) {
      if (isDispatchCancelled) {
        showToast('Dispatch stopped by user.', 'info');
        break;
      }

      const currentItem = deliveryList[i];
      const targetDisplay = (currentItem.emails || []).join(', ') || currentItem.company || `Recipient ${i + 1}`;

      // Live progress title
      titleEl.innerHTML = `<i class="fa-solid fa-paper-plane fa-spin text-indigo-600"></i> Sending ${i + 1} of ${total}: <strong>${escapeHtml(targetDisplay)}</strong>...`;

      const singlePayload = {
        ...payload,
        recipients: [currentItem]
      };

      try {
        const res = await fetch('/.netlify/functions/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(singlePayload)
        });

        const rawText = await res.text();
        let data;
        try {
          data = JSON.parse(rawText);
        } catch (jsonErr) {
          // Gracefully handle any HTML error page (e.g. 504 Gateway Timeout or 500 error)
          data = {
            success: false,
            message: res.status >= 500 
              ? `Server error (${res.status}). Function execution timed out or failed.` 
              : `Unexpected response (${res.status}): ${rawText.slice(0, 100)}`
          };
        }

        const now = new Date().toLocaleTimeString();
        const tr = document.createElement('tr');

        if (data.success && (data.sentCount > 0 || (data.results && data.results[0] && data.results[0].status === 'sent'))) {
          sentCount++;
          statSent.textContent = sentCount;
          tr.innerHTML = `
            <td>${now}</td>
            <td><i class="fa-regular fa-envelope text-slate-400 mr-1.5"></i><strong>${escapeHtml(targetDisplay)}</strong></td>
            <td><span class="badge badge-success">SENT</span></td>
            <td class="text-slate-500">Sent successfully</td>
          `;
        } else {
          failCount++;
          statFail.textContent = failCount;
          const errMsg = data.message || (data.results && data.results[0] && data.results[0].message) || 'Transmission error';
          tr.innerHTML = `
            <td>${now}</td>
            <td><i class="fa-regular fa-envelope text-slate-400 mr-1.5"></i><strong>${escapeHtml(targetDisplay)}</strong></td>
            <td><span class="badge badge-danger">FAILED</span></td>
            <td class="text-rose-600">${escapeHtml(errMsg)}</td>
          `;
        }
        logBody.appendChild(tr);

      } catch (reqErr) {
        failCount++;
        statFail.textContent = failCount;
        const now = new Date().toLocaleTimeString();
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${now}</td>
          <td><i class="fa-regular fa-envelope text-slate-400 mr-1.5"></i><strong>${escapeHtml(targetDisplay)}</strong></td>
          <td><span class="badge badge-danger">ERROR</span></td>
          <td class="text-rose-600">${escapeHtml(reqErr.message)}</td>
        `;
        logBody.appendChild(tr);
      }

      // Update progress bar
      const completedCount = i + 1;
      const percent = Math.round((completedCount / total) * 100);
      bar.style.width = `${percent}%`;
      pct.textContent = `${percent}%`;
      counts.textContent = `${completedCount} of ${total} processed`;

      // Polite pause between dispatches to respect mail server rate limits
      if (i < total - 1 && !isDispatchCancelled) {
        await new Promise(r => setTimeout(r, 600));
      }
    }

    if (isDispatchCancelled) {
      titleEl.innerHTML = `<i class="fa-solid fa-ban text-amber-600"></i> Dispatch Cancelled (${sentCount} sent, ${failCount} failed)`;
    } else if (sentCount === total) {
      titleEl.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-600"></i> All ${total} Email(s) Dispatched Successfully!`;
      showToast(`Dispatched all ${total} email(s) successfully!`, 'success');
    } else if (sentCount > 0) {
      titleEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-amber-600"></i> Completed: ${sentCount} sent, ${failCount} failed`;
      showToast(`Dispatched ${sentCount} of ${total} email(s).`, 'warning');
    } else {
      const firstErr = logBody.querySelector('.text-rose-600') ? logBody.querySelector('.text-rose-600').textContent : '';
      if (firstErr.includes('535') || firstErr.toLowerCase().includes('authentication failed') || firstErr.toLowerCase().includes('password')) {
        titleEl.innerHTML = `<i class="fa-solid fa-key text-rose-600"></i> Authentication Failed: Check Email Password`;
        showToast('SMTP Authentication Failed: Incorrect email password or username. Please check your credentials in Email Settings.', 'error');
      } else {
        titleEl.innerHTML = `<i class="fa-solid fa-circle-xmark text-rose-600"></i> Dispatch Failed (0 of ${total} sent)`;
        showToast(firstErr || 'Dispatch failed. Please check your credentials or network connection.', 'error');
      }
    }

  } finally {
    btnCancel.style.display = 'none';
    btnDone.style.display = 'inline-flex';
    btnClose.style.display = 'block';
  }
}

function closeProgressModal() {
  const modal = document.getElementById('emailProgressModal');
  if (modal) modal.classList.remove('active');
}

// CLEAR STUDIO WORKSPACE
function clearEmailStudio(showToastMsg = true) {
  // 1. Reset recipients
  deliveryGroups = [];
  companyGroups = [];
  renderRecipientList();
  updateRecipientCounts();

  // 2. Clear inputs
  const subjectEl = document.getElementById('emailSubject');
  if (subjectEl) subjectEl.value = '';
  const inputEmails = document.getElementById('inputCompanyEmails');
  if (inputEmails) inputEmails.value = '';
  const inputCompName = document.getElementById('inputCompanyName');
  if (inputCompName) inputCompName.value = '';
  const bccEl = document.getElementById('emailBcc');
  if (bccEl) bccEl.value = '';

  // 3. Reset CC to active user's default CC
  const user = getActiveUser();
  const ccEl = document.getElementById('emailCc');
  if (ccEl) {
    ccEl.value = (user && user.defaultCc) ? user.defaultCc : '';
  }

  // 4. Clear Quill body editor and re-render clean Outlook signature
  if (quill) {
    quill.setText('');
  }
  renderOutlookSignature();

  // 5. Clear attachments
  attachedFiles = [];
  renderAttachmentsList();

  if (showToastMsg) showToast('Email Studio workspace cleared.', 'info');
}

window.clearEmailStudio = clearEmailStudio;

// INITIALIZATION
let _emailStudioInitialized = false;
function initEmailStudio() {
  if (_emailStudioInitialized) return;
  _emailStudioInitialized = true;
  const user = getActiveUser();
  updateActiveUserHeaderUI(user);
  syncEmailSettingsWithActiveUser(user);

  // Initialize Quill editor immediately
  initQuillEditor();

  // Clear Studio Button
  const btnClearStudio = document.getElementById('btnClearEmailStudio');
  if (btnClearStudio) btnClearStudio.addEventListener('click', () => clearEmailStudio(true));

  // Signature Buttons
  const btnOpenSig = document.getElementById('btnOpenSignature');
  if (btnOpenSig) btnOpenSig.addEventListener('click', () => openSignatureModal());
  const btnEditSig = document.getElementById('btnEditSignature');
  if (btnEditSig) btnEditSig.addEventListener('click', () => openSignatureModal());
  const btnCloseSig = document.getElementById('btnCloseSignature');
  if (btnCloseSig) btnCloseSig.addEventListener('click', closeSignatureModal);
  const sigModal = document.getElementById('signatureModal');
  if (sigModal) {
    sigModal.addEventListener('click', (e) => {
      if (e.target === sigModal) closeSignatureModal();
    });
  }
  const btnPasteSig = document.getElementById('btnPasteClipboardSig');
  if (btnPasteSig) btnPasteSig.addEventListener('click', pasteFromClipboardIntoSignature);
  const btnClearSig = document.getElementById('btnClearSigEditor');
  if (btnClearSig) btnClearSig.addEventListener('click', clearSignatureInModal);

  const visualEditor = document.getElementById('sigVisualEditor');
  if (visualEditor) {
    visualEditor.addEventListener('paste', (e) => {
      e.stopPropagation();

      let html = '';
      if (e.clipboardData) {
        html = e.clipboardData.getData('text/html');
      } else if (window.clipboardData) {
        html = window.clipboardData.getData('Text');
      }

      if (html && html.trim().length > 0) {
        e.preventDefault();
        const clean = cleanOutlookHtml(html);
        visualEditor.innerHTML = clean;
        showToast('Outlook signature pasted with original layout & resolution!', 'success');
      } else if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
        const file = e.clipboardData.files[0];
        if (file.type.startsWith('image/')) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = (ev) => {
            const dataUrl = ev.target.result;
            const tempImg = new Image();
            tempImg.onload = () => {
              const nw = tempImg.naturalWidth;
              const nh = tempImg.naturalHeight;
              const img = document.createElement('img');
              img.src = dataUrl;
              img.setAttribute('width', nw);
              img.setAttribute('height', nh);
              img.style.width = nw + 'px';
              img.style.height = nh + 'px';
              img.style.maxWidth = '100%';
              img.style.height = 'auto';
              visualEditor.appendChild(img);
              showToast(`Image pasted into signature at exact copied size (${nw} × ${nh} px)!`, 'success');
            };
            tempImg.src = dataUrl;
          };
          reader.readAsDataURL(file);
        }
      }
    });

    visualEditor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveSignatureFromModal();
      }
    });
  }
  const btnResetSig = document.getElementById('btnResetDefaultSignature');
  if (btnResetSig) btnResetSig.addEventListener('click', resetSignatureToDefault);
  const btnSaveSig = document.getElementById('btnSaveSignature');
  if (btnSaveSig) btnSaveSig.addEventListener('click', saveSignatureFromModal);

  async function hydrateFromBackendStore() {
    try {
      const res = await fetch('/api/settings/users');
      if (res.ok) {
        const data = await res.json();
        if (data && data.bundle) {
          const bundle = data.bundle;
          if (Array.isArray(bundle.users) && bundle.users.length > 0) {
            localStorage.setItem('AP_MERIN_SYSTEM_USERS', JSON.stringify(bundle.users));
          }
          if (bundle.admin) {
            localStorage.setItem('AP_MERIN_ADMIN_USER', JSON.stringify(bundle.admin));
          }
          if (bundle.active_user_id && !localStorage.getItem('AP_MERIN_ACTIVE_USER_ID')) {
            localStorage.setItem('AP_MERIN_ACTIVE_USER_ID', bundle.active_user_id);
          }
        }
      }
    } catch (err) {
      console.warn('Backend user hydration error:', err);
    }

    try {
      const res = await fetch('/api/settings/signatures');
      if (res.ok) {
        const data = await res.json();
        if (data && data.signatures) {
          const curUser = getActiveUser() || {};
          const curUserSigKey = curUser.signatureKey || (curUser.id ? `AP_MERIN_SIG_${curUser.id}` : 'AP_MERIN_SIG_user_1');
          for (const [key, html] of Object.entries(data.signatures)) {
            if (html && html.trim()) {
              window._AP_MERIN_SIG_CACHE[key] = html;
              if (key === curUserSigKey) {
                try { localStorage.setItem(key, html); } catch (_) {}
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('Backend signature hydration error:', err);
    }

    const curUser = getActiveUser();
    if (curUser) {
      updateActiveUserHeaderUI(curUser);
      syncEmailSettingsWithActiveUser(curUser);
      renderOutlookSignature();
    }
    return true;
  }

  // Expose globally for app.js and login hydration
  window.hydrateFromBackendStore = hydrateFromBackendStore;
  window.getAllUsers = getAllUsers;
  window.saveAllUsers = saveAllUsers;
  window.getAdminUser = getAdminUser;
  window.saveAdminUser = saveAdminUser;
  window.getActiveUser = getActiveUser;
  window.setActiveUser = setActiveUser;
  window.syncUsersToBackend = syncUsersToBackend;

  // Preload any persistent signatures from IndexedDB and Backend Dual-Store
  preloadSignaturesFromIndexedDB();
  hydrateFromBackendStore();

  // Signature checkbox toggle
  const chkSig = document.getElementById('chkIncludeSignature');
  if (chkSig) {
    chkSig.addEventListener('change', renderOutlookSignature);
  }

  // Email Settings Modal
  const btnOpenSettings = document.getElementById('btnOpenEmailSettings');
  if (btnOpenSettings) btnOpenSettings.addEventListener('click', openEmailSettingsModal);
  const btnCloseSettings = document.getElementById('btnCloseEmailSettings');
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeEmailSettingsModal);
  const btnSaveEmailSettings = document.getElementById('btnSaveEmailSettings');
  if (btnSaveEmailSettings) btnSaveEmailSettings.addEventListener('click', saveEmailSettingsFromModal);
  const btnTestConn = document.getElementById('btnTestConnection');
  if (btnTestConn) btnTestConn.addEventListener('click', testSmtpConnection);

  // Preset buttons
  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const preset = e.currentTarget.getAttribute('data-preset');
      applyProviderPreset(preset);
    });
  });

  // Company and Recipient Management
  const btnAddCompanyGroup = document.getElementById('btnAddCompanyGroup');
  if (btnAddCompanyGroup) btnAddCompanyGroup.addEventListener('click', handleAddCompanyGroup);
  const inputCompanyEmails = document.getElementById('inputCompanyEmails');
  if (inputCompanyEmails) {
    inputCompanyEmails.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAddCompanyGroup();
    });
  }
  const btnClearRecipients = document.getElementById('btnClearRecipients');
  if (btnClearRecipients) btnClearRecipients.addEventListener('click', clearAllRecipients);
  const chkGroupPerCompany = document.getElementById('chkGroupPerCompany');
  if (chkGroupPerCompany) chkGroupPerCompany.addEventListener('change', updateRecipientCounts);

  // CC
  const ccInput = document.getElementById('emailCc');
  if (ccInput) ccInput.addEventListener('input', updateCcCount);
  const btnSaveDefaultCc = document.getElementById('btnSaveDefaultCc');
  if (btnSaveDefaultCc) btnSaveDefaultCc.addEventListener('click', saveCurrentCcAsDefault);

  // Attachments Drag & Drop
  const dropZone = document.getElementById('dropZone');
  const fileAttInput = document.getElementById('fileAttachmentInput');
  if (dropZone && fileAttInput) {
    dropZone.addEventListener('click', (e) => {
      if (e.target !== fileAttInput) {
        fileAttInput.click();
      }
    });
    fileAttInput.addEventListener('click', (e) => e.stopPropagation());
    fileAttInput.addEventListener('change', (e) => {
      handleAttachmentFiles(e.target.files);
      fileAttInput.value = '';
    });
    ['dragenter', 'dragover'].forEach(name => {
      dropZone.addEventListener(name, (e) => { e.preventDefault(); dropZone.classList.add('dropzone-active'); });
    });
    ['dragleave', 'drop'].forEach(name => {
      dropZone.addEventListener(name, (e) => { e.preventDefault(); dropZone.classList.remove('dropzone-active'); });
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files) handleAttachmentFiles(e.dataTransfer.files);
    });
  }

  // Dispatch and Export Buttons
  const btnExportEml = document.getElementById('btnExportEml');
  if (btnExportEml) btnExportEml.addEventListener('click', exportCurrentEmailAsEml);
  const btnTestEmail = document.getElementById('btnTestEmail');
  if (btnTestEmail) btnTestEmail.addEventListener('click', openTestEmailModal);
  const btnCloseTest = document.getElementById('btnCloseTestEmail');
  if (btnCloseTest) btnCloseTest.addEventListener('click', closeTestEmailModal);
  const btnConfirmTest = document.getElementById('btnConfirmSendTest');
  if (btnConfirmTest) btnConfirmTest.addEventListener('click', triggerTestSend);
  const btnSendBatch = document.getElementById('btnSendBatch');
  if (btnSendBatch) btnSendBatch.addEventListener('click', triggerBatchSend);

  // Progress Modal
  const btnCancelBatch = document.getElementById('btnCancelBatch');
  if (btnCancelBatch) {
    btnCancelBatch.addEventListener('click', () => {
      isDispatchCancelled = true;
      showToast('Stopping dispatch...', 'info');
    });
  }
  const btnFinishProgress = document.getElementById('btnFinishProgress');
  if (btnFinishProgress) btnFinishProgress.addEventListener('click', closeProgressModal);
  const btnCloseProgress = document.getElementById('btnCloseProgress');
  if (btnCloseProgress) btnCloseProgress.addEventListener('click', closeProgressModal);

  renderOutlookSignature();
  renderCompanyGroups();

  // Initialize Autocomplete and Address Book
  initRecipientAutocomplete();
  initAddressBookModal();
}

// ============================================================
// AUTOCOMPLETE SUGGESTIONS & AUTO-LEARN LOGIC
// ============================================================
let cachedContacts = [];
let activeAutocompleteTarget = null;
let activeAutocompleteIndex = -1;
let currentAutocompleteMatches = [];

async function loadContactsCache() {
  try {
    const res = await fetch('/api/contacts?limit=500');
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.contacts)) {
        cachedContacts = data.contacts;
        localStorage.setItem('ap_merin_cached_contacts', JSON.stringify(cachedContacts));
      }
    }
  } catch (e) {
    const saved = localStorage.getItem('ap_merin_cached_contacts');
    if (saved) {
      try { cachedContacts = JSON.parse(saved); } catch (err) {}
    }
  }
}

function autoSaveContacts(list) {
  if (!list || list.length === 0) return;
  fetch('/api/contacts/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contacts: list })
  }).then(res => res.json()).then(d => {
    if (d.success) loadContactsCache();
  }).catch(() => {});
}

function initRecipientAutocomplete() {
  const dropdown = document.getElementById('emailAutocompleteDropdown');
  const inputCompanyEmails = document.getElementById('inputCompanyEmails');
  const inputCc = document.getElementById('emailCc');

  if (!dropdown) return;

  loadContactsCache();

  [inputCompanyEmails, inputCc].forEach(inputEl => {
    if (!inputEl) return;

    inputEl.addEventListener('input', (e) => {
      handleAutocompleteInput(e.target);
    });

    inputEl.addEventListener('keydown', (e) => {
      handleAutocompleteKeydown(e, inputEl);
    });

    inputEl.addEventListener('blur', () => {
      setTimeout(() => {
        if (activeAutocompleteTarget === inputEl) {
          hideAutocompleteDropdown();
        }
      }, 250);
    });
  });

  document.addEventListener('click', (e) => {
    if (dropdown && !dropdown.contains(e.target) && e.target !== inputCompanyEmails && e.target !== inputCc) {
      hideAutocompleteDropdown();
    }
  });
}

function handleAutocompleteInput(inputEl) {
  const dropdown = document.getElementById('emailAutocompleteDropdown');
  if (!dropdown) return;

  const val = inputEl.value;
  const cursorPos = inputEl.selectionStart || val.length;
  const textBefore = val.slice(0, cursorPos);
  const tokens = textBefore.split(/[,;\n\r]+/);
  const currentToken = (tokens[tokens.length - 1] || '').trim();

  if (!currentToken || currentToken.length < 1) {
    hideAutocompleteDropdown();
    return;
  }

  const q = currentToken.toLowerCase();
  currentAutocompleteMatches = cachedContacts.filter(c => {
    return (c.name && c.name.toLowerCase().includes(q)) ||
           (c.email && c.email.toLowerCase().includes(q)) ||
           (c.company && c.company.toLowerCase().includes(q));
  }).slice(0, 8);

  if (currentAutocompleteMatches.length === 0) {
    hideAutocompleteDropdown();
    return;
  }

  activeAutocompleteTarget = inputEl;
  activeAutocompleteIndex = 0;
  renderAutocompleteDropdown(currentAutocompleteMatches, q, inputEl);
}

function renderAutocompleteDropdown(matches, query, inputEl) {
  const dropdown = document.getElementById('emailAutocompleteDropdown');
  if (!dropdown) return;

  dropdown.innerHTML = matches.map((c, idx) => {
    const initials = (c.name || c.email).split(/\s+/).map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const isActive = idx === activeAutocompleteIndex ? 'active' : '';
    const nameHighlight = highlightMatch(c.name || '', query);
    const emailHighlight = highlightMatch(c.email || '', query);
    const companyBadge = c.company ? `<span class="autocomplete-item-company">${escapeHtml(c.company)}</span>` : '';

    return `
      <div class="autocomplete-item ${isActive}" data-index="${idx}">
        <div class="autocomplete-item-avatar">${escapeHtml(initials)}</div>
        <div class="autocomplete-item-info">
          <div class="autocomplete-item-name-row">
            <span class="autocomplete-item-name">${nameHighlight}</span>
            ${companyBadge}
          </div>
          <span class="autocomplete-item-email">${emailHighlight}</span>
        </div>
      </div>
    `;
  }).join('');

  const rect = inputEl.getBoundingClientRect();
  dropdown.style.display = 'block';
  dropdown.style.top = `${rect.bottom + window.scrollY + 4}px`;
  dropdown.style.left = `${rect.left + window.scrollX}px`;
  dropdown.style.width = `${Math.max(rect.width, 320)}px`;

  dropdown.querySelectorAll('.autocomplete-item').forEach(itemEl => {
    itemEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const idx = parseInt(itemEl.dataset.index, 10);
      selectAutocompleteContact(matches[idx]);
    });
  });
}

function handleAutocompleteKeydown(e, inputEl) {
  const dropdown = document.getElementById('emailAutocompleteDropdown');
  if (!dropdown || dropdown.style.display === 'none' || currentAutocompleteMatches.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeAutocompleteIndex = (activeAutocompleteIndex + 1) % currentAutocompleteMatches.length;
    updateAutocompleteActiveItem();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeAutocompleteIndex = (activeAutocompleteIndex - 1 + currentAutocompleteMatches.length) % currentAutocompleteMatches.length;
    updateAutocompleteActiveItem();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    if (activeAutocompleteIndex >= 0 && activeAutocompleteIndex < currentAutocompleteMatches.length) {
      e.preventDefault();
      selectAutocompleteContact(currentAutocompleteMatches[activeAutocompleteIndex]);
    }
  } else if (e.key === 'Escape') {
    hideAutocompleteDropdown();
  }
}

function updateAutocompleteActiveItem() {
  const dropdown = document.getElementById('emailAutocompleteDropdown');
  if (!dropdown) return;
  const items = dropdown.querySelectorAll('.autocomplete-item');
  items.forEach((it, idx) => {
    if (idx === activeAutocompleteIndex) {
      it.classList.add('active');
      it.scrollIntoView({ block: 'nearest' });
    } else {
      it.classList.remove('active');
    }
  });
}

function selectAutocompleteContact(contact) {
  if (!activeAutocompleteTarget || !contact) return;
  const inputEl = activeAutocompleteTarget;
  const val = inputEl.value;
  const cursorPos = inputEl.selectionStart || val.length;

  const textBefore = val.slice(0, cursorPos);
  const textAfter = val.slice(cursorPos);

  const lastSepIndex = Math.max(
    textBefore.lastIndexOf(','),
    textBefore.lastIndexOf(';'),
    textBefore.lastIndexOf('\n')
  );

  const prefix = lastSepIndex >= 0 ? textBefore.slice(0, lastSepIndex + 1) + ' ' : '';
  const insertText = contact.email;
  const separator = inputEl.tagName === 'TEXTAREA' ? '\n' : ', ';

  inputEl.value = prefix + insertText + separator + textAfter.trimStart();
  inputEl.focus();
  const newPos = (prefix + insertText + separator).length;
  inputEl.setSelectionRange(newPos, newPos);

  hideAutocompleteDropdown();

  contact.frequency = (contact.frequency || 1) + 1;
  fetch('/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(contact)
  }).catch(() => {});
}

function hideAutocompleteDropdown() {
  const dropdown = document.getElementById('emailAutocompleteDropdown');
  if (dropdown) dropdown.style.display = 'none';
  activeAutocompleteTarget = null;
  activeAutocompleteIndex = -1;
  currentAutocompleteMatches = [];
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return `${escapeHtml(before)}<span class="autocomplete-highlight">${escapeHtml(match)}</span>${escapeHtml(after)}`;
}

// ============================================================
// ADDRESS BOOK MODAL MANAGEMENT
// ============================================================
function initAddressBookModal() {
  const modal = document.getElementById('addressBookModal');
  const btnOpen = document.getElementById('btnOpenAddressBook');
  const btnClose = document.getElementById('btnCloseAddressBook');
  const btnCloseBottom = document.getElementById('btnCloseAddressBookBottom');
  const searchInput = document.getElementById('inputAddressBookSearch');
  const btnToggleAdd = document.getElementById('btnAddNewContactToggle');
  const formWrapper = document.getElementById('contactFormWrapper');
  const btnCancelForm = document.getElementById('btnCancelContactForm');
  const btnSaveForm = document.getElementById('btnSaveContactForm');
  const btnImport = document.getElementById('btnTriggerImportContacts');
  const fileImport = document.getElementById('inputContactFileImport');
  const btnExport = document.getElementById('btnExportContacts');

  if (!modal) return;

  const openModal = () => {
    modal.classList.add('active');
    renderAddressBookTable();
  };
  const closeModal = () => {
    modal.classList.remove('active');
    if (formWrapper) formWrapper.style.display = 'none';
  };

  if (btnOpen) btnOpen.addEventListener('click', openModal);
  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnCloseBottom) btnCloseBottom.addEventListener('click', closeModal);

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderAddressBookTable(searchInput.value.trim());
    });
  }

  if (btnToggleAdd && formWrapper) {
    btnToggleAdd.addEventListener('click', () => {
      resetContactForm();
      formWrapper.style.display = formWrapper.style.display === 'none' ? 'block' : 'none';
      if (formWrapper.style.display === 'block') {
        const nameInput = document.getElementById('contactFormName');
        if (nameInput) nameInput.focus();
      }
    });
  }

  if (btnCancelForm && formWrapper) {
    btnCancelForm.addEventListener('click', () => {
      formWrapper.style.display = 'none';
    });
  }

  if (btnSaveForm) {
    btnSaveForm.addEventListener('click', async () => {
      const id = document.getElementById('contactFormId').value;
      const name = document.getElementById('contactFormName').value.trim();
      const email = document.getElementById('contactFormEmail').value.trim();
      const company = document.getElementById('contactFormCompany').value.trim();
      const notes = document.getElementById('contactFormNotes').value.trim();

      if (!email || !email.includes('@')) {
        showToast('Please enter a valid email address.', 'error');
        return;
      }

      try {
        const res = await fetch('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name, email, company, notes })
        });
        const d = await res.json();
        if (d.success) {
          showToast('Contact saved successfully!', 'success');
          if (formWrapper) formWrapper.style.display = 'none';
          await loadContactsCache();
          renderAddressBookTable(searchInput ? searchInput.value.trim() : '');
        } else {
          showToast(d.error || 'Failed to save contact', 'error');
        }
      } catch (err) {
        showToast('Error saving contact: ' + err.message, 'error');
      }
    });
  }

  if (btnImport && fileImport) {
    btnImport.addEventListener('click', () => fileImport.click());
    fileImport.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const fd = new FormData();
      fd.append('file', file);
      showToast('Importing contacts...', 'info');

      try {
        const res = await fetch('/api/contacts/import', {
          method: 'POST',
          body: fd
        });
        const d = await res.json();
        if (d.success) {
          showToast(`Successfully imported ${d.imported_count} contact(s)!`, 'success');
          await loadContactsCache();
          renderAddressBookTable();
        } else {
          showToast(d.error || 'Import failed', 'error');
        }
      } catch (err) {
        showToast('Error importing contacts: ' + err.message, 'error');
      }
      fileImport.value = '';
    });
  }

  if (btnExport) {
    btnExport.addEventListener('click', exportContactsCsv);
  }
}

async function exportContactsCsv() {
  const btnExport = document.getElementById('btnExportContacts');
  const originalHtml = btnExport ? btnExport.innerHTML : '';
  if (btnExport) {
    btnExport.disabled = true;
    btnExport.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Exporting...';
  }

  try {
    let csvData = '';

    // 1. Try fetching directly from the backend /api/contacts/export endpoint
    try {
      const res = await fetch('/api/contacts/export');
      if (res.ok) {
        const text = await res.text();
        if (text && !text.trim().startsWith('{') && !text.trim().startsWith('<!DOCTYPE')) {
          csvData = text;
        }
      }
    } catch (netErr) {
      console.warn('Backend /api/contacts/export unreachable, falling back to local contact cache:', netErr);
    }

    // 2. If backend export is unavailable or returned non-CSV, generate from cachedContacts or /api/contacts JSON
    if (!csvData) {
      let list = Array.isArray(cachedContacts) && cachedContacts.length > 0 ? cachedContacts : null;

      if (!list || list.length === 0) {
        try {
          const listRes = await fetch('/api/contacts?limit=10000');
          if (listRes.ok) {
            const listJson = await listRes.json();
            if (listJson.success && Array.isArray(listJson.contacts) && listJson.contacts.length > 0) {
              list = listJson.contacts;
              cachedContacts = list;
            }
          }
        } catch (_) {}
      }

      if (!list || list.length === 0) {
        try {
          const stored = localStorage.getItem('ap_merin_cached_contacts');
          if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.length > 0) {
              list = parsed;
            }
          }
        } catch (_) {}
      }

      if (!list || list.length === 0) {
        showToast('No contacts found to export in address book.', 'warning');
        return;
      }

      const headers = ['Name', 'Email', 'Company', 'Notes', 'Frequency', 'Last Used'];
      const rows = [headers];
      list.forEach(c => {
        rows.push([
          c.name || '',
          c.email || '',
          c.company || '',
          c.notes || '',
          c.frequency || 1,
          c.last_used || ''
        ]);
      });

      csvData = rows.map(r => r.map(val => {
        const str = String(val ?? '');
        return `"${str.replace(/"/g, '""')}"`;
      }).join(',')).join('\r\n');
    }

    // Ensure UTF-8 BOM so Microsoft Excel opens special characters correctly
    if (!csvData.startsWith('\ufeff')) {
      csvData = '\ufeff' + csvData;
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const suggestedFilename = `ap_merin_contacts_${dateStr}.csv`;

    // 1. First priority: Browser / WebView2 Native File System Access API (showSaveFilePicker)
    // Prompts the OS native "Save As" dialog so the user can choose the exact folder and filename
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: suggestedFilename,
          types: [{
            description: 'CSV File (*.csv)',
            accept: { 'text/csv': ['.csv'] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(csvData);
        await writable.close();
        showToast('Contacts exported and saved successfully!', 'success');
        return;
      } catch (pickerErr) {
        if (pickerErr.name === 'AbortError') {
          showToast('Export cancelled.', 'info');
          return;
        }
        console.warn('showSaveFilePicker not permitted or failed, falling back:', pickerErr);
      }
    }

    // 2. Second priority: pywebview native window save dialog (in desktop app)
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.save_file_dialog === 'function') {
      try {
        const pyRes = await window.pywebview.api.save_file_dialog(suggestedFilename, csvData);
        if (pyRes && pyRes.success) {
          showToast(`Contacts saved to: ${pyRes.path}`, 'success');
          return;
        } else if (pyRes && pyRes.cancelled) {
          showToast('Export cancelled.', 'info');
          return;
        }
      } catch (pyErr) {
        console.warn('pywebview.api.save_file_dialog failed, trying backend dialog:', pyErr);
      }
    }

    // 3. Third priority: Host-level native Save File Dialog via Flask backend endpoint (/api/save-file-dialog)
    // Opens Windows / Mac Save As dialog on desktop
    try {
      const dlgRes = await fetch('/api/save-file-dialog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: suggestedFilename,
          content: csvData,
          file_type: 'csv'
        })
      });
      if (dlgRes.ok) {
        const dlgJson = await dlgRes.json();
        if (dlgJson.success) {
          showToast(`Contacts saved to: ${dlgJson.path}`, 'success');
          return;
        } else if (dlgJson.cancelled) {
          showToast('Export cancelled.', 'info');
          return;
        }
      }
    } catch (backendDlgErr) {
      console.warn('Backend /api/save-file-dialog unreachable:', backendDlgErr);
    }

    // 4. Fourth priority: Fallback download anchor (for cloud / Netlify environments)
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    showToast('Contacts downloaded to your Downloads folder.', 'info');
  } catch (err) {
    console.error('Error exporting contacts:', err);
    showToast('Export failed: ' + err.message, 'error');
  } finally {
    if (btnExport) {
      btnExport.disabled = false;
      btnExport.innerHTML = originalHtml;
    }
  }
}

function resetContactForm() {
  const formId = document.getElementById('contactFormId');
  const formName = document.getElementById('contactFormName');
  const formEmail = document.getElementById('contactFormEmail');
  const formCompany = document.getElementById('contactFormCompany');
  const formNotes = document.getElementById('contactFormNotes');
  const formTitle = document.getElementById('contactFormTitle');

  if (formId) formId.value = '';
  if (formName) formName.value = '';
  if (formEmail) formEmail.value = '';
  if (formCompany) formCompany.value = '';
  if (formNotes) formNotes.value = '';
  if (formTitle) formTitle.innerText = 'Add New Contact';
}

function renderAddressBookTable(query = '') {
  const tbody = document.getElementById('addressBookTableBody');
  if (!tbody) return;

  const q = query.toLowerCase();
  const list = cachedContacts.filter(c => {
    if (!q) return true;
    return (c.name && c.name.toLowerCase().includes(q)) ||
           (c.email && c.email.toLowerCase().includes(q)) ||
           (c.company && c.company.toLowerCase().includes(q));
  });

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--text-muted);"><i class="fa-regular fa-folder-open"></i> No contacts found.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(c => `
    <tr style="border-bottom: 1px solid #f1f5f9;">
      <td style="padding: 10px 14px; font-weight: 600; color: #1e293b;">${escapeHtml(c.name || '-')}</td>
      <td style="padding: 10px 14px; color: #2563eb; font-family: monospace;">${escapeHtml(c.email)}</td>
      <td style="padding: 10px 14px; color: #64748b;">${escapeHtml(c.company || '-')}</td>
      <td style="padding: 10px 14px; text-align: center;"><span class="badge-freq">${c.frequency || 1}</span></td>
      <td style="padding: 10px 14px; text-align: right; white-space: nowrap;">
        <button type="button" class="btn-text text-primary btn-use-contact" data-email="${escapeHtml(c.email)}" title="Add to recipients" style="margin-right: 8px;">
          <i class="fa-solid fa-plus-circle"></i> Use
        </button>
        <button type="button" class="btn-text text-muted btn-edit-contact" data-id="${c.id}" title="Edit contact" style="margin-right: 8px;">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        <button type="button" class="btn-text text-danger btn-delete-contact" data-id="${c.id}" title="Delete contact">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-use-contact').forEach(btn => {
    btn.addEventListener('click', () => {
      const email = btn.dataset.email;
      const input = document.getElementById('inputCompanyEmails');
      if (input) {
        input.value = input.value ? (input.value.trim() + '\n' + email) : email;
        showToast(`Added ${email} to recipients!`, 'success');
      }
    });
  });

  tbody.querySelectorAll('.btn-edit-contact').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id, 10);
      const c = cachedContacts.find(item => item.id === id);
      if (!c) return;
      const formWrapper = document.getElementById('contactFormWrapper');
      document.getElementById('contactFormId').value = c.id;
      document.getElementById('contactFormName').value = c.name || '';
      document.getElementById('contactFormEmail').value = c.email || '';
      document.getElementById('contactFormCompany').value = c.company || '';
      document.getElementById('contactFormNotes').value = c.notes || '';
      document.getElementById('contactFormTitle').innerText = 'Edit Contact';
      if (formWrapper) formWrapper.style.display = 'block';
      const nameInput = document.getElementById('contactFormName');
      if (nameInput) nameInput.focus();
    });
  });

  tbody.querySelectorAll('.btn-delete-contact').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id, 10);
      if (!confirm('Are you sure you want to delete this contact?')) return;
      try {
        const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
        const d = await res.json();
        if (d.success) {
          showToast('Contact deleted.', 'info');
          await loadContactsCache();
          renderAddressBookTable();
        }
      } catch (err) {
        showToast('Error deleting contact', 'error');
      }
    });
  });
}

// Run on page load
document.addEventListener('DOMContentLoaded', () => {
  initEmailStudio();
});

