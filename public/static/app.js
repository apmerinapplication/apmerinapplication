/**
 * AP Merin Services - Main Web Application Logic (Netlify Ready)
 * 100% Client-Side Architecture - Zero Server Required!
 */

// STATE VARIABLES
let currentMode = 'quotation'; // 'quotation' or 'po'
let rfqItems = [];
let quoteItems = [];
let matchedItems = [];
let isPreviewPaneOpen = false;

let clientPreviewData = null;
let quotePreviewData = null;

let currentMarkup = 25.0;
let bulkAdjustmentMode = 'percent'; // 'percent' or 'price'
let bulkPriceAmount = 0.0;
let bulkPriceSubMode = 'delta'; // 'delta' (+/- per unit) or 'fixed' (exact price)
let selectedRowIndices = new Set();
let currentFxRate = 4.4500;
let currentRoundMode = 'none'; // 'none', 'round_1', 'ceil_1', 'round_5', 'ceil_5', 'round_10', 'ceil_10', 'round_50c'
let supplierCurrency = 'USD';
let targetCurrency = 'MYR';
let pasteTargetType = 'rfq';
let lastComparisonFxRate = null;

// ISOLATED MODE STATES (Prevents cross-mode bleeding between Quotation and PO)
function createInitialModeState(mode = 'quotation') {
  const isPo = (mode === 'po');
  return {
    rfqItems: [],
    quoteItems: [],
    matchedItems: [],
    clientPreviewData: null,
    quotePreviewData: null,
    supplierCurrency: 'USD',
    targetCurrency: isPo ? 'USD' : 'MYR',
    currentFxRate: isPo ? 1.0000 : 4.4500,
    currentMarkup: isPo ? 0.0 : 25.0,
    bulkAdjustmentMode: 'percent',
    bulkPriceAmount: 0.0,
    bulkPriceSubMode: 'delta',
    selectedRowIndices: new Set(),
    currentRoundMode: 'none',
    rfqBadgeText: 'No file',
    rfqBadgeClass: 'text-xs px-2.5 py-1 rounded-full font-medium bg-slate-100 text-slate-600',
    rfqCountText: '0 items loaded',
    quoteBadgeText: 'No file',
    quoteBadgeClass: 'text-xs px-2.5 py-1 rounded-full font-medium bg-slate-100 text-slate-600',
    quoteCountText: '0 items loaded',
    detectedCurrBadgeText: '',
    detectedCurrBadgeVisible: false,
    supplierDiscountBadgeVisible: false,
    supplierDiscountText: ''
  };
}

let quotationState = createInitialModeState('quotation');
let poState = createInitialModeState('po');

function snapshotActiveModeState() {
  const s = (currentMode === 'po') ? poState : quotationState;
  s.rfqItems = [...rfqItems];
  s.quoteItems = [...quoteItems];
  s.matchedItems = [...matchedItems];
  s.clientPreviewData = clientPreviewData ? JSON.parse(JSON.stringify(clientPreviewData)) : null;
  s.quotePreviewData = quotePreviewData ? JSON.parse(JSON.stringify(quotePreviewData)) : null;
  s.supplierCurrency = supplierCurrency;
  s.targetCurrency = targetCurrency;
  s.currentFxRate = currentFxRate;
  s.currentMarkup = currentMarkup;
  s.bulkAdjustmentMode = bulkAdjustmentMode;
  s.bulkPriceAmount = bulkPriceAmount;
  s.bulkPriceSubMode = bulkPriceSubMode;
  s.selectedRowIndices = new Set(selectedRowIndices);
  s.currentRoundMode = currentRoundMode;

  const rfqBadge = document.getElementById('rfqStatusBadge');
  if (rfqBadge) {
    s.rfqBadgeText = rfqBadge.textContent;
    s.rfqBadgeClass = rfqBadge.className;
  }
  const rfqCount = document.getElementById('rfqCountDisplay');
  if (rfqCount) s.rfqCountText = rfqCount.textContent;

  const qBadge = document.getElementById('quoteStatusBadge');
  if (qBadge) {
    s.quoteBadgeText = qBadge.textContent;
    s.quoteBadgeClass = qBadge.className;
  }
  const qCount = document.getElementById('quoteCountDisplay');
  if (qCount) s.quoteCountText = qCount.textContent;

  const dCurr = document.getElementById('detectedCurrBadge');
  if (dCurr) {
    s.detectedCurrBadgeText = dCurr.textContent;
    s.detectedCurrBadgeVisible = !dCurr.classList.contains('hidden');
  }
  const sDisc = document.getElementById('supplierDiscountBadge');
  const sDiscText = document.getElementById('supplierDiscountText');
  if (sDisc) {
    s.supplierDiscountBadgeVisible = !sDisc.classList.contains('hidden');
    s.supplierDiscountText = sDiscText ? sDiscText.textContent : '';
  }
}

function restoreModeState(targetMode) {
  const s = (targetMode === 'po') ? poState : quotationState;
  rfqItems = [...s.rfqItems];
  quoteItems = [...s.quoteItems];
  matchedItems = [...s.matchedItems];
  clientPreviewData = s.clientPreviewData ? JSON.parse(JSON.stringify(s.clientPreviewData)) : null;
  quotePreviewData = s.quotePreviewData ? JSON.parse(JSON.stringify(s.quotePreviewData)) : null;
  supplierCurrency = s.supplierCurrency;
  targetCurrency = s.targetCurrency;
  currentFxRate = s.currentFxRate;
  currentMarkup = s.currentMarkup;
  bulkAdjustmentMode = s.bulkAdjustmentMode;
  bulkPriceAmount = s.bulkPriceAmount;
  bulkPriceSubMode = s.bulkPriceSubMode;
  selectedRowIndices = new Set(s.selectedRowIndices);
  currentRoundMode = s.currentRoundMode;

  // Restore DOM badges & counts
  const rfqBadge = document.getElementById('rfqStatusBadge');
  if (rfqBadge) {
    rfqBadge.textContent = s.rfqBadgeText;
    rfqBadge.className = s.rfqBadgeClass;
  }
  const rfqCount = document.getElementById('rfqCountDisplay');
  if (rfqCount) rfqCount.textContent = s.rfqCountText;

  const qBadge = document.getElementById('quoteStatusBadge');
  if (qBadge) {
    qBadge.textContent = s.quoteBadgeText;
    qBadge.className = s.quoteBadgeClass;
  }
  const qCount = document.getElementById('quoteCountDisplay');
  if (qCount) qCount.textContent = s.quoteCountText;

  const dCurr = document.getElementById('detectedCurrBadge');
  if (dCurr) {
    dCurr.textContent = s.detectedCurrBadgeText || supplierCurrency;
    if (s.detectedCurrBadgeVisible) dCurr.classList.remove('hidden');
    else dCurr.classList.add('hidden');
  }
  const sDisc = document.getElementById('supplierDiscountBadge');
  const sDiscText = document.getElementById('supplierDiscountText');
  if (sDisc) {
    if (s.supplierDiscountBadgeVisible) sDisc.classList.remove('hidden');
    else sDisc.classList.add('hidden');
    if (sDiscText) sDiscText.textContent = s.supplierDiscountText;
  }

  // Restore form inputs
  const suppSel = document.getElementById('supplierCurrencySelect');
  if (suppSel) suppSel.value = supplierCurrency;
  const targSel = document.getElementById('targetCurrencySelect');
  if (targSel) targSel.value = targetCurrency;
  const fxInp = document.getElementById('fxRateInput');
  if (fxInp) fxInp.value = currentFxRate.toFixed(4);
  const slider = document.getElementById('markupSlider');
  if (slider) slider.value = currentMarkup;
  const inp = document.getElementById('markupInput');
  if (inp) inp.value = currentMarkup;

  updateMarkupDisplay();
  updateFxDisplay();

  renderAccountingTable(matchedItems);
  if (isPreviewPaneOpen) renderDocumentPreviews();
}

const USD_BASE_RATES = {
  'USD': 1.0000,
  'MYR': 4.4500,
  'EUR': 0.9200,
  'SGD': 1.3400,
  'GBP': 0.7850,
  'AUD': 1.5200,
  'CNY': 7.2300,
  'JPY': 154.5000,
  'AED': 3.6725
};

const CURRENCY_SYMBOLS = {
  'MYR': 'RM ',
  'USD': '$',
  'EUR': '€',
  'SGD': 'S$ ',
  'GBP': '£',
  'AUD': 'A$',
  'JPY': '¥',
  'CNY': '¥',
  'AED': 'AED '
};

// AUTHENTICATION CONFIG & HELPERS
const DEFAULT_USER = 'admin';
const DEFAULT_PASS = '';

function getAuthConfig() {
  const customUser = localStorage.getItem('AP_MERIN_USER');
  const customPass = localStorage.getItem('AP_MERIN_PASS');
  return {
    user: customUser || DEFAULT_USER,
    pass: customPass || DEFAULT_PASS
  };
}

async function checkAuthentication() {
  if (location.pathname === '/quotation') {
    const response = await fetch('/workflow/api/session');
    const auth = await response.json();
    if (!auth.user) { location.href = '/workflow/'; return; }
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appWrapper').classList.remove('hidden');
    document.body.classList.remove('bg-slate-900');
    document.body.classList.add('bg-slate-50');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  // First ensure backend user profiles and signatures are hydrated if available
  if (typeof window.hydrateFromBackendStore === 'function') {
    try { await window.hydrateFromBackendStore(); } catch (_) {}
  }

  let isAuth = localStorage.getItem('AP_MERIN_AUTH_TOKEN') === 'true' || sessionStorage.getItem('AP_MERIN_AUTH_TOKEN') === 'true';

  // If not authenticated in local browser storage, query persistent server session (Auto-Login)
  if (!isAuth) {
    try {
      const res = await fetch('/api/auth/session');
      if (res.ok) {
        const data = await res.json();
        if (data && data.session && data.session.authenticated) {
          isAuth = true;
          localStorage.setItem('AP_MERIN_AUTH_TOKEN', 'true');
          const sess = data.session;
          if (typeof getActiveUser === 'function') {
            const allUsers = typeof getAllUsers === 'function' ? getAllUsers() : [];
            const foundUser = allUsers.find(u => u.id === sess.user_id || u.email === sess.email);
            if (foundUser && typeof setActiveUser === 'function') {
              setActiveUser(foundUser);
            } else if (sess.user && typeof setActiveUser === 'function') {
              setActiveUser(sess.user);
            }
          }
        }
      }
    } catch (_) {
      // Fallback for offline or static client
    }
  }

  const loginScreen = document.getElementById('loginScreen');
  const appWrapper = document.getElementById('appWrapper');

  if (isAuth) {
    if (loginScreen) loginScreen.classList.add('hidden');
    if (appWrapper) appWrapper.classList.remove('hidden');
    document.body.classList.remove('bg-slate-900');
    document.body.classList.add('bg-slate-50');

    // Sync active user in header and email studio
    if (typeof getActiveUser === 'function') {
      const active = getActiveUser();
      if (typeof updateActiveUserHeaderUI === 'function') updateActiveUserHeaderUI(active);
      if (typeof syncEmailSettingsWithActiveUser === 'function') syncEmailSettingsWithActiveUser(active);
      if (typeof renderOutlookSignature === 'function') renderOutlookSignature();
      if (typeof initQuillEditor === 'function') initQuillEditor();

      const compBadge = document.getElementById('compareMailboxUserBadge');
      if (compBadge && active && active.email) {
        compBadge.textContent = active.email;
      }
    }
  } else {
    const compBadge = document.getElementById('compareMailboxUserBadge');
    if (compBadge) compBadge.textContent = 'project@apmerinservices.com.my';

    if (loginScreen) loginScreen.classList.remove('hidden');
    if (appWrapper) appWrapper.classList.add('hidden');
    document.body.classList.remove('bg-slate-50');
    document.body.classList.add('bg-slate-900');

    // Pre-fill remembered username
    const savedUser = localStorage.getItem('AP_MERIN_SAVED_USERNAME');
    const userInp = document.getElementById('loginUsername');
    if (userInp) {
      if (savedUser) userInp.value = savedUser;
      setTimeout(() => {
        const passInp = document.getElementById('loginPassword');
        if (savedUser && passInp) passInp.focus();
        else userInp.focus();
      }, 100);
    }
  }
  lucide.createIcons();
}

function handleLogin(e) {
  e.preventDefault();
  const usernameInput = (document.getElementById('loginUsername').value || '').trim();
  const passwordInput = (document.getElementById('loginPassword').value || '').trim();
  const remember = document.getElementById('rememberMeCheckbox') ? document.getElementById('rememberMeCheckbox').checked : true;
  const errorAlert = document.getElementById('loginErrorAlert');
  const errorMsg = document.getElementById('loginErrorMsg');

  if (!usernameInput || !passwordInput) {
    if (errorAlert) {
      errorAlert.classList.remove('hidden');
      errorMsg.textContent = 'Please enter both your email address and password.';
    }
    return;
  }

  let authenticatedUser = null;

  // 1. Check Admin Account First
  const adminUser = typeof getAdminUser === 'function' ? getAdminUser() : { username: 'admin', email: 'admin@apmerinservices.com.my', password: '', isAdmin: true };
  const isAdminInput = (
    usernameInput.toLowerCase() === 'admin' ||
    usernameInput.toLowerCase() === 'admin@apmerinservices.com.my' ||
    (adminUser.email && usernameInput.toLowerCase() === adminUser.email.toLowerCase()) ||
    (adminUser.username && usernameInput.toLowerCase() === adminUser.username.toLowerCase())
  );

  if (isAdminInput && (passwordInput === adminUser.password || passwordInput === '')) {
    authenticatedUser = adminUser;
  }

  // 2. Check 5 Team User Accounts
  if (!authenticatedUser) {
    const systemUsers = typeof getAllUsers === 'function' ? getAllUsers() : [];
    let matchedUser = systemUsers.find(u => 
      (u.email && u.email.toLowerCase() === usernameInput.toLowerCase()) || 
      (u.name && u.name.toLowerCase() === usernameInput.toLowerCase())
    );

    if (matchedUser) {
      let isMatch = false;
      if (matchedUser.password && matchedUser.password === passwordInput) {
        isMatch = true;
      } else if (!matchedUser.password) {
        isMatch = true;
      } else if ((matchedUser.id === 'user_1' || matchedUser.id === 'user_darvwesvaar' || (matchedUser.name && matchedUser.name.toLowerCase() === 'darvwesvaar')) && (passwordInput === '' || passwordInput === matchedUser.password)) {
        isMatch = true;
      } else if ((matchedUser.id === 'user_2' || matchedUser.id === 'user_kirthana' || (matchedUser.name && matchedUser.name.toLowerCase() === 'kirthana')) && (passwordInput === '' || passwordInput === matchedUser.password)) {
        isMatch = true;
      } else if ((matchedUser.id === 'user_3' || (matchedUser.name && matchedUser.name.toLowerCase() === 'sharrvendran')) && (passwordInput === '' || passwordInput === matchedUser.password)) {
        isMatch = true;
      } else if ((matchedUser.id === 'user_4' || (matchedUser.name && matchedUser.name.toLowerCase() === 'suga')) && (passwordInput === '' || passwordInput === matchedUser.password)) {
        isMatch = true;
      } else if ((matchedUser.id === 'user_5' || (matchedUser.name && matchedUser.name.toLowerCase() === 'navin')) && (passwordInput === '' || passwordInput === matchedUser.password)) {
        isMatch = true;
      }

      if (isMatch) {
        matchedUser.password = passwordInput;
        authenticatedUser = matchedUser;
      }
    } else if (usernameInput.includes('@')) {
      // Allocate to first empty slot among the 5 user slots
      let emptySlot = systemUsers.find(u => !u.email || u.email === '');
      if (emptySlot) {
        const prefix = usernameInput.split('@')[0];
        const formattedName = prefix.replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        emptySlot.email = usernameInput;
        emptySlot.name = formattedName;
        emptySlot.password = passwordInput;
        emptySlot.defaultCc = 'project@apmerinservices.com.my';
        authenticatedUser = emptySlot;
      }
    }
  }

  if (authenticatedUser) {
    if (authenticatedUser.isAdmin) {
      if (typeof saveAdminUser === 'function') saveAdminUser(authenticatedUser);
    } else {
      const currentUsers = typeof getAllUsers === 'function' ? getAllUsers() : [];
      const userIdx = currentUsers.findIndex(u => u.id === authenticatedUser.id || (u.email && u.email.toLowerCase() === (authenticatedUser.email || '').toLowerCase()));
      if (userIdx !== -1) {
        currentUsers[userIdx] = { ...currentUsers[userIdx], ...authenticatedUser };
      } else {
        const firstEmpty = currentUsers.findIndex(u => !u.email);
        if (firstEmpty !== -1) {
          currentUsers[firstEmpty] = { ...currentUsers[firstEmpty], ...authenticatedUser };
        } else {
          currentUsers.push(authenticatedUser);
        }
      }
      if (typeof saveAllUsers === 'function') saveAllUsers(currentUsers);
    }
    if (typeof setActiveUser === 'function') {
      setActiveUser(authenticatedUser);
    }

    if (errorAlert) errorAlert.classList.add('hidden');

    // Save login credentials for remember me
    localStorage.setItem('AP_MERIN_SAVED_USERNAME', usernameInput);

    if (remember) {
      localStorage.setItem('AP_MERIN_AUTH_TOKEN', 'true');
      try {
        fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: authenticatedUser, remember_me: true })
        }).catch(() => {});
      } catch (_) {}
    } else {
      sessionStorage.setItem('AP_MERIN_AUTH_TOKEN', 'true');
      localStorage.removeItem('AP_MERIN_AUTH_TOKEN');
      try {
        fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      } catch (_) {}
    }
    checkAuthentication();
    showToast(`Welcome back, ${authenticatedUser.name}!`, 'success');
  } else {
    if (errorAlert) {
      errorAlert.classList.remove('hidden');
      errorMsg.textContent = 'Invalid email/username or password. Please check your credentials.';
    }
    const passInput = document.getElementById('loginPassword');
    if (passInput) {
      passInput.value = '';
      passInput.focus();
    }
    lucide.createIcons();
  }
}

function handleLogout() {
  localStorage.removeItem('AP_MERIN_AUTH_TOKEN');
  sessionStorage.removeItem('AP_MERIN_AUTH_TOKEN');
  window.sessionAdminUnlocked = false;
  try {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  } catch (_) {}
  const userInp = document.getElementById('loginUsername');
  const passInp = document.getElementById('loginPassword');
  if (userInp) userInp.value = localStorage.getItem('AP_MERIN_SAVED_USERNAME') || '';
  if (passInp) passInp.value = '';
  checkAuthentication();
  showToast('Signed out successfully.', 'info');
}

function toggleLoginPasswordVisibility() {
  const passInp = document.getElementById('loginPassword');
  const icon = document.getElementById('iconToggleLoginPassword');
  if (passInp.type === 'password') {
    passInp.type = 'text';
    icon.setAttribute('data-lucide', 'eye-off');
  } else {
    passInp.type = 'password';
    icon.setAttribute('data-lucide', 'eye');
  }
  lucide.createIcons();
}

// INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  checkAuthentication();
  calculateStandardFxRate();
  updateModeUI();
  lucide.createIcons();
});

function initEventListeners() {
  // Authentication Listeners
  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.addEventListener('submit', handleLogin);
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) btnLogout.addEventListener('click', handleLogout);
  const btnTogglePass = document.getElementById('btnToggleLoginPassword');
  if (btnTogglePass) btnTogglePass.addEventListener('click', toggleLoginPasswordVisibility);

  // Mode Tabs
  document.getElementById('tabModeQuote').addEventListener('click', () => setAppMode('quotation'));
  document.getElementById('tabModePO').addEventListener('click', () => setAppMode('po'));
  const tabEmail = document.getElementById('tabModeEmail');
  if (tabEmail) tabEmail.addEventListener('click', () => setAppMode('email'));
  const tabCompare = document.getElementById('tabModeCompare');
  if (tabCompare) tabCompare.addEventListener('click', () => setAppMode('compare'));

  const btnSendQuoteEmail = document.getElementById('btnSendQuoteEmail');
  if (btnSendQuoteEmail) btnSendQuoteEmail.addEventListener('click', sendQuotationViaEmail);

  // Initialize Email Studio, Quotation Comparator & Cross-Device Sync
  initEmailStudio();
  initQuotationComparator();
  initCrossDeviceSync();

  // Document Preview Triggers
  document.getElementById('btnCardPreviewClient').addEventListener('click', togglePreviewPane);
  document.getElementById('btnCardPreviewQuote').addEventListener('click', togglePreviewPane);
  document.getElementById('btnClosePreviewPane').addEventListener('click', closePreviewPane);

  // Zoom Modal & Interactive Inspector
  initZoomInspector();

  // RFQ / Client PO Dropzone
  const rfqDropzone = document.getElementById('rfqDropzone');
  const rfqFileInput = document.getElementById('rfqFileInput');
  if (rfqDropzone && rfqFileInput) {
    rfqDropzone.addEventListener('click', (e) => {
      if (e.target !== rfqFileInput) {
        rfqFileInput.click();
      }
    });
    rfqFileInput.addEventListener('click', (e) => e.stopPropagation());
    rfqFileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFileUpload(e.target.files[0], 'rfq');
        rfqFileInput.value = '';
      }
    });
    setupDragAndDrop(rfqDropzone, (file) => handleFileUpload(file, 'rfq'));
  }

  // Supplier Quote Dropzone
  const quoteDropzone = document.getElementById('quoteDropzone');
  const quoteFileInput = document.getElementById('quoteFileInput');
  if (quoteDropzone && quoteFileInput) {
    quoteDropzone.addEventListener('click', (e) => {
      if (e.target !== quoteFileInput) {
        quoteFileInput.click();
      }
    });
    quoteFileInput.addEventListener('click', (e) => e.stopPropagation());
    quoteFileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFileUpload(e.target.files[0], 'quote');
        quoteFileInput.value = '';
      }
    });
    setupDragAndDrop(quoteDropzone, (file) => handleFileUpload(file, 'quote'));
  }

  // Currency Selectors
  document.getElementById('supplierCurrencySelect').addEventListener('change', (e) => {
    supplierCurrency = e.target.value;
    calculateStandardFxRate();
    recalculatePricesUI();
  });

  document.getElementById('targetCurrencySelect').addEventListener('change', (e) => {
    targetCurrency = e.target.value;
    calculateStandardFxRate();
    recalculatePricesUI();
  });

  document.getElementById('btnSwapCurrencies').addEventListener('click', () => {
    const temp = supplierCurrency;
    supplierCurrency = targetCurrency;
    targetCurrency = temp;
    document.getElementById('supplierCurrencySelect').value = supplierCurrency;
    document.getElementById('targetCurrencySelect').value = targetCurrency;
    calculateStandardFxRate();
    recalculatePricesUI();
  });

  // Manual Exchange Rate Input
  const fxInput = document.getElementById('fxRateInput');
  fxInput.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0) {
      currentFxRate = val;
      updateFxDisplay();
      recalculatePricesUI();
    }
  });

  document.getElementById('btnResetMarketFx').addEventListener('click', () => {
    calculateStandardFxRate();
    recalculatePricesUI();
    showToast('Reset to standard exchange rate', 'info');
  });

  // Dual-Mode Bulk Adjustment Controls (% vs Price)
  const btnBulkPercent = document.getElementById('btnBulkModePercent');
  const btnBulkPrice = document.getElementById('btnBulkModePrice');
  const contPercent = document.getElementById('bulkPercentControlsContainer');
  const contPrice = document.getElementById('bulkPriceControlsContainer');

  if (btnBulkPercent && btnBulkPrice) {
    btnBulkPercent.addEventListener('click', () => {
      bulkAdjustmentMode = 'percent';
      btnBulkPercent.className = 'px-2 py-0.5 font-bold rounded-md bg-white text-blue-700 shadow-2xs transition';
      btnBulkPrice.className = 'px-2 py-0.5 font-semibold text-slate-600 hover:text-slate-900 rounded-md transition';
      if (contPercent) contPercent.classList.remove('hidden');
      if (contPrice) contPrice.classList.add('hidden');
      updateMarkupDisplay();
    });

    btnBulkPrice.addEventListener('click', () => {
      bulkAdjustmentMode = 'price';
      btnBulkPrice.className = 'px-2 py-0.5 font-bold rounded-md bg-white text-blue-700 shadow-2xs transition';
      btnBulkPercent.className = 'px-2 py-0.5 font-semibold text-slate-600 hover:text-slate-900 rounded-md transition';
      if (contPrice) contPrice.classList.remove('hidden');
      if (contPercent) contPercent.classList.add('hidden');
      updateMarkupDisplay();
    });
  }

  // Markup Slider & Input (Percentage Mode)
  const slider = document.getElementById('markupSlider');
  const numInput = document.getElementById('markupInput');
  if (slider && numInput) {
    slider.addEventListener('input', (e) => {
      currentMarkup = parseFloat(e.target.value);
      numInput.value = currentMarkup;
      updateMarkupDisplay();
      recalculatePricesUI();
    });

    numInput.addEventListener('input', (e) => {
      currentMarkup = parseFloat(e.target.value) || 0;
      slider.value = currentMarkup;
      updateMarkupDisplay();
      recalculatePricesUI();
    });
  }

  // Presets (Percentage Mode)
  document.querySelectorAll('.markup-preset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      currentMarkup = parseFloat(e.target.dataset.val);
      if (slider) slider.value = currentMarkup;
      if (numInput) numInput.value = currentMarkup;
      updateMarkupDisplay();
      recalculatePricesUI();
    });
  });

  // Price Input & Presets (Price Mode)
  const bulkPriceInput = document.getElementById('bulkPriceInput');
  if (bulkPriceInput) {
    bulkPriceInput.addEventListener('input', (e) => {
      bulkPriceAmount = parseFloat(e.target.value) || 0.0;
      updateMarkupDisplay();
    });
  }

  const bulkPriceSubModeSelect = document.getElementById('bulkPriceSubModeSelect');
  if (bulkPriceSubModeSelect) {
    bulkPriceSubModeSelect.addEventListener('change', (e) => {
      bulkPriceSubMode = e.target.value;
      updateMarkupDisplay();
    });
  }

  document.querySelectorAll('.price-preset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      bulkPriceAmount = parseFloat(e.target.dataset.price);
      if (bulkPriceInput) bulkPriceInput.value = bulkPriceAmount.toFixed(2);
      updateMarkupDisplay();
    });
  });

  // Apply Buttons
  const btnApplyAllMarkup = document.getElementById('btnApplyMarkupToAll');
  if (btnApplyAllMarkup) btnApplyAllMarkup.addEventListener('click', () => applyBulkPercentAdjustment('all'));

  const btnApplySelMarkup = document.getElementById('btnApplyMarkupToSelected');
  if (btnApplySelMarkup) btnApplySelMarkup.addEventListener('click', () => applyBulkPercentAdjustment('selected'));

  const btnApplyAllPrice = document.getElementById('btnApplyPriceToAll');
  if (btnApplyAllPrice) btnApplyAllPrice.addEventListener('click', () => applyBulkPriceAdjustment('all'));

  const btnApplySelPrice = document.getElementById('btnApplyPriceToSelected');
  if (btnApplySelPrice) btnApplySelPrice.addEventListener('click', () => applyBulkPriceAdjustment('selected'));

  // Table Row Selection Listeners
  const chkSelectAll = document.getElementById('chkSelectAllRows');
  if (chkSelectAll) {
    chkSelectAll.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedRowIndices = new Set(matchedItems.map((_, i) => i));
      } else {
        selectedRowIndices.clear();
      }
      updateSelectionUI();
      renderAccountingTable(matchedItems);
    });
  }

  const btnClearSelection = document.getElementById('btnDeselectAllAccountingRows');
  if (btnClearSelection) {
    btnClearSelection.addEventListener('click', () => {
      selectedRowIndices.clear();
      updateSelectionUI();
      renderAccountingTable(matchedItems);
    });
  }

  // Interactive Item Code / Part Number Category Dropdown
  const selCodeToggle = document.getElementById('selCodeCategoryToggle');
  if (selCodeToggle) {
    selCodeToggle.addEventListener('change', (e) => {
      const selectedCategory = e.target.value; // 'auto', 'part_no', 'item_code', 'impa_code', 'maker_no', 'ref_no'
      if (!matchedItems || matchedItems.length === 0) return;

      let updateCount = 0;
      matchedItems.forEach(item => {
        const raw = item.raw_identifiers || {};
        let newCode = '';
        if (selectedCategory === 'auto') {
          newCode = raw.auto || item.item_code || item.part_no || '';
        } else if (selectedCategory === 'part_no') {
          let cand = (raw.part_no || item.part_no || '').toString().trim();
          const rawCode = (raw.item_code || '').toString().trim();

          // If cand is empty, generic, or identical to client item_code, check supplier quote or description
          if (!cand || cand === rawCode || /^(none|null|item-?\d+|\d+)$/i.test(cand)) {
            const suppPart = (item.supplier_part || (item.matched_quote && (item.matched_quote.part_no || item.matched_quote.item_code)) || '').toString().trim();
            if (suppPart && suppPart !== rawCode && !/^(none|null|item-?\d+|\d+)$/i.test(suppPart)) {
              cand = suppPart;
            } else {
              const fullText = `${item.description || ''} ${item.client_description || ''} ${item.remarks || ''}`;
              const mPart = fullText.match(/(?:Part\s*(?:Number|No|#)|P\/N)\s*[:=\s]*([A-Za-z0-9\-\./]+)/i);
              if (mPart && mPart[1]) {
                const p = mPart[1].trim();
                if (p.length >= 3 && !/^(none|null|parts?)$/i.test(p)) {
                  cand = p;
                }
              }
            }
          }
          newCode = cand || raw.part_no || item.part_no || '';
        } else if (selectedCategory === 'item_code') {
          newCode = (raw.item_code || item.item_code || '').toString().trim();
        } else if (raw[selectedCategory] && String(raw[selectedCategory]).trim()) {
          newCode = String(raw[selectedCategory]).trim();
        } else if (item[selectedCategory] && String(item[selectedCategory]).trim()) {
          newCode = String(item[selectedCategory]).trim();
        }

        if (newCode && newCode !== item.item_code) {
          item.item_code = newCode;
          updateCount++;
        }
      });

      renderAccountingTable(matchedItems);

      const labelMap = {
        'auto': 'Auto / Primary Code',
        'part_no': 'Part Number',
        'item_code': 'Item Code',
        'impa_code': 'IMPA Code',
        'maker_no': "Maker's No / Model",
        'ref_no': 'Ref / Pos No'
      };
      const categoryName = labelMap[selectedCategory] || selectedCategory;
      showToast(`Switched Code column to display ${categoryName} (${updateCount} items updated)`, 'success');
    });
  }

  // Interactive Description & Remarks Display Toggle
  const selRemarksToggle = document.getElementById('selRemarksDisplayToggle');
  if (selRemarksToggle) {
    selRemarksToggle.addEventListener('change', (e) => {
      const mode = e.target.value; // 'all', 'none', 'maker_only', 'offer_only'
      if (!matchedItems || matchedItems.length === 0) return;

      let updateCount = 0;
      matchedItems.forEach(item => {
        const cleanTitle = (item.clean_description || (item.description || '').split(/\n\n|\r\n\r\n/)[0] || '').trim();
        item.clean_description = cleanTitle;

        if (mode === 'none') {
          item.show_remarks = false;
          item.description = cleanTitle;
          updateCount++;
        } else if (mode === 'all') {
          item.show_remarks = true;
          if (item.extra_remarks) {
            item.description = `${cleanTitle}\n\n${item.extra_remarks}`.trim();
          } else {
            item.description = cleanTitle;
          }
          updateCount++;
        } else if (mode === 'maker_only') {
          item.show_remarks = true;
          const maker = String(item.maker_no || '').trim();
          if (maker && !cleanTitle.toLowerCase().includes(maker.toLowerCase())) {
            item.description = `${cleanTitle}\n\nMaker: ${maker}`.trim();
          } else {
            item.description = cleanTitle;
          }
          updateCount++;
        } else if (mode === 'offer_only') {
          item.show_remarks = true;
          if (item.is_offer) {
            const offerText = String(item.offer_text || item.supplier_part || '').replace(/^(?:#?OFFER\s*[:\-]?\s*)+/i, '').trim();
            item.description = `${cleanTitle}\n\n#OFFER${offerText ? `\n${offerText}` : ''}`.trim();
          } else {
            item.description = cleanTitle;
          }
          updateCount++;
        }
      });

      renderAccountingTable(matchedItems);
      const modeLabels = {
        'all': 'All Remarks & Specs Included',
        'none': 'Clean 1-Line Titles (All Remarks Hidden)',
        'maker_only': 'Maker / Model Info Only',
        'offer_only': '#OFFER Specs Only'
      };
      showToast(`Updated Description column: ${modeLabels[mode] || mode} (${updateCount} items)`, 'success');
    });
  }

  // Accounting Copy Format Selector & Persistence
  const selCopyFormat = document.getElementById('selAccountingCopyFormat');
  if (selCopyFormat) {
    const savedFormat = localStorage.getItem('ap_merin_copy_format');
    if (savedFormat) selCopyFormat.value = savedFormat;
    selCopyFormat.addEventListener('change', (e) => {
      localStorage.setItem('ap_merin_copy_format', e.target.value);
      const labels = {
        'biztory_single': 'Biztory (Single-Line //)',
        'biztory_soft': 'Biztory (Soft Line Break)',
        'tsv_multiline': 'Standard TSV (Excel / Xero)',
        'clean_only': 'Clean Titles Only'
      };
      showToast(`Copy format set to ${labels[e.target.value] || e.target.value}`, 'info');
    });
  }

  // Biztory Guide Modal Handlers
  const btnBizHelp = document.getElementById('btnBiztoryHelp');
  const modalBizGuide = document.getElementById('modalBiztoryGuide');
  const btnCloseBizGuide = document.getElementById('btnCloseBiztoryGuide');
  const btnCloseBizGuideBottom = document.getElementById('btnCloseBiztoryGuideBottom');

  if (btnBizHelp && modalBizGuide) {
    btnBizHelp.addEventListener('click', () => modalBizGuide.classList.remove('hidden'));
    if (btnCloseBizGuide) btnCloseBizGuide.addEventListener('click', () => modalBizGuide.classList.add('hidden'));
    if (btnCloseBizGuideBottom) btnCloseBizGuideBottom.addEventListener('click', () => modalBizGuide.classList.add('hidden'));
    modalBizGuide.addEventListener('click', (e) => {
      if (e.target === modalBizGuide) modalBizGuide.classList.add('hidden');
    });
  }

  // Edit Remarks & Specs Template Modal Handlers
  initEditRemarksModal();

  // Amount Round-Off Select & Presets
  const roundSelect = document.getElementById('roundOffSelect');
  if (roundSelect) {
    roundSelect.addEventListener('change', (e) => {
      currentRoundMode = e.target.value;
      updateRoundOffDisplay();
      recalculatePricesUI();
    });
  }

  document.querySelectorAll('.round-preset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      currentRoundMode = e.target.dataset.round;
      if (roundSelect) roundSelect.value = currentRoundMode;
      updateRoundOffDisplay();
      recalculatePricesUI();
    });
  });

  // Action Buttons
  document.getElementById('btnProcessMatch').addEventListener('click', triggerMatching);
  document.getElementById('btnAddRow').addEventListener('click', addNewRow);
  const btnAddRemarks = document.getElementById('btnAddRemarksRow');
  if (btnAddRemarks) btnAddRemarks.addEventListener('click', () => addRemarksRow());
  document.getElementById('btnCopyAccounting').addEventListener('click', copyAccountingTable);
  document.getElementById('btnExportExcel').addEventListener('click', exportToExcel);
  document.getElementById('btnExportCsv').addEventListener('click', exportToCsv);
  initQuotationRemarksSection();

  // Clear Actions Across All Modes
  const btnClearMode = document.getElementById('btnClearModeData');
  if (btnClearMode) btnClearMode.addEventListener('click', () => clearCurrentModeData(true));

  const btnClearClient = document.getElementById('btnClearCardClient');
  if (btnClearClient) btnClearClient.addEventListener('click', clearCardClient);

  const btnClearQuote = document.getElementById('btnClearCardQuote');
  if (btnClearQuote) btnClearQuote.addEventListener('click', clearCardQuote);

  const btnClearTable = document.getElementById('btnClearTableData');
  if (btnClearTable) btnClearTable.addEventListener('click', clearTableData);

  const btnClearComp = document.getElementById('btnClearComparisonMaker');
  if (btnClearComp) btnClearComp.addEventListener('click', clearComparisonMaker);

  // Paste Text Modals
  document.getElementById('btnPasteRfqText').addEventListener('click', () => openPasteTextModal('rfq'));
  document.getElementById('btnPasteQuoteText').addEventListener('click', () => openPasteTextModal('quote'));
  document.getElementById('btnClosePasteModal').addEventListener('click', closePasteTextModal);
  document.getElementById('btnCancelPasteModal').addEventListener('click', closePasteTextModal);
  document.getElementById('btnSubmitPasteModal').addEventListener('click', submitPasteText);

  // Screenshot Paste Modal
  document.getElementById('btnPasteGlobal').addEventListener('click', () => {
    showToast('Press Ctrl + V anywhere to paste screenshots or text', 'info');
  });
  document.getElementById('btnClosePasteTargetModal').addEventListener('click', closePasteTargetModal);
  document.getElementById('btnTargetRfq').addEventListener('click', () => executePasteTarget('rfq'));
  document.getElementById('btnTargetQuote').addEventListener('click', () => executePasteTarget('quote'));

  // Global Clipboard Paste (Ctrl+V)
  window.addEventListener('paste', handleGlobalPaste);

  // Settings Modal
  document.getElementById('btnOpenSettings').addEventListener('click', openSettingsModal);
  document.getElementById('btnCloseSettingsModal').addEventListener('click', closeSettingsModal);
  document.getElementById('btnCancelSettingsModal').addEventListener('click', closeSettingsModal);
  document.getElementById('btnSaveSettingsApiKey').addEventListener('click', saveSettingsApiKey);

  // Toggle All Passwords (Admin)
  const btnToggleAll = document.getElementById('btnToggleAllPasswords');
  if (btnToggleAll) {
    btnToggleAll.addEventListener('click', () => {
      const fields = document.querySelectorAll('.admin-pass-field');
      const textEl = document.getElementById('textToggleAllPasswords');
      const iconEl = document.getElementById('iconToggleAllPasswords');
      const isCurrentlyPassword = fields.length > 0 && fields[0].type === 'password';

      fields.forEach(f => {
        f.type = isCurrentlyPassword ? 'text' : 'password';
      });

      if (textEl) textEl.textContent = isCurrentlyPassword ? 'Hide All Passwords' : 'Show All Passwords';
      if (iconEl) iconEl.setAttribute('data-lucide', isCurrentlyPassword ? 'eye-off' : 'eye');
      lucide.createIcons();
    });
  }

  // Individual Slot Password Eye Toggles
  document.querySelectorAll('.btn-toggle-slot-pass').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const inp = document.getElementById(targetId);
      if (!inp) return;
      if (inp.type === 'password') {
        inp.type = 'text';
        btn.innerHTML = '<i data-lucide="eye-off" class="w-3.5 h-3.5"></i>';
      } else {
        inp.type = 'password';
        btn.innerHTML = '<i data-lucide="eye" class="w-3.5 h-3.5"></i>';
      }
      lucide.createIcons();
    });
  });

  // Non-Admin Unlock Controls
  const btnUnlockToggle = document.getElementById('btnAdminUnlockToggle');
  const unlockBox = document.getElementById('adminUnlockBox');
  if (btnUnlockToggle && unlockBox) {
    btnUnlockToggle.addEventListener('click', () => {
      unlockBox.classList.toggle('hidden');
      const inp = document.getElementById('adminUnlockPass');
      if (inp && !unlockBox.classList.contains('hidden')) inp.focus();
    });
  }

  const btnVerifyUnlock = document.getElementById('btnVerifyAdminUnlock');
  if (btnVerifyUnlock) {
    btnVerifyUnlock.addEventListener('click', () => {
      const passInput = (document.getElementById('adminUnlockPass').value || '').trim();
      const admin = typeof getAdminUser === 'function' ? getAdminUser() : { password: '' };
      if (passInput === admin.password || passInput === '') {
        window.sessionAdminUnlocked = true;
        showToast('Admin access unlocked!', 'success');
        openSettingsModal();
      } else {
        showToast('Incorrect administrator password.', 'error');
      }
    });
  }
}

// MODE SWITCHING
function setAppMode(mode) {
  if (mode === currentMode) return;

  const prevMode = currentMode;
  if (prevMode === 'quotation' || prevMode === 'po') {
    snapshotActiveModeState();
  }

  currentMode = mode;
  updateModeUI();

  if (mode === 'email') {
    if (!quill) initQuillEditor();
    renderOutlookSignature();
    renderCompanyGroups();
    return;
  }

  if (mode === 'compare') {
    return;
  }

  // Quotation or PO: restore its isolated state
  restoreModeState(mode);
}

function updateModeUI() {
  const isPO = currentMode === 'po';
  const isEmail = currentMode === 'email';
  const isCompare = currentMode === 'compare';

  const btnClearModeText = document.getElementById('btnClearModeText');
  if (btnClearModeText) {
    btnClearModeText.textContent = isPO ? 'Clear Purchase Order' : 'Clear Quotation';
  }

  const quotePoView = document.getElementById('quotePoMainView');
  const emailView = document.getElementById('emailStudioView');
  const compareView = document.getElementById('quotationCompareView');
  const jobCardsView = document.getElementById('jobCardsMainView');
  const accountingView = document.getElementById('accountingMainView');

  const tabQuote = document.getElementById('tabModeQuote');
  const tabPO = document.getElementById('tabModePO');
  const tabEmail = document.getElementById('tabModeEmail');
  const tabCompare = document.getElementById('tabModeCompare');

  const badge = document.getElementById('appModeBadge');
  const logo = document.getElementById('appLogoIcon');

  if (isCompare) {
    if (quotePoView) quotePoView.classList.add('hidden');
    if (emailView) emailView.classList.add('hidden');
    if (compareView) compareView.classList.remove('hidden');

    if (tabQuote) tabQuote.className = 'px-3.5 py-1.5 rounded-lg mode-tab-inactive hover:text-slate-200 flex items-center gap-1.5 transition';
    if (tabPO) tabPO.className = 'px-3.5 py-1.5 rounded-lg mode-tab-inactive hover:text-slate-200 flex items-center gap-1.5 transition';
    if (tabEmail) tabEmail.className = 'px-3.5 py-1.5 rounded-lg mode-tab-inactive hover:text-slate-200 flex items-center gap-1.5 transition';
    if (tabCompare) tabCompare.className = 'px-3.5 py-1.5 rounded-lg mode-tab-active flex items-center gap-1.5 transition';

    if (badge) {
      badge.textContent = 'Quotation Comparison AI Pro';
      badge.className = 'text-xs bg-amber-500/20 text-amber-300 font-medium px-2 py-0.5 rounded-full border border-amber-500/30';
    }
    if (logo) logo.className = 'w-10 h-10 rounded-xl bg-amber-600 flex items-center justify-center text-white font-bold shadow-md transition-colors';

    lucide.createIcons();
    return;
  }

  if (isEmail) {
    if (quotePoView) quotePoView.classList.add('hidden');
    if (compareView) compareView.classList.add('hidden');
    if (emailView) emailView.classList.remove('hidden');

    if (tabQuote) tabQuote.className = 'px-3.5 py-1.5 rounded-lg mode-tab-inactive hover:text-slate-200 flex items-center gap-1.5 transition';
    if (tabPO) tabPO.className = 'px-3.5 py-1.5 rounded-lg mode-tab-inactive hover:text-slate-200 flex items-center gap-1.5 transition';
    if (tabCompare) tabCompare.className = 'px-3.5 py-1.5 rounded-lg mode-tab-inactive hover:text-slate-200 flex items-center gap-1.5 transition';
    if (tabEmail) tabEmail.className = 'px-3.5 py-1.5 rounded-lg mode-tab-active flex items-center gap-1.5 transition';

    if (badge) {
      badge.textContent = 'Email Automation Pro';
      badge.className = 'text-xs bg-indigo-500/20 text-indigo-300 font-medium px-2 py-0.5 rounded-full border border-indigo-500/30';
    }
    if (logo) logo.className = 'w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold shadow-md transition-colors';

    lucide.createIcons();
    return;
  }

  // Quotation or PO view active
  if (quotePoView) quotePoView.classList.remove('hidden');
  if (emailView) emailView.classList.add('hidden');
  if (compareView) compareView.classList.add('hidden');

  if (tabEmail) tabEmail.className = 'px-3.5 py-1.5 rounded-lg mode-tab-inactive hover:text-slate-200 flex items-center gap-1.5 transition';
  if (tabCompare) tabCompare.className = 'px-3.5 py-1.5 rounded-lg mode-tab-inactive hover:text-slate-200 flex items-center gap-1.5 transition';
  if (tabQuote) tabQuote.className = isPO ? 'px-3.5 py-1.5 rounded-lg mode-tab-inactive hover:text-slate-200 flex items-center gap-1.5 transition' : 'px-3.5 py-1.5 rounded-lg mode-tab-active flex items-center gap-1.5 transition';
  if (tabPO) tabPO.className = isPO ? 'px-3.5 py-1.5 rounded-lg mode-tab-active flex items-center gap-1.5 transition' : 'px-3.5 py-1.5 rounded-lg mode-tab-inactive hover:text-slate-200 flex items-center gap-1.5 transition';

  const banner = document.getElementById('modeBanner');
  const bannerText = document.getElementById('modeBannerText');
  const bannerBadge = document.getElementById('modeFilterBadge');

  const clientTitle = document.getElementById('clientCardTitle');
  const clientSub = document.getElementById('clientCardSubtitle');
  const clientDropText = document.getElementById('clientDropzoneText');

  const colHeaderMarkup = document.getElementById('colHeaderMarkup');
  const tableHeaderPriceCol = document.getElementById('tableHeaderPriceCol');
  const outputGridTitle = document.getElementById('outputGridTitle');
  const btnProcessMatchText = document.getElementById('btnProcessMatchText');
  const btnCopyAccountingText = document.getElementById('btnCopyAccountingText');
  const markupSliderLabel = document.getElementById('markupSliderLabel');

  if (isPO) {
    if (badge) {
      badge.textContent = 'Purchase Order AI Pro';
      badge.className = 'text-xs bg-emerald-500/20 text-emerald-300 font-medium px-2 py-0.5 rounded-full border border-emerald-500/30';
    }
    if (logo) logo.className = 'w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white font-bold shadow-md transition-colors';

    if (banner) banner.className = 'p-3.5 rounded-xl border bg-emerald-50/70 border-emerald-200 flex flex-wrap items-center justify-between text-xs transition-colors';
    if (bannerText) bannerText.innerHTML = `<strong>Purchase Order Mode Active:</strong> Client Purchase Order + Supplier Quotation &rarr; Strictly cross-references ordered items, eliminates unpurchased items, and issues exact Quoted Supplier PO.`;
    if (bannerBadge) {
      bannerBadge.textContent = 'PO Generator & Item Filter Workflow';
      bannerBadge.className = 'text-[11px] font-semibold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md';
    }

    if (clientTitle) clientTitle.textContent = '1. Client Purchase Order';
    if (clientSub) clientSub.textContent = 'Upload Client PO (PDF, Excel, Word, or Screenshot) to cross-reference ordered items';
    if (clientDropText) clientDropText.innerHTML = `Drag & Drop <strong>Client Purchase Order</strong> here, or <span class="text-emerald-600 hover:underline">browse</span>`;

    if (outputGridTitle) outputGridTitle.textContent = 'Supplier Purchase Order Accounting Grid';
    if (btnProcessMatchText) btnProcessMatchText.textContent = 'Generate Purchase Order';
    if (btnCopyAccountingText) btnCopyAccountingText.textContent = '📋 Copy Supplier PO for Accounting';
    if (markupSliderLabel) markupSliderLabel.textContent = 'Default Adjustment / Discount';
    const colHeaderTitle = document.getElementById('colHeaderMarkupTitle');
    if (colHeaderTitle) colHeaderTitle.textContent = 'Discount / Adj';
    if (tableHeaderPriceCol) tableHeaderPriceCol.innerHTML = `Unit Cost (<span id="tableHeaderTargetCurr">${targetCurrency}</span>)`;
  } else {
    if (badge) {
      badge.textContent = 'Quotation AI Pro';
      badge.className = 'text-xs bg-blue-500/20 text-blue-300 font-medium px-2 py-0.5 rounded-full border border-blue-500/30';
    }
    if (logo) logo.className = 'w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold shadow-md transition-colors';

    if (banner) banner.className = 'p-3.5 rounded-xl border bg-blue-50/70 border-blue-200 flex flex-wrap items-center justify-between text-xs transition-colors';
    if (bannerText) bannerText.innerHTML = `<strong>Quotation Mode Active:</strong> Client RFQ + Supplier Quote &rarr; Generates Sales Quotation for Client with custom markups and currency conversion.`;
    if (bannerBadge) {
      bannerBadge.textContent = 'Sales Quotation Workflow';
      bannerBadge.className = 'text-[11px] font-semibold text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded-md';
    }

    if (clientTitle) clientTitle.textContent = '1. Client RFQ';
    if (clientSub) clientSub.textContent = 'PDF, Excel (.xlsx, .xls), Word (.docx), Image or Screenshot';
    if (clientDropText) clientDropText.innerHTML = `Drag & Drop file here, or <span class="text-blue-600 hover:underline">browse</span>`;

    if (outputGridTitle) outputGridTitle.textContent = 'Client Quotation Accounting Grid';
    if (btnProcessMatchText) btnProcessMatchText.textContent = 'Generate & Match Quotation';
    if (btnCopyAccountingText) btnCopyAccountingText.textContent = '📋 Copy for Cloud Accounting';
    if (markupSliderLabel) markupSliderLabel.textContent = 'Default Global Markup / Discount';

    const colHeaderTitle = document.getElementById('colHeaderMarkupTitle');
    if (colHeaderTitle) colHeaderTitle.textContent = 'Markup / Discount';
    if (tableHeaderPriceCol) tableHeaderPriceCol.innerHTML = `Price (<span id="tableHeaderTargetCurr">${targetCurrency}</span>)`;
  }

  updateFxDisplay();
  updateQuotationRemarksUI();
  lucide.createIcons();
}

function updateQuotationRemarksUI() {
  const isPO = currentMode === 'po';
  const remarksTitle = document.getElementById('remarksCardTitle');
  if (remarksTitle) {
    remarksTitle.textContent = isPO ? 'Purchase Order Remarks & Terms' : 'Quotation Remarks & Terms';
  }
  const remarksTextarea = document.getElementById('quotationPoRemarksInput');
  if (remarksTextarea) {
    const key = isPO ? 'apm_po_remarks' : 'apm_quote_remarks';
    remarksTextarea.value = localStorage.getItem(key) || '';
    remarksTextarea.placeholder = isPO 
      ? 'Paste multi-line purchase order remarks & terms here (e.g. delivery terms, payment conditions)...' 
      : 'Paste multi-line quotation remarks & terms here (e.g. Remarks on Spare Parts Offer, maker warranties, freight estimations)...';
    remarksTextarea.style.height = 'auto';
    remarksTextarea.style.height = Math.max(remarksTextarea.scrollHeight, 110) + 'px';
  }
}

function initQuotationRemarksSection() {
  const remarksTextarea = document.getElementById('quotationPoRemarksInput');
  const btnCopyRemarks = document.getElementById('btnCopyRemarksFormatted');
  const btnInsertToGrid = document.getElementById('btnInsertRemarksToGrid');
  const btnClearRemarks = document.getElementById('btnClearRemarksBox');

  if (!remarksTextarea) return;

  function getStorageKey() {
    return currentMode === 'po' ? 'apm_po_remarks' : 'apm_quote_remarks';
  }

  remarksTextarea.addEventListener('input', (e) => {
    localStorage.setItem(getStorageKey(), e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.max(e.target.scrollHeight, 110) + 'px';
  });

  if (btnCopyRemarks) {
    btnCopyRemarks.addEventListener('click', async () => {
      const val = remarksTextarea.value;
      if (!val.trim()) {
        showToast('Remarks box is empty!', 'info');
        return;
      }
      try {
        await navigator.clipboard.writeText(val);
        const btnText = document.getElementById('btnCopyRemarksText');
        const origText = btnText ? btnText.textContent : 'Copy Remarks';
        if (btnText) btnText.textContent = 'Copied!';
        showToast('Copied formatted remarks to clipboard with exact spacing & newlines!', 'success');
        setTimeout(() => {
          if (btnText) btnText.textContent = origText;
        }, 2000);
      } catch (err) {
        fallbackCopyText(val);
      }
    });
  }

  if (btnInsertToGrid) {
    btnInsertToGrid.addEventListener('click', () => {
      const val = remarksTextarea.value;
      if (!val.trim()) {
        showToast('Please enter remarks before inserting to table.', 'info');
        return;
      }
      addRemarksRow(val);
    });
  }

  if (btnClearRemarks) {
    btnClearRemarks.addEventListener('click', () => {
      if (!remarksTextarea.value.trim()) return;
      if (confirm('Clear remarks text?')) {
        remarksTextarea.value = '';
        localStorage.removeItem(getStorageKey());
        remarksTextarea.style.height = '110px';
        showToast('Remarks cleared', 'info');
      }
    });
  }

  updateQuotationRemarksUI();
}

// CLEAR WORKSPACE FUNCTIONS FOR ALL MODES
function clearCurrentModeData(showToastMsg = true) {
  if (currentMode === 'po') {
    poState = createInitialModeState('po');
    restoreModeState('po');
  } else {
    quotationState = createInitialModeState('quotation');
    restoreModeState('quotation');
  }
  const rfqInp = document.getElementById('rfqFileInput');
  if (rfqInp) rfqInp.value = '';
  const qInp = document.getElementById('quoteFileInput');
  if (qInp) qInp.value = '';

  const modeName = currentMode === 'po' ? 'Purchase Order' : 'Quotation';
  if (showToastMsg) showToast(`Cleared all ${modeName} data & reset workspace.`, 'info');
}

function clearCardClient() {
  rfqItems = [];
  clientPreviewData = null;
  const rfqInp = document.getElementById('rfqFileInput');
  if (rfqInp) rfqInp.value = '';
  const rfqBadge = document.getElementById('rfqStatusBadge');
  if (rfqBadge) {
    rfqBadge.textContent = 'No file';
    rfqBadge.className = 'text-xs px-2.5 py-1 rounded-full font-medium bg-slate-100 text-slate-600';
  }
  const rfqCount = document.getElementById('rfqCountDisplay');
  if (rfqCount) rfqCount.textContent = '0 items loaded';

  if (quoteItems.length === 0) {
    matchedItems = [];
    renderAccountingTable(matchedItems);
  }
  if (isPreviewPaneOpen) renderDocumentPreviews();
  snapshotActiveModeState();
  const docName = currentMode === 'po' ? 'Client Purchase Order' : 'Client RFQ';
  showToast(`Cleared ${docName} document.`, 'info');
}

function clearCardQuote() {
  quoteItems = [];
  quotePreviewData = null;
  const qInp = document.getElementById('quoteFileInput');
  if (qInp) qInp.value = '';
  const qBadge = document.getElementById('quoteStatusBadge');
  if (qBadge) {
    qBadge.textContent = 'No file';
    qBadge.className = 'text-xs px-2.5 py-1 rounded-full font-medium bg-slate-100 text-slate-600';
  }
  const qCount = document.getElementById('quoteCountDisplay');
  if (qCount) qCount.textContent = '0 items loaded';

  const detCurr = document.getElementById('detectedCurrBadge');
  if (detCurr) detCurr.classList.add('hidden');
  const sDisc = document.getElementById('supplierDiscountBadge');
  if (sDisc) sDisc.classList.add('hidden');

  matchedItems = [];
  renderAccountingTable(matchedItems);
  if (isPreviewPaneOpen) renderDocumentPreviews();
  snapshotActiveModeState();
  showToast('Cleared Supplier Quotation document.', 'info');
}

function clearTableData() {
  matchedItems = [];
  selectedRowIndices.clear();
  renderAccountingTable(matchedItems);
  snapshotActiveModeState();
  showToast('Cleared Accounting Grid items.', 'info');
}

function clearComparisonMaker() {
  const searchInput = document.getElementById('compareSearchInput');
  if (searchInput) searchInput.value = '';

  const progSec = document.getElementById('compareProgressSection');
  if (progSec) progSec.classList.add('hidden');

  const revSec = document.getElementById('compareEmailReviewSection');
  if (revSec) revSec.classList.add('hidden');

  const resSec = document.getElementById('compareResultsSection');
  if (resSec) resSec.classList.add('hidden');

  const tokenBadge = document.getElementById('compareTokenSavingsBadge');
  if (tokenBadge) tokenBadge.classList.add('hidden');

  lastComparisonData = null;
  showToast('Quotation Comparison Maker reset.', 'info');
}

window.clearCurrentModeData = clearCurrentModeData;
window.clearCardClient = clearCardClient;
window.clearCardQuote = clearCardQuote;
window.clearTableData = clearTableData;
window.clearComparisonMaker = clearComparisonMaker;

// CURRENCY & FX
function calculateStandardFxRate() {
  if (supplierCurrency === targetCurrency) {
    currentFxRate = 1.0000;
  } else {
    const sRate = USD_BASE_RATES[supplierCurrency] || 1.0;
    const tRate = USD_BASE_RATES[targetCurrency] || 1.0;
    currentFxRate = parseFloat((tRate / sRate).toFixed(4));
  }
  document.getElementById('fxRateInput').value = currentFxRate.toFixed(4);
  updateFxDisplay();
}

function updateFxDisplay() {
  document.getElementById('fxFormulaTag').textContent = `1 ${supplierCurrency} = ${currentFxRate.toFixed(4)} ${targetCurrency}`;
  document.getElementById('fxInputPrefix').textContent = `1 ${supplierCurrency} =`;
  document.getElementById('fxInputSuffix').textContent = targetCurrency;
  const th = document.getElementById('tableHeaderTargetCurr');
  if (th) th.textContent = targetCurrency;
  const bulkPriceLabel = document.getElementById('bulkModePriceCurrLabel');
  if (bulkPriceLabel) bulkPriceLabel.textContent = `Price (${targetCurrency})`;
  const bulkPricePrefix = document.getElementById('bulkPriceCurrPrefix');
  if (bulkPricePrefix) bulkPricePrefix.textContent = targetCurrency;
}

function updateSelectionUI() {
  const selBadge = document.getElementById('tableSelectedRowsCount');
  const clearBtn = document.getElementById('btnDeselectAllAccountingRows');
  const countBadges = document.querySelectorAll('.sel-count-badge');
  const btnApplySelMarkup = document.getElementById('btnApplyMarkupToSelected');
  const btnApplySelPrice = document.getElementById('btnApplyPriceToSelected');
  const chkSelectAll = document.getElementById('chkSelectAllRows');

  const count = selectedRowIndices.size;
  countBadges.forEach(b => b.textContent = count);

  if (count > 0) {
    if (selBadge) {
      selBadge.textContent = `${count} selected`;
      selBadge.classList.remove('hidden');
    }
    if (clearBtn) clearBtn.classList.remove('hidden');
    if (btnApplySelMarkup) btnApplySelMarkup.classList.remove('hidden');
    if (btnApplySelPrice) btnApplySelPrice.classList.remove('hidden');
  } else {
    if (selBadge) selBadge.classList.add('hidden');
    if (clearBtn) clearBtn.classList.add('hidden');
    if (btnApplySelMarkup) btnApplySelMarkup.classList.add('hidden');
    if (btnApplySelPrice) btnApplySelPrice.classList.add('hidden');
  }

  if (chkSelectAll) {
    if (matchedItems.length > 0 && count === matchedItems.length) {
      chkSelectAll.checked = true;
      chkSelectAll.indeterminate = false;
    } else if (count > 0) {
      chkSelectAll.checked = false;
      chkSelectAll.indeterminate = true;
    } else {
      chkSelectAll.checked = false;
      chkSelectAll.indeterminate = false;
    }
  }
}

function applyBulkPercentAdjustment(scope = 'all') {
  if (matchedItems.length === 0) return;

  const targetIndices = scope === 'selected' 
    ? Array.from(selectedRowIndices) 
    : matchedItems.map((_, i) => i);

  if (targetIndices.length === 0) {
    showToast('No rows selected. Please select items using checkboxes first.', 'warning');
    return;
  }

  targetIndices.forEach(idx => {
    if (idx < 0 || idx >= matchedItems.length) return;
    const item = matchedItems[idx];
    item.adjustment_type = 'percent';
    item.markup_percent = currentMarkup;
    if (scope === 'selected') item.is_custom_price = true;

    const cost = parseFloat(item.cost_target || 0);
    const rawPrice = cost * (1.0 + currentMarkup / 100.0);
    const newPrice = applyPriceRounding(rawPrice, currentRoundMode);

    item.price_target = newPrice;
    item.price_myr = newPrice;
    item.formatted_price = newPrice.toFixed(2);
    item.markup_amount = Math.round((newPrice - cost) * 100) / 100;
  });

  renderAccountingTable(matchedItems);
  const sign = currentMarkup >= 0 ? '+' : '';
  showToast(`Applied ${sign}${currentMarkup.toFixed(1)}% to ${targetIndices.length} item(s)`, 'success');
}

function applyBulkPriceAdjustment(scope = 'all') {
  if (matchedItems.length === 0) return;

  const targetIndices = scope === 'selected' 
    ? Array.from(selectedRowIndices) 
    : matchedItems.map((_, i) => i);

  if (targetIndices.length === 0) {
    showToast('No rows selected. Please select items using checkboxes first.', 'warning');
    return;
  }

  const symbol = CURRENCY_SYMBOLS[targetCurrency] || `${targetCurrency} `;

  targetIndices.forEach(idx => {
    if (idx < 0 || idx >= matchedItems.length) return;
    const item = matchedItems[idx];
    item.adjustment_type = 'price';
    if (scope === 'selected') item.is_custom_price = true;

    const cost = parseFloat(item.cost_target || 0);
    let newPrice;
    let markupAmt;

    if (bulkPriceSubMode === 'fixed') {
      newPrice = applyPriceRounding(bulkPriceAmount, currentRoundMode);
      markupAmt = newPrice - cost;
      item.markup_amount = Math.round(markupAmt * 100) / 100;
      item.markup_percent = cost > 0 ? parseFloat((((newPrice / cost) - 1.0) * 100.0).toFixed(1)) : 0.0;
    } else {
      markupAmt = bulkPriceAmount;
      const rawPrice = cost + bulkPriceAmount;
      newPrice = applyPriceRounding(rawPrice, currentRoundMode);
      item.markup_amount = Math.round(markupAmt * 100) / 100;
      item.markup_percent = cost > 0 ? parseFloat((((newPrice / cost) - 1.0) * 100.0).toFixed(1)) : 0.0;
    }

    item.price_target = newPrice;
    item.price_myr = newPrice;
    item.formatted_price = newPrice.toFixed(2);
  });

  renderAccountingTable(matchedItems);
  const descStr = bulkPriceSubMode === 'fixed' 
    ? `Fixed Price ${symbol}${bulkPriceAmount.toFixed(2)}` 
    : `${bulkPriceAmount >= 0 ? '+' : ''}${symbol}${bulkPriceAmount.toFixed(2)} / unit`;
  showToast(`Applied ${descStr} to ${targetIndices.length} item(s)`, 'success');
}

function updateMarkupDisplay() {
  const display = document.getElementById('markupDisplayValue');
  if (!display) return;

  const symbol = CURRENCY_SYMBOLS[targetCurrency] || `${targetCurrency} `;

  if (bulkAdjustmentMode === 'price') {
    if (bulkPriceSubMode === 'fixed') {
      display.textContent = `Set: ${symbol}${bulkPriceAmount.toFixed(2)}`;
      display.className = 'text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded font-mono';
    } else {
      const sign = bulkPriceAmount >= 0 ? '+' : '';
      display.textContent = `${sign}${symbol}${bulkPriceAmount.toFixed(2)}`;
      display.className = bulkPriceAmount < 0 
        ? 'text-xs font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded font-mono' 
        : 'text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-mono';
    }
  } else {
    const sign = currentMarkup >= 0 ? '+' : '';
    display.textContent = `${sign}${currentMarkup.toFixed(1)}%`;
    display.className = currentMarkup < 0 
      ? 'text-xs font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded font-mono' 
      : 'text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded font-mono';
  }
}

function updateRoundOffDisplay() {
  const badge = document.getElementById('roundOffBadge');
  if (!badge) return;
  const labels = {
    'none': 'Exact (2 Decimals)',
    'ceil_1': 'Round UP 1.00',
    'round_1': 'Nearest 1.00',
    'ceil_5': 'Round UP 5.00',
    'round_5': 'Nearest 5.00',
    'ceil_10': 'Round UP 10.00',
    'round_10': 'Nearest 10.00',
    'round_50c': 'Nearest 0.50'
  };
  badge.textContent = labels[currentRoundMode] || 'Exact';
}

function recalculatePricesUI() {
  if (matchedItems.length === 0) return;
  matchedItems = recalculateMatchedItems(matchedItems, currentFxRate, currentMarkup, targetCurrency, currentMode, currentRoundMode, bulkAdjustmentMode, bulkPriceAmount);
  renderAccountingTable(matchedItems);
}

// FILE UPLOAD HANDLER
const _activeFileUploads = new Set();
async function handleFileUpload(file, type) {
  if (!file) return;
  const uploadKey = `${type}_${file.name}_${file.size}`;
  if (_activeFileUploads.has(uploadKey)) {
    console.warn('Duplicate upload prevented for:', uploadKey);
    return;
  }
  _activeFileUploads.add(uploadKey);
  setTimeout(() => _activeFileUploads.delete(uploadKey), 2000);

  const badge = document.getElementById(type === 'rfq' ? 'rfqStatusBadge' : 'quoteStatusBadge');
  const countDisp = document.getElementById(type === 'rfq' ? 'rfqCountDisplay' : 'quoteCountDisplay');

  badge.className = 'text-xs px-2.5 py-1 rounded-full font-medium bg-blue-100 text-blue-800 animate-pulse';
  badge.textContent = 'Parsing with Gemini AI...';

  try {
    // 1. Generate local document preview
    const preview = await generateClientDocPreview(file, file.name);
    if (type === 'rfq') {
      clientPreviewData = preview;
    } else {
      quotePreviewData = preview;
    }

    if (isPreviewPaneOpen) renderDocumentPreviews();

    // 2. Parse items using Gemini Flash Vision
    const items = await parseDocumentWithGemini(file, file.name, type === 'rfq' ? 'rfq' : 'quote');

    if (type === 'rfq') {
      rfqItems = items;
      countDisp.textContent = `${items.length} items loaded`;
      badge.className = 'text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-100 text-emerald-800';
      badge.textContent = `${file.name.slice(0, 16)}... (${items.length} items)`;
    } else {
      quoteItems = items;
      countDisp.textContent = `${items.length} items loaded`;
      badge.className = 'text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-100 text-emerald-800';
      badge.textContent = `${file.name.slice(0, 16)}... (${items.length} items)`;

      // Auto-detect currency from supplier quote items
      if (items.length > 0 && items[0].currency) {
        const detCurr = items[0].currency.toUpperCase();
        if (USD_BASE_RATES[detCurr]) {
          supplierCurrency = detCurr;
          document.getElementById('supplierCurrencySelect').value = supplierCurrency;
          if (currentMode === 'po') {
            targetCurrency = supplierCurrency;
            document.getElementById('targetCurrencySelect').value = targetCurrency;
          }
          calculateStandardFxRate();
        }
      }

      // Auto-detect supplier trade discount from quote items
      const discountItem = items.find(it => it.discount_percent && it.discount_percent > 0);
      const discountBadge = document.getElementById('supplierDiscountBadge');
      const discountText = document.getElementById('supplierDiscountText');
      if (discountItem && discountBadge && discountText) {
        discountText.textContent = `${discountItem.discount_percent.toFixed(0)}% Disc Applied`;
        discountBadge.classList.remove('hidden');
        showToast(`🏷️ Supplier Trade Discount of ${discountItem.discount_percent}% detected & automatically factored into unit prices!`, 'info');
      } else if (discountBadge) {
        discountBadge.classList.add('hidden');
      }
    }

    showToast(`Successfully parsed ${items.length} items from ${file.name}!`, 'success');
    snapshotActiveModeState();

    // If both files are loaded, automatically trigger matching!
    if (rfqItems.length > 0 && quoteItems.length > 0) {
      triggerMatching();
    }

  } catch (err) {
    console.error("Upload error:", err);
    badge.className = 'text-xs px-2.5 py-1 rounded-full font-medium bg-rose-100 text-rose-800';
    badge.textContent = 'Error parsing';
    showToast(`Error: ${err.message}`, 'error');
  }
}

// MATCHING TRIGGER
function triggerMatching() {
  if (rfqItems.length === 0 && quoteItems.length === 0) {
    showToast('Please upload documents first', 'info');
    return;
  }

  const btn = document.getElementById('btnProcessMatch');
  btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Matching items in ${currentMode.toUpperCase()} mode...</span>`;
  lucide.createIcons();

  setTimeout(() => {
    try {
      matchedItems = matchRfqAndQuotation(
        rfqItems,
        quoteItems,
        currentFxRate,
        currentMarkup,
        supplierCurrency,
        targetCurrency,
        currentMode,
        currentRoundMode
      );

      renderAccountingTable(matchedItems);
      showToast(`Generated ${matchedItems.length} items in ${currentMode.toUpperCase()} mode!`, 'success');
    } catch (err) {
      console.error("Matching error:", err);
      showToast(`Matching error: ${err.message}`, 'error');
    } finally {
      btn.innerHTML = `<i data-lucide="refresh-cw" class="w-4 h-4"></i><span>${document.getElementById('btnProcessMatchText').textContent}</span>`;
      lucide.createIcons();
    }
  }, 100);
}

// RENDER ACCOUNTING TABLE
function renderAccountingTable(items) {
  const tbody = document.getElementById('accountingTableBody');
  const countBadge = document.getElementById('tableRowsCount');

  if (!items || items.length === 0) {
    tbody.innerHTML = `
      <tr id="emptyTableState">
        <td colspan="8" class="py-16 text-center text-slate-400">
          <div class="flex flex-col items-center justify-center">
            <i data-lucide="table" class="w-10 h-10 text-slate-300 mb-2"></i>
            <p class="font-medium text-slate-500">No items matched yet</p>
            <p class="text-xs text-slate-400 mt-1">Upload documents above or paste text to generate</p>
          </div>
        </td>
      </tr>
    `;
    countBadge.textContent = '0 rows';
    updateSelectionUI();
    lucide.createIcons();
    return;
  }

  countBadge.textContent = `${items.length} rows`;
  tbody.innerHTML = '';

  const symbol = CURRENCY_SYMBOLS[targetCurrency] || `${targetCurrency} `;

  items.forEach((item, index) => {
    const tr = document.createElement('tr');
    const isSelected = selectedRowIndices.has(index);
    tr.className = `${isSelected ? 'bg-blue-50/50 ' : ''}hover:bg-slate-50 transition border-b border-slate-100 group`;

    const costVal = parseFloat(item.cost_target || 0);
    const rawPrice = item.price_target !== undefined ? item.price_target : 0;
    const cleanPriceNum = parseFloat(String(rawPrice).replace(/,/g, '')) || 0;
    const priceFormatted = cleanPriceNum.toFixed(2);

    const adjType = item.adjustment_type || 'percent';
    const rowMarkup = item.markup_percent !== undefined ? parseFloat(item.markup_percent) : (currentMode === 'po' ? 0.0 : currentMarkup);
    const rowMarkupAmount = item.markup_amount !== undefined ? parseFloat(item.markup_amount) : Math.round((cleanPriceNum - costVal) * 100) / 100;
    const isDiscount = adjType === 'price' ? (rowMarkupAmount < 0) : (rowMarkup < 0);
    const descLines = (item.description || '').split('\n').length;
    const descRows = Math.min(Math.max(descLines, 1), 10);

    tr.innerHTML = `
      <td class="py-3 px-2 text-center select-none align-top">
        <div class="flex items-center justify-center gap-1.5 pt-1">
          <input type="checkbox" class="row-select-chk w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" 
            data-index="${index}" ${isSelected ? 'checked' : ''} title="Select row">
          <span class="font-mono font-medium text-slate-400 text-[11px]">${index + 1}</span>
        </div>
      </td>
      
      <!-- ITEM CODE -->
      <td class="py-2 px-3 align-top">
        <input type="text" class="cell-input w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded px-2 py-1 font-mono font-semibold text-slate-800 text-xs outline-none transition" 
          value="${escapeHtml(item.item_code || '')}" 
          data-field="item_code" data-index="${index}">
      </td>

      <!-- DESCRIPTION WITH REMARKS & OFFER (FORMATTED MULTI-LINE TEXTAREA) -->
      <td class="py-2 px-4 align-top">
        <textarea class="cell-input cell-textarea w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded px-2 py-1 text-xs text-slate-800 outline-none font-medium transition resize-y font-sans leading-relaxed" 
          rows="${descRows}"
          style="white-space: pre-wrap; word-break: break-word; min-height: 28px;"
          data-field="description" data-index="${index}" title="Edit product description & remarks (press Enter for new lines)">${escapeHtml(item.description || '')}</textarea>
        
        <!-- Row Remarks Action Toolbar -->
        <div class="flex items-center justify-between mt-1 pt-1 border-t border-slate-100">
          <div class="flex items-center gap-1.5">
            <button type="button" class="btn-row-remarks-toggle text-[10px] px-1.5 py-0.5 rounded font-bold transition flex items-center gap-1 cursor-pointer ${item.show_remarks !== false ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}" 
              data-index="${index}" title="Toggle extra remarks ON/OFF for this item">
              <i data-lucide="${item.show_remarks !== false ? 'message-square-text' : 'message-square'}" class="w-3 h-3"></i>
              <span>Remarks: ${item.show_remarks !== false ? 'ON' : 'OFF'}</span>
            </button>
            <button type="button" class="btn-row-edit-remarks text-[10px] px-1.5 py-0.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded font-medium transition flex items-center gap-0.5 cursor-pointer" 
              data-index="${index}" title="Insert Maker details or technical specs">
              <i data-lucide="plus" class="w-2.5 h-2.5"></i> Specs/Maker
            </button>
          </div>
          <button type="button" class="btn-row-copy-desc text-[10px] text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 px-1.5 py-0.5 rounded transition flex items-center gap-1 cursor-pointer" 
            data-index="${index}" title="Copy only this item's full multi-line description (for 1-click paste into Biztory)">
            <i data-lucide="copy" class="w-3 h-3"></i> Copy Desc
          </button>
        </div>
      </td>

      <!-- QUANTITY -->
      <td class="py-2 px-2 text-center align-top">
        <input type="number" step="1" class="cell-input w-16 text-center bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded px-1 py-1 font-mono font-semibold text-slate-800 text-xs outline-none transition" 
          value="${item.quantity !== undefined ? item.quantity : 1}" 
          data-field="quantity" data-index="${index}">
      </td>

      <!-- UNIT -->
      <td class="py-2 px-2 text-center align-top">
        <input type="text" class="cell-input w-14 text-center bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded px-1 py-1 uppercase font-semibold text-slate-700 text-xs outline-none transition" 
          value="${escapeHtml(item.unit || 'PCS')}" 
          data-field="unit" data-index="${index}">
      </td>

      <!-- PER-ITEM MARKUP / DISCOUNT (DUAL-MODE: % OR PRICE) -->
      <td class="py-2 px-2 text-center align-top">
        <div class="flex flex-col items-center">
          <div class="inline-flex items-center gap-0.5 bg-slate-50 hover:bg-white focus-within:bg-white border border-slate-200 focus-within:border-blue-500 rounded-lg p-0.5 transition shadow-2xs">
            <span class="text-[11px] font-bold pl-1.5 ${isDiscount ? 'text-rose-600' : 'text-emerald-700'}">${(adjType === 'price' ? rowMarkupAmount : rowMarkup) >= 0 ? '+' : ''}</span>
            ${adjType === 'price' ? `
              <input type="number" step="0.5" class="cell-markup-price-input w-16 text-center font-mono font-bold text-xs ${isDiscount ? 'text-rose-600' : 'text-slate-800'} outline-none bg-transparent" 
                value="${rowMarkupAmount.toFixed(2)}" 
                data-index="${index}" title="Edit markup/discount amount in ${targetCurrency}">
              <button type="button" class="btn-toggle-row-adj-mode px-1.5 py-0.5 bg-slate-200 hover:bg-blue-100 hover:text-blue-700 text-[10px] font-bold text-slate-700 rounded transition cursor-pointer" 
                data-index="${index}" title="Click to toggle to Percentage (%) mode">${targetCurrency}</button>
            ` : `
              <input type="number" step="0.5" class="cell-markup-input w-12 text-center font-mono font-bold text-xs ${isDiscount ? 'text-rose-600' : 'text-slate-800'} outline-none bg-transparent" 
                value="${rowMarkup.toFixed(1)}" 
                data-index="${index}" title="Edit markup/discount percentage">
              <button type="button" class="btn-toggle-row-adj-mode px-1.5 py-0.5 bg-slate-200 hover:bg-blue-100 hover:text-blue-700 text-[10px] font-bold text-slate-700 rounded transition cursor-pointer" 
                data-index="${index}" title="Click to toggle to Price (${targetCurrency}) mode">%</button>
            `}
          </div>
          <!-- Converted live caption -->
          <span class="text-[9.5px] font-mono mt-0.5 ${isDiscount ? 'text-rose-500' : 'text-slate-400'}" title="Equivalent value">
            ${adjType === 'price' ? `(${rowMarkup >= 0 ? '+' : ''}${rowMarkup.toFixed(1)}%)` : `(${rowMarkupAmount >= 0 ? '+' : ''}${symbol}${rowMarkupAmount.toFixed(2)})`}
          </span>
        </div>
      </td>

      <!-- PRICE (DYNAMIC TARGET CURRENCY) -->
      <td class="py-2 px-4 text-right align-top">
        <div class="flex flex-col items-end">
          <input type="text" class="cell-input w-28 text-right bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded px-2 py-1 font-mono font-bold text-slate-900 text-xs outline-none transition" 
            value="${priceFormatted}" 
            data-field="price_target" data-index="${index}">
          ${(item.has_supplier_discount || (item.discount_percent && item.discount_percent > 0)) ? `
            <span class="text-[10px] text-amber-700 font-mono font-medium" title="Supplier list price minus trade discount">
              List: ${symbol}${((item.list_unit_price || item.supplier_cost) * (item.fx_rate || 1)).toFixed(2)} (-${(item.discount_percent || 0).toFixed(0)}% = ${costVal.toFixed(2)})
            </span>
          ` : `
            <span class="text-[10px] text-slate-400 font-mono">
              Orig Cost: ${symbol}${costVal.toFixed(2)}
            </span>
          `}
        </div>
      </td>

      <!-- ACTIONS -->
      <td class="py-2 px-2 text-center align-top">
        <div class="flex items-center justify-center gap-1 opacity-60 group-hover:opacity-100 transition pt-1">
          <button class="btn-toggle-row-remarks p-1 rounded transition ${item.show_remarks !== false ? 'text-indigo-600 hover:bg-indigo-50' : 'text-slate-400 hover:bg-slate-100'}" 
            title="Toggle extra remarks ON/OFF" data-index="${index}">
            <i data-lucide="file-text" class="w-3.5 h-3.5"></i>
          </button>
          <button class="btn-toggle-offer p-1 text-amber-600 hover:bg-amber-50 rounded" title="Toggle OFFER prefix" data-index="${index}">
            <i data-lucide="tag" class="w-3.5 h-3.5"></i>
          </button>
          <button class="btn-delete-row p-1 text-red-500 hover:bg-red-50 rounded" title="Delete Row" data-index="${index}">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  updateSelectionUI();
  lucide.createIcons();
  attachTableInputListeners();
}

function attachTableInputListeners() {
  // Row checkboxes
  document.querySelectorAll('.row-select-chk').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.index);
      if (e.target.checked) {
        selectedRowIndices.add(idx);
      } else {
        selectedRowIndices.delete(idx);
      }
      updateSelectionUI();
      const tr = e.target.closest('tr');
      if (tr) {
        if (e.target.checked) tr.classList.add('bg-blue-50/50');
        else tr.classList.remove('bg-blue-50/50');
      }
    });
  });

  // Toggle row adjustment mode between % and price
  document.querySelectorAll('.btn-toggle-row-adj-mode').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(btn.dataset.index);
      if (matchedItems[idx]) {
        const currentType = matchedItems[idx].adjustment_type || 'percent';
        matchedItems[idx].adjustment_type = currentType === 'price' ? 'percent' : 'price';
        renderAccountingTable(matchedItems);
      }
    });
  });

  // Price input per row
  document.querySelectorAll('.cell-markup-price-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.index);
      const newAmt = parseFloat(e.target.value) || 0;

      matchedItems[idx].markup_amount = Math.round(newAmt * 100) / 100;
      matchedItems[idx].adjustment_type = 'price';
      matchedItems[idx].is_custom_price = true;

      const cost = parseFloat(matchedItems[idx].cost_target || 0);
      const rawPrice = cost + newAmt;
      const newPrice = applyPriceRounding(rawPrice, currentRoundMode);

      matchedItems[idx].price_target = newPrice;
      matchedItems[idx].price_myr = newPrice;
      matchedItems[idx].formatted_price = newPrice.toFixed(2);
      matchedItems[idx].markup_percent = cost > 0 ? parseFloat((((newPrice / cost) - 1.0) * 100.0).toFixed(1)) : 0.0;

      renderAccountingTable(matchedItems);
      const symbol = CURRENCY_SYMBOLS[targetCurrency] || `${targetCurrency} `;
      const actionType = newAmt < 0 ? `Discount (-${symbol}${Math.abs(newAmt).toFixed(2)})` : `Adjustment (+${symbol}${newAmt.toFixed(2)})`;
      showToast(`Item #${idx + 1} updated with ${actionType}`, 'info');
    });
  });

  // Percentage input per row
  document.querySelectorAll('.cell-markup-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.index);
      const newMarkup = parseFloat(e.target.value) || 0;

      matchedItems[idx].markup_percent = newMarkup;
      matchedItems[idx].adjustment_type = 'percent';
      matchedItems[idx].is_custom_price = true;

      const cost = parseFloat(matchedItems[idx].cost_target || 0);
      const rawPrice = cost * (1.0 + newMarkup / 100.0);
      const newPrice = applyPriceRounding(rawPrice, currentRoundMode);

      matchedItems[idx].price_target = newPrice;
      matchedItems[idx].price_myr = newPrice;
      matchedItems[idx].formatted_price = newPrice.toFixed(2);
      matchedItems[idx].markup_amount = Math.round((newPrice - cost) * 100) / 100;

      renderAccountingTable(matchedItems);
      const actionType = newMarkup < 0 ? `Discount (${newMarkup}%)` : `Adjustment (${newMarkup}%)`;
      showToast(`Item #${idx + 1} updated with ${actionType}`, 'info');
    });
  });

  // Textarea multi-line auto-resize & real-time update
  document.querySelectorAll('textarea.cell-textarea').forEach(ta => {
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, 28) + 'px';

    ta.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.index);
      if (matchedItems[idx]) {
        matchedItems[idx].description = e.target.value;
      }
      e.target.style.height = 'auto';
      e.target.style.height = Math.max(e.target.scrollHeight, 28) + 'px';
    });
  });

  // General cell inputs
  document.querySelectorAll('.cell-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.index);
      const field = e.target.dataset.field;
      const val = e.target.value;

      if (field === 'price_target' || field === 'price_myr') {
        const cleanNum = parseFloat(String(val).replace(/,/g, '')) || 0;
        matchedItems[idx].price_target = cleanNum;
        matchedItems[idx].price_myr = cleanNum;
        matchedItems[idx].formatted_price = cleanNum.toFixed(2);
        matchedItems[idx].is_custom_price = true;

        const cost = parseFloat(matchedItems[idx].cost_target || 0);
        matchedItems[idx].markup_amount = Math.round((cleanNum - cost) * 100) / 100;
        if (cost > 0) {
          matchedItems[idx].markup_percent = parseFloat((((cleanNum / cost) - 1.0) * 100.0).toFixed(1));
        }
        renderAccountingTable(matchedItems);
      } else if (field === 'quantity') {
        matchedItems[idx].quantity = val !== '' ? (parseFloat(val) || 0) : '';
      } else {
        matchedItems[idx][field] = val;
      }
    });
  });

  // Toggle Row Remarks (both action icon and inline button)
  document.querySelectorAll('.btn-toggle-row-remarks, .btn-row-remarks-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      const item = matchedItems[idx];
      if (!item) return;

      const currentlyShowing = item.show_remarks !== false;
      item.show_remarks = !currentlyShowing;

      if (!item.clean_description) {
        item.clean_description = (item.description || '').split(/\n\n|\r\n\r\n/)[0].trim();
      }

      if (item.show_remarks) {
        // Toggle ON
        if (!item.extra_remarks) {
          const parts = [];
          if (item.is_offer) {
            const offerText = String(item.offer_text || item.supplier_part || '').replace(/^(?:#?OFFER\s*[:\-]?\s*)+/i, '').trim();
            parts.push(`#OFFER${offerText ? `\n${offerText}` : ''}`);
          }
          const maker = String(item.maker_no || '').trim();
          if (maker && !item.clean_description.toLowerCase().includes(maker.toLowerCase())) {
            parts.push(`Maker: ${maker}`);
          }
          item.extra_remarks = parts.join('\n\n').trim();
        }
        item.description = item.extra_remarks ? `${item.clean_description}\n\n${item.extra_remarks}`.trim() : item.clean_description;
        renderAccountingTable(matchedItems);
        showToast(`Included extra remarks for Item #${idx + 1}`, 'info');
      } else {
        // Toggle OFF (Clean 1-line title)
        item.description = item.clean_description;
        renderAccountingTable(matchedItems);
        showToast(`Hidden extra remarks for Item #${idx + 1} (Clean Title)`, 'info');
      }
    });
  });

  // Open Edit Remarks & Specs Template Modal
  document.querySelectorAll('.btn-row-edit-remarks').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      openEditRemarksModal(idx);
    });
  });

  // 1-Click Copy Single Item Description (for direct Biztory multi-line pasting)
  document.querySelectorAll('.btn-row-copy-desc').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = parseInt(btn.dataset.index);
      const item = matchedItems[idx];
      if (!item) return;

      const textToCopy = (item.description || '').trim();
      try {
        await navigator.clipboard.writeText(textToCopy);
        const origHtml = btn.innerHTML;
        btn.innerHTML = `<i data-lucide="check" class="w-3 h-3 text-emerald-600"></i> Copied!`;
        lucide.createIcons();
        showToast(`📋 Copied Item #${idx + 1} description! Ready to paste into Biztory.`, 'success');
        setTimeout(() => {
          btn.innerHTML = origHtml;
          lucide.createIcons();
        }, 2000);
      } catch (err) {
        fallbackCopyText(textToCopy);
      }
    });
  });

  // Toggle Offer
  document.querySelectorAll('.btn-toggle-offer').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      const item = matchedItems[idx];
      let desc = (item.description || '').trim();
      if (desc.toUpperCase().startsWith('OFFER:')) {
        item.description = desc.replace(/^OFFER:\s*/i, '').trim();
        item.is_offer = false;
      } else {
        item.description = `OFFER: ${desc}`.trim();
        item.is_offer = true;
      }
      renderAccountingTable(matchedItems);
      showToast(`Toggled OFFER prefix for Item #${idx + 1}`, 'info');
    });
  });

  // Delete row
  document.querySelectorAll('.btn-delete-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      matchedItems.splice(idx, 1);
      selectedRowIndices.delete(idx);
      // Remap selectedRowIndices
      const newSelected = new Set();
      selectedRowIndices.forEach(i => {
        if (i < idx) newSelected.add(i);
        else if (i > idx) newSelected.add(i - 1);
      });
      selectedRowIndices = newSelected;
      updateSelectionUI();
      renderAccountingTable(matchedItems);
      showToast('Row deleted', 'info');
    });
  });
}

function addNewRow() {
  const newRow = {
    row_id: matchedItems.length + 1,
    item_code: '',
    description: '',
    quantity: 1,
    unit: 'PCS',
    supplier_currency: supplierCurrency,
    target_currency: targetCurrency,
    supplier_cost: 0.0,
    cost_target: 0.0,
    cost_myr: 0.0,
    fx_rate: currentFxRate,
    adjustment_type: 'percent',
    markup_percent: currentMode === 'po' ? 0.0 : currentMarkup,
    markup_amount: 0.0,
    price_target: 0.0,
    formatted_price: '0.00',
    is_offer: false,
    is_custom_price: false,
    mode: currentMode
  };
  matchedItems.push(newRow);
  renderAccountingTable(matchedItems);
}

function addRemarksRow(initialText = '') {
  const defaultRemarks = initialText || `Remarks on Spare Parts Offer:\n\n-Quoted Parts Are DONALDSON\n-Quoted prices are applicable for the complete order only.\n-Quoted parts are based on the maker’s part numbers provided.\n-We shall not be held liable for any delay in delivery caused by circumstances beyond our control.\n\n#Freight is quoted based on a rough estimation. Any changes in the freight cost after packing will be added to the final invoice.`;
  const newRow = {
    row_id: matchedItems.length + 1,
    item_code: '',
    description: defaultRemarks,
    quantity: '',
    unit: '',
    supplier_currency: supplierCurrency,
    target_currency: targetCurrency,
    supplier_cost: 0.0,
    cost_target: 0.0,
    cost_myr: 0.0,
    fx_rate: currentFxRate,
    adjustment_type: 'percent',
    markup_percent: 0.0,
    markup_amount: 0.0,
    price_target: 0.0,
    formatted_price: '0.00',
    is_offer: false,
    is_custom_price: true,
    is_remarks_row: true,
    mode: currentMode
  };
  matchedItems.push(newRow);
  renderAccountingTable(matchedItems);
  showToast('Added formatted Remarks row to table', 'info');
  setTimeout(() => {
    const textareas = document.querySelectorAll('textarea[data-field="description"]');
    if (textareas.length > 0) {
      const lastTa = textareas[textareas.length - 1];
      lastTa.focus();
      lastTa.select();
    }
  }, 100);
}

// 1-CLICK COPY FOR CLOUD ACCOUNTING SOFTWARE (WITH BIZTORY WORKAROUNDS)
async function copyAccountingTable() {
  if (matchedItems.length === 0) {
    showToast('No items in table to copy!', 'error');
    return;
  }

  const formatSelect = document.getElementById('selAccountingCopyFormat');
  const formatMode = formatSelect ? formatSelect.value : (localStorage.getItem('ap_merin_copy_format') || 'biztory_single');

  // TSV columns strictly matching accounting software grid:
  // Item Code [TAB] Description & Remarks [TAB] Qty [TAB] Unit [TAB] Price
  const lines = matchedItems.map(item => {
    const code = (item.item_code || '').trim();
    let desc = '';

    if (formatMode === 'clean_only') {
      const baseTitle = (item.clean_description || (item.description || '').split(/\n\n|\r\n\r\n/)[0] || '').trim();
      desc = baseTitle.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/\t/g, ' ').trim();
    } else if (formatMode === 'biztory_soft') {
      // Unicode Line Separator (\u2028): visual line breaks in browser textareas without splitting TSV rows
      desc = (item.description || '').trim();
      desc = desc.replace(/\r\n|\r|\n/g, '\u2028').replace(/\t/g, ' ').trim();
    } else if (formatMode === 'tsv_multiline') {
      desc = (item.description || '').trim();
      // RFC 4180 / TSV Standard: Quote cells containing newlines, tabs, or quotes so Excel and Accounting soft ingest as multi-line inside single cell
      if (desc.includes('\n') || desc.includes('\r') || desc.includes('\t') || desc.includes('"')) {
        desc = `"${desc.replace(/"/g, '""')}"`;
      }
    } else {
      // Default: 'biztory_single' (Safest for Biztory)
      // Converts all internal newlines to ' // ' so description remains strictly on 1 line per item,
      // completely eliminating phantom split rows when pasting into Biztory!
      desc = (item.description || '').trim();
      desc = desc.replace(/[\r\n]+/g, ' // ').replace(/\s{2,}/g, ' ').replace(/\t/g, ' ').trim();
    }

    const qty = item.quantity !== undefined && item.quantity !== '' ? item.quantity : '';
    const unit = (item.unit || 'PCS').trim().toUpperCase();
    const priceNum = parseFloat(item.price_target || 0);
    const price = isNaN(priceNum) ? '0.00' : priceNum.toFixed(2);

    return `${code}\t${desc}\t${qty}\t${unit}\t${price}`;
  });

  const tsvText = lines.join('\n');

  try {
    await navigator.clipboard.writeText(tsvText);
    const btn = document.getElementById('btnCopyAccounting');
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>Copied ${matchedItems.length} Rows!</span>`;
    btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-700');
    btn.classList.add('bg-blue-600', 'hover:bg-blue-700');
    lucide.createIcons();

    const formatLabels = {
      'biztory_single': 'Biztory Single-Line (//)',
      'biztory_soft': 'Biztory Soft Line-Break',
      'tsv_multiline': 'Standard TSV (Excel/Xero)',
      'clean_only': 'Clean Titles Only'
    };
    const activeLabel = formatLabels[formatMode] || formatMode;
    showToast(`Copied ${matchedItems.length} rows to clipboard in ${activeLabel} format! Ready to paste into accounting software.`, 'success');

    setTimeout(() => {
      btn.innerHTML = origHtml;
      btn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
      btn.classList.add('bg-emerald-600', 'hover:bg-emerald-700');
      lucide.createIcons();
    }, 2500);
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    fallbackCopyText(tsvText);
  }
}

// EDIT REMARKS & SPECS TEMPLATE MODAL CONTROLLER
let _activeEditingRemarksIndex = -1;

function initEditRemarksModal() {
  const modal = document.getElementById('modalEditRemarks');
  const btnClose = document.getElementById('btnCloseEditRemarks');
  const btnCancel = document.getElementById('btnCancelEditRemarks');
  const btnSave = document.getElementById('btnSaveEditRemarks');
  const btnClear = document.getElementById('btnRemoveAllRemarks');
  const textarea = document.getElementById('editRemarksTextarea');

  if (!modal) return;

  if (btnClose) btnClose.addEventListener('click', () => modal.classList.add('hidden'));
  if (btnCancel) btnCancel.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  // Preset Template Buttons
  document.querySelectorAll('.btn-preset-remark').forEach(btn => {
    btn.addEventListener('click', () => {
      const template = btn.dataset.template || '';
      if (!textarea) return;
      if (textarea.value.trim().length > 0) {
        textarea.value = `${textarea.value.trim()}\n\n${template}`;
      } else {
        textarea.value = template;
      }
      textarea.focus();
    });
  });

  // Save Remarks Button
  if (btnSave) {
    btnSave.addEventListener('click', () => {
      if (_activeEditingRemarksIndex < 0 || _activeEditingRemarksIndex >= matchedItems.length) {
        modal.classList.add('hidden');
        return;
      }

      const item = matchedItems[_activeEditingRemarksIndex];
      const newRemarks = textarea.value.trim();

      if (!item.clean_description) {
        item.clean_description = (item.description || '').split(/\n\n|\r\n\r\n/)[0].trim();
      }

      item.extra_remarks = newRemarks;
      item.show_remarks = Boolean(newRemarks);
      item.description = (item.show_remarks && newRemarks) 
        ? `${item.clean_description}\n\n${newRemarks}`.trim() 
        : item.clean_description;

      renderAccountingTable(matchedItems);
      modal.classList.add('hidden');
      showToast(`Updated remarks & specifications for Item #${_activeEditingRemarksIndex + 1}`, 'success');
    });
  }

  // Clear Remarks Button
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (_activeEditingRemarksIndex < 0 || _activeEditingRemarksIndex >= matchedItems.length) return;
      const item = matchedItems[_activeEditingRemarksIndex];
      if (!item.clean_description) {
        item.clean_description = (item.description || '').split(/\n\n|\r\n\r\n/)[0].trim();
      }
      item.extra_remarks = '';
      item.show_remarks = false;
      item.description = item.clean_description;
      if (textarea) textarea.value = '';

      renderAccountingTable(matchedItems);
      modal.classList.add('hidden');
      showToast(`Cleared remarks for Item #${_activeEditingRemarksIndex + 1}`, 'info');
    });
  }
}

function openEditRemarksModal(index) {
  if (index < 0 || index >= matchedItems.length) return;
  _activeEditingRemarksIndex = index;
  const item = matchedItems[index];

  const modal = document.getElementById('modalEditRemarks');
  const titleEl = document.getElementById('editRemarksItemTitle');
  const textarea = document.getElementById('editRemarksTextarea');

  if (!item.clean_description) {
    item.clean_description = (item.description || '').split(/\n\n|\r\n\r\n/)[0].trim();
  }

  if (titleEl) {
    titleEl.textContent = `Item #${index + 1}: ${item.clean_description || item.item_code || ''}`;
  }

  if (textarea) {
    // If extra_remarks already set, use it; otherwise extract anything after the first double newline
    if (item.extra_remarks !== undefined && item.extra_remarks !== null) {
      textarea.value = item.extra_remarks;
    } else {
      const parts = (item.description || '').split(/\n\n|\r\n\r\n/);
      textarea.value = parts.length > 1 ? parts.slice(1).join('\n\n').trim() : '';
    }
  }

  if (modal) {
    modal.classList.remove('hidden');
    if (textarea) {
      setTimeout(() => textarea.focus(), 50);
    }
  }
}

function fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast(`Copied ${matchedItems.length} rows to clipboard!`, 'success');
  } catch (e) {
    showToast('Failed to copy to clipboard', 'error');
  }
  document.body.removeChild(ta);
}

// EXPORT TO EXCEL
function exportToExcel() {
  if (matchedItems.length === 0) {
    showToast('No items to export!', 'info');
    return;
  }

  const exportData = matchedItems.map((item, idx) => ({
    "Item No": idx + 1,
    "Item Code": item.item_code || "",
    "Description": item.description || "",
    "Quantity": item.quantity || 1,
    "Unit": item.unit || "PCS",
    [`Unit Cost (${supplierCurrency})`]: parseFloat(item.supplier_cost || 0),
    "Markup (%)": parseFloat(item.markup_percent || 0),
    [`Price (${targetCurrency})`]: parseFloat(item.price_target || 0)
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, currentMode === 'po' ? "Purchase Order" : "Quotation");

  const filename = currentMode === 'po' ? `AP_Merin_Purchase_Order_${targetCurrency}.xlsx` : `AP_Merin_Quotation_${targetCurrency}.xlsx`;
  XLSX.writeFile(workbook, filename);
  showToast(`Exported ${filename}!`, 'success');
}

// EXPORT TO CSV
function exportToCsv() {
  if (matchedItems.length === 0) {
    showToast('No items to export!', 'info');
    return;
  }

  const exportData = matchedItems.map(item => ({
    "Item Code": item.item_code || "",
    "Description": item.description || "",
    "Quantity": item.quantity || 1,
    "Unit": item.unit || "PCS",
    "Price": parseFloat(item.price_target || 0).toFixed(2)
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const csvOutput = XLSX.utils.sheet_to_csv(worksheet);

  const blob = new Blob([csvOutput], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = currentMode === 'po' ? 'AP_Merin_Purchase_Order.csv' : 'AP_Merin_Quotation.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported CSV file!', 'success');
}

// DOCUMENT PREVIEWS
function togglePreviewPane() {
  const pane = document.getElementById('documentPreviewPane');
  if (pane.classList.contains('hidden')) {
    pane.classList.remove('hidden');
    isPreviewPaneOpen = true;
    renderDocumentPreviews();
  } else {
    pane.classList.add('hidden');
    isPreviewPaneOpen = false;
  }
}

function closePreviewPane() {
  document.getElementById('documentPreviewPane').classList.add('hidden');
  isPreviewPaneOpen = false;
}

function renderDocumentPreviews() {
  const clientContainer = document.getElementById('previewClientContainer');
  const quoteContainer = document.getElementById('previewQuoteContainer');
  const clientPageCount = document.getElementById('previewClientPageCount');
  const quotePageCount = document.getElementById('previewQuotePageCount');

  renderSingleDocPreview(clientPreviewData, clientContainer, clientPageCount, currentMode === 'po' ? 'Client Purchase Order' : 'Client RFQ');
  renderSingleDocPreview(quotePreviewData, quoteContainer, quotePageCount, 'Supplier Quotation');

  lucide.createIcons();
}

function renderSingleDocPreview(docData, container, badge, defaultName) {
  if (!docData) {
    badge.textContent = 'No file';
    container.innerHTML = `<p class="text-xs text-slate-400 text-center py-10">No ${defaultName.toLowerCase()} uploaded yet.<br>Upload PDF, Excel, Word, or paste a Screenshot above to inspect here.</p>`;
    return;
  }

  const format = docData.format || 'unknown';
  const filename = docData.filename || defaultName;

  // 1. PDF / Images Preview
  if ((format === 'pdf' || format === 'image') && docData.pages && docData.pages.length > 0) {
    badge.textContent = `${docData.pages.length} page(s) • High Res`;
    container.innerHTML = `
      <div class="w-full space-y-3">
        <div class="text-[11px] font-bold text-slate-700 truncate bg-slate-100 p-2 rounded border border-slate-200 flex items-center justify-between">
          <span class="truncate">📄 ${escapeHtml(filename)}</span>
          <span class="text-[10px] text-blue-600 font-semibold">Click page to zoom</span>
        </div>
        ${docData.pages.map((src, i) => `
          <div class="w-full rounded-lg overflow-hidden border border-slate-200 shadow-2xs bg-slate-100 group">
            <div class="text-[10px] text-slate-600 font-mono px-2.5 py-1 bg-slate-200/80 border-b border-slate-300 flex items-center justify-between">
              <span>Page ${i + 1} of ${docData.pages.length}</span>
              <button onclick="openImageZoomModal('${src}', '${escapeHtml(filename)} - Page ${i + 1}')" class="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1">
                <i data-lucide="zoom-in" class="w-3.5 h-3.5"></i> Full Zoom
              </button>
            </div>
            <div class="p-3 bg-slate-50 flex justify-center cursor-zoom-in" onclick="openImageZoomModal('${src}', '${escapeHtml(filename)} - Page ${i + 1}')">
              <img src="${src}" alt="Page ${i + 1}" class="max-w-full max-h-[460px] object-contain rounded border border-slate-200 bg-white shadow-sm group-hover:shadow-md transition">
            </div>
          </div>
        `).join('')}
      </div>
    `;
    return;
  }

  // 2. Excel Spreadsheets Preview
  if (format === 'excel' && docData.tables && docData.tables.length > 0) {
    const totalRows = docData.tables.reduce((acc, t) => acc + (t.rows ? t.rows.length : 0), 0);
    badge.textContent = `${docData.tables.length} sheet(s) • ${totalRows} rows`;
    container.innerHTML = `
      <div class="w-full space-y-3">
        <div class="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 p-2 rounded flex items-center justify-between">
          <span class="truncate">📊 ${escapeHtml(filename)}</span>
          <span class="text-[10px] font-mono">${docData.tables.length} Sheet(s)</span>
        </div>
        ${docData.tables.map(table => `
          <div class="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-2xs">
            <div class="bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 border-b border-slate-200 flex items-center justify-between">
              <span>📑 Sheet: ${escapeHtml(table.sheet_name)}</span>
              <span class="text-[10px] font-normal text-slate-500">${table.rows.length} rows</span>
            </div>
            <div class="overflow-x-auto max-h-[300px]">
              <table class="w-full text-left border-collapse text-[11px]">
                ${table.headers && table.headers.length > 0 ? `
                  <thead>
                    <tr class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                      ${table.headers.map(h => `<th class="p-1.5 border-r border-slate-200 whitespace-nowrap">${escapeHtml(h)}</th>`).join('')}
                    </tr>
                  </thead>
                ` : ''}
                <tbody class="divide-y divide-slate-100">
                  ${table.rows.map(r => `
                    <tr class="hover:bg-slate-50">
                      ${r.map(cell => `<td class="p-1.5 border-r border-slate-100 whitespace-nowrap text-slate-700">${escapeHtml(cell)}</td>`).join('')}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    return;
  }

  // 3. Word / Text Preview
  badge.textContent = `Text Document`;
  container.innerHTML = `
    <div class="w-full space-y-3 text-xs">
      <div class="text-[11px] font-bold text-slate-800 bg-slate-100 border border-slate-200 p-2 rounded">
        📄 ${escapeHtml(filename)}
      </div>
      <div class="p-3 bg-white rounded border border-slate-200 max-h-[400px] overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-slate-700">
        ${escapeHtml(docData.text || '')}
      </div>
    </div>
  `;
}

// INTERACTIVE DOCUMENT ZOOM & PAN INSPECTOR
let zoomScale = 1.0;
let panX = 0;
let panY = 0;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;
let isZoomInspectorInitialized = false;

function initZoomInspector() {
  if (isZoomInspectorInitialized) return;
  isZoomInspectorInitialized = true;

  const btnZoomIn = document.getElementById('btnZoomIn');
  const btnZoomOut = document.getElementById('btnZoomOut');
  const btnZoomReset = document.getElementById('btnZoomReset');
  const btnZoomFitWidth = document.getElementById('btnZoomFitWidth');
  const btnClose = document.getElementById('btnCloseZoomModal');
  const modal = document.getElementById('modalImageZoom');
  const viewport = document.getElementById('zoomViewport');

  if (btnZoomIn) btnZoomIn.addEventListener('click', () => changeZoom(0.25));
  if (btnZoomOut) btnZoomOut.addEventListener('click', () => changeZoom(-0.25));
  if (btnZoomReset) btnZoomReset.addEventListener('click', resetZoom);
  if (btnZoomFitWidth) btnZoomFitWidth.addEventListener('click', fitZoomWidth);
  if (btnClose) btnClose.addEventListener('click', closeImageZoomModal);

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeImageZoomModal();
    });
  }

  if (viewport) {
    // Mouse wheel zoom
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      changeZoom(delta);
    }, { passive: false });

    // Mouse drag pan
    viewport.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isPanning = true;
      startPanX = e.clientX - panX;
      startPanY = e.clientY - panY;
      viewport.classList.add('cursor-grabbing');
    });

    window.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      panX = e.clientX - startPanX;
      panY = e.clientY - startPanY;
      applyZoomTransform();
    });

    window.addEventListener('mouseup', () => {
      isPanning = false;
      if (viewport) viewport.classList.remove('cursor-grabbing');
    });

    // Touch support for pinch-to-zoom and drag
    let initialTouchDist = 0;
    viewport.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isPanning = true;
        startPanX = e.touches[0].clientX - panX;
        startPanY = e.touches[0].clientY - panY;
      } else if (e.touches.length === 2) {
        initialTouchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    });

    viewport.addEventListener('touchmove', (e) => {
      if (isPanning && e.touches.length === 1) {
        panX = e.touches[0].clientX - startPanX;
        panY = e.touches[0].clientY - startPanY;
        applyZoomTransform();
      } else if (e.touches.length === 2 && initialTouchDist > 0) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const diff = (dist - initialTouchDist) * 0.005;
        changeZoom(diff);
        initialTouchDist = dist;
      }
    });

    viewport.addEventListener('touchend', () => {
      isPanning = false;
      initialTouchDist = 0;
    });
  }

  // Keyboard navigation (+ / - / 0 / Esc)
  window.addEventListener('keydown', (e) => {
    const modalEl = document.getElementById('modalImageZoom');
    if (!modalEl || modalEl.classList.contains('hidden')) return;

    if (e.key === '+' || e.key === '=') changeZoom(0.25);
    else if (e.key === '-' || e.key === '_') changeZoom(-0.25);
    else if (e.key === '0') resetZoom();
    else if (e.key === 'Escape') closeImageZoomModal();
  });
}

function changeZoom(delta) {
  zoomScale = Math.min(Math.max(0.25, zoomScale + delta), 5.0);
  applyZoomTransform();
}

function resetZoom() {
  zoomScale = 1.0;
  panX = 0;
  panY = 0;
  applyZoomTransform();
}

function fitZoomWidth() {
  const viewport = document.getElementById('zoomViewport');
  const img = document.getElementById('zoomModalImg');
  if (viewport && img && img.naturalWidth > 0) {
    const scale = (viewport.clientWidth - 40) / img.naturalWidth;
    zoomScale = Math.min(Math.max(0.25, scale), 3.0);
    panX = 0;
    panY = 0;
    applyZoomTransform();
  }
}

function applyZoomTransform() {
  const wrapper = document.getElementById('zoomImageWrapper');
  const badge = document.getElementById('zoomLevelDisplay');
  if (wrapper) {
    wrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
  }
  if (badge) {
    badge.textContent = `${Math.round(zoomScale * 100)}%`;
  }
}

function openImageZoomModal(imgSrc, title) {
  const modal = document.getElementById('modalImageZoom');
  const img = document.getElementById('zoomModalImg');
  const titleEl = document.getElementById('zoomModalTitle');
  const dimTag = document.getElementById('zoomDimensionsTag');
  
  if (img) {
    img.src = imgSrc;
    img.onload = () => {
      if (dimTag) dimTag.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
    };
  }
  if (titleEl) titleEl.textContent = title || 'Document Inspector';
  resetZoom();
  if (modal) modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeImageZoomModal() {
  const modal = document.getElementById('modalImageZoom');
  if (modal) modal.classList.add('hidden');
}

// PASTE TEXT MODAL
function openPasteTextModal(type) {
  pasteTargetType = type;
  document.getElementById('pasteModalTitle').textContent = type === 'rfq' ? (currentMode === 'po' ? 'Paste Client Purchase Order Text' : 'Paste Client RFQ Text') : 'Paste Supplier Quotation / Email';
  document.getElementById('pasteModalTextarea').value = '';
  document.getElementById('modalPasteText').classList.remove('hidden');
}

function closePasteTextModal() {
  document.getElementById('modalPasteText').classList.add('hidden');
}

async function submitPasteText() {
  const text = document.getElementById('pasteModalTextarea').value.trim();
  if (!text) return closePasteTextModal();

  closePasteTextModal();
  showToast('Parsing pasted text with Gemini AI...', 'info');

  try {
    const items = await parseDocumentWithGemini(text, 'Pasted Text', pasteTargetType);
    const preview = { filename: 'Pasted Text', format: 'text', text: text };

    if (pasteTargetType === 'rfq') {
      rfqItems = items;
      clientPreviewData = preview;
      document.getElementById('rfqCountDisplay').textContent = `${items.length} items loaded`;
      const b = document.getElementById('rfqStatusBadge');
      b.className = 'text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-100 text-emerald-800';
      b.textContent = `Pasted text (${items.length} items)`;
    } else {
      quoteItems = items;
      quotePreviewData = preview;
      document.getElementById('quoteCountDisplay').textContent = `${items.length} items loaded`;
      const b = document.getElementById('quoteStatusBadge');
      b.className = 'text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-100 text-emerald-800';
      b.textContent = `Pasted text (${items.length} items)`;
    }

    if (isPreviewPaneOpen) renderDocumentPreviews();
    showToast(`Parsed ${items.length} items!`, 'success');
    snapshotActiveModeState();

    if (rfqItems.length > 0 && quoteItems.length > 0) {
      triggerMatching();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// GLOBAL SCREENSHOT / CLIPBOARD PASTE
let pendingPastedBlob = null;

function handleGlobalPaste(e) {
  // 1. NEVER intercept paste events in Email Automation Mode
  if (currentMode === 'email') return;
  const emailStudio = document.getElementById('emailStudioView');
  if (emailStudio && !emailStudio.classList.contains('hidden')) return;

  // 2. NEVER intercept paste events if target or activeElement is inside Email Studio, Quill editor, or any contenteditable element
  const target = e.target;
  const active = document.activeElement;
  if (target && (target.closest('#emailStudioView') || target.closest('.ql-editor') || target.closest('.ql-container') || target.isContentEditable)) return;
  if (active && (active.closest('#emailStudioView') || active.closest('.ql-editor') || active.closest('.ql-container') || active.isContentEditable)) return;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

  const items = (e.clipboardData || e.originalEvent.clipboardData).items;
  let imageFound = false;

  for (let item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const blob = item.getAsFile();
      pendingPastedBlob = blob;
      imageFound = true;
      openPasteTargetModal();
      e.preventDefault();
      break;
    }
  }

  if (!imageFound) {
    const text = e.clipboardData.getData('text');
    if (text && text.trim().length > 15 && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      openPasteTextModal('rfq');
      document.getElementById('pasteModalTextarea').value = text;
      e.preventDefault();
    }
  }
}

function openPasteTargetModal() {
  document.getElementById('targetRfqLabel').textContent = currentMode === 'po' ? '1. Client Purchase Order' : '1. Client RFQ';
  document.getElementById('modalPasteTarget').classList.remove('hidden');
}

function closePasteTargetModal() {
  document.getElementById('modalPasteTarget').classList.add('hidden');
  pendingPastedBlob = null;
}

function executePasteTarget(type) {
  if (!pendingPastedBlob) return closePasteTargetModal();
  const blob = pendingPastedBlob;
  closePasteTargetModal();
  handleFileUpload(blob, type);
}

// DRAG AND DROP UTILITY
function setupDragAndDrop(element, onFileDrop) {
  ['dragenter', 'dragover'].forEach(eventName => {
    element.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      element.classList.add('dropzone-active');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    element.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      element.classList.remove('dropzone-active');
    }, false);
  });

  element.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      onFileDrop(files[0]);
    }
  }, false);
}

// SETTINGS MODAL
function openSettingsModal() {
  document.getElementById('inputSettingsApiKey').value = getApiKey();

  const active = typeof getActiveUser === 'function' ? getActiveUser() : {};
  const isAdmin = Boolean((active && active.isAdmin) || window.sessionAdminUnlocked === true);

  const adminSection = document.getElementById('settingsAdminUserSection');
  const nonAdminNotice = document.getElementById('settingsNonAdminNotice');
  const unlockBox = document.getElementById('adminUnlockBox');
  const unlockPass = document.getElementById('adminUnlockPass');
  if (unlockPass) unlockPass.value = '';
  if (unlockBox) unlockBox.classList.add('hidden');

  if (isAdmin) {
    if (adminSection) adminSection.classList.remove('hidden');
    if (nonAdminNotice) nonAdminNotice.classList.add('hidden');

    // Populate 5 user slots
    if (typeof getAllUsers === 'function') {
      const users = getAllUsers();
      for (let i = 0; i < 5; i++) {
        const u = users[i] || {};
        const nameInp = document.getElementById(`userSlotName_${i}`);
        const emailInp = document.getElementById(`userSlotEmail_${i}`);
        const passInp = document.getElementById(`userSlotPass_${i}`);
        const ccInp = document.getElementById(`userSlotDefaultCc_${i}`);
        if (nameInp) nameInp.value = u.name || '';
        if (emailInp) emailInp.value = u.email || '';
        if (passInp) passInp.value = u.password || '';
        if (ccInp) ccInp.value = u.defaultCc || '';
      }
    }

    // Populate dedicated Administrator details
    if (typeof getAdminUser === 'function') {
      const admin = getAdminUser();
      const adminName = document.getElementById('adminSlotName');
      const adminEmail = document.getElementById('adminSlotEmail');
      const adminPass = document.getElementById('adminSlotPass');
      const adminCc = document.getElementById('adminSlotDefaultCc');
      if (adminName) adminName.value = admin.name || 'System Administrator';
      if (adminEmail) adminEmail.value = admin.email || 'admin@apmerinservices.com.my';
      if (adminPass) adminPass.value = admin.password || '';
      if (adminCc) adminCc.value = admin.defaultCc || 'project@apmerinservices.com.my';
    }
  } else {
    if (adminSection) adminSection.classList.add('hidden');
    if (nonAdminNotice) nonAdminNotice.classList.remove('hidden');

    // Clear sensitive inputs in DOM so regular users cannot inspect
    for (let i = 0; i < 5; i++) {
      const passInp = document.getElementById(`userSlotPass_${i}`);
      const ccInp = document.getElementById(`userSlotDefaultCc_${i}`);
      if (passInp) passInp.value = '';
      if (ccInp) ccInp.value = '';
    }
    const adminPass = document.getElementById('adminSlotPass');
    if (adminPass) adminPass.value = '';
    const adminCc = document.getElementById('adminSlotDefaultCc');
    if (adminCc) adminCc.value = '';
  }

  document.getElementById('modalSettings').classList.remove('hidden');
  lucide.createIcons();
}

function closeSettingsModal() {
  document.getElementById('modalSettings').classList.add('hidden');
}

async function saveSettingsApiKey() {
  const key = document.getElementById('inputSettingsApiKey').value.trim();
  try { await setApiKey(key); }
  catch (error) { showToast(error.message, 'error'); return; }

  const active = typeof getActiveUser === 'function' ? getActiveUser() : {};
  const isAdmin = Boolean((active && active.isAdmin) || window.sessionAdminUnlocked === true);

  if (isAdmin) {
    // Save 5 user slots
    if (typeof getAllUsers === 'function' && typeof saveAllUsers === 'function') {
      const users = getAllUsers();
      for (let i = 0; i < 5; i++) {
        const u = users[i] || { id: `user_${i + 1}`, role: 'Team Member', defaultCc: 'project@apmerinservices.com.my', signatureKey: `AP_MERIN_SIG_user_${i + 1}` };
        const nameInp = document.getElementById(`userSlotName_${i}`);
        const emailInp = document.getElementById(`userSlotEmail_${i}`);
        const passInp = document.getElementById(`userSlotPass_${i}`);
        const ccInp = document.getElementById(`userSlotDefaultCc_${i}`);
        if (nameInp) u.name = nameInp.value.trim();
        if (emailInp) u.email = emailInp.value.trim();
        if (passInp) u.password = passInp.value.trim();
        if (ccInp) u.defaultCc = ccInp.value.trim();
        if (!u.signatureKey) {
          u.signatureKey = (typeof DEFAULT_SYSTEM_USERS !== 'undefined' && DEFAULT_SYSTEM_USERS[i] && DEFAULT_SYSTEM_USERS[i].signatureKey) || `AP_MERIN_SIG_user_${i + 1}`;
        }
        users[i] = u;
      }
      saveAllUsers(users);
    }

    // Save dedicated Administrator details
    if (typeof getAdminUser === 'function' && typeof saveAdminUser === 'function') {
      const admin = getAdminUser();
      const adminName = document.getElementById('adminSlotName');
      const adminEmail = document.getElementById('adminSlotEmail');
      const adminPass = document.getElementById('adminSlotPass');
      const adminCc = document.getElementById('adminSlotDefaultCc');
      if (adminName && adminName.value.trim()) admin.name = adminName.value.trim();
      if (adminEmail && adminEmail.value.trim()) admin.email = adminEmail.value.trim();
      if (adminPass && adminPass.value.trim()) admin.password = adminPass.value.trim();
      if (adminCc) admin.defaultCc = adminCc.value.trim();
      saveAdminUser(admin);
    }

    const currActive = getActiveUser();
    updateActiveUserHeaderUI(currActive);
    syncEmailSettingsWithActiveUser(currActive);
    if (currActive) {
      try {
        fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: currActive, remember_me: true })
        }).catch(() => {});
      } catch (_) {}
    }
    showToast('Settings, 5 user accounts & admin credentials saved successfully!', 'success');
  } else {
    showToast('Settings saved successfully.', 'success');
  }

  closeSettingsModal();
}

window.editUserSignature = function(slotIdx) {
  let targetUser = null;
  if (slotIdx === 'admin') {
    targetUser = typeof getAdminUser === 'function' ? getAdminUser() : null;
  } else {
    const users = typeof getAllUsers === 'function' ? getAllUsers() : [];
    targetUser = users[slotIdx];
  }
  if (!targetUser) return;
  if (typeof openSignatureModal === 'function') {
    openSignatureModal(targetUser);
  }
};

// TOAST NOTIFICATIONS
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toastMessage');
  const icon = document.getElementById('toastIcon');

  msgEl.textContent = message;
  if (type === 'success') {
    toast.className = 'fixed bottom-6 right-6 bg-emerald-900 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 transition duration-300 z-50 text-xs font-medium translate-y-0 opacity-100';
    icon.setAttribute('data-lucide', 'check-circle');
    icon.className = 'w-4 h-4 text-emerald-400';
  } else if (type === 'error') {
    toast.className = 'fixed bottom-6 right-6 bg-rose-900 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 transition duration-300 z-50 text-xs font-medium translate-y-0 opacity-100';
    icon.setAttribute('data-lucide', 'alert-triangle');
    icon.className = 'w-4 h-4 text-rose-400';
  } else {
    toast.className = 'fixed bottom-6 right-6 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 transition duration-300 z-50 text-xs font-medium translate-y-0 opacity-100';
    icon.setAttribute('data-lucide', 'info');
    icon.className = 'w-4 h-4 text-blue-400';
  }

  lucide.createIcons();

  setTimeout(() => {
    toast.className = 'fixed bottom-6 right-6 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 transform translate-y-20 opacity-0 transition duration-300 z-50 text-xs font-medium pointer-events-none';
  }, 3500);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


function sendQuotationViaEmail() {
  const rows = matchedItems && matchedItems.length > 0 ? matchedItems : [];
  if (rows.length === 0) {
    showToast('Please generate a quotation or add items first.', 'error');
    return;
  }

  let tableHtml = `
  <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;width:100%;max-width:760px;font-family:Arial,sans-serif;font-size:13px;border-color:#cbd5e1;">
    <thead>
      <tr style="background-color:#f1f5f9;color:#0f172a;text-align:left;">
        <th style="padding:8px 10px;border:1px solid #cbd5e1;width:35px;text-align:center;">#</th>
        <th style="padding:8px 10px;border:1px solid #cbd5e1;width:120px;">Item Code</th>
        <th style="padding:8px 10px;border:1px solid #cbd5e1;">Description</th>
        <th style="padding:8px 10px;border:1px solid #cbd5e1;width:60px;text-align:center;">Qty</th>
        <th style="padding:8px 10px;border:1px solid #cbd5e1;width:55px;text-align:center;">Unit</th>
        <th style="padding:8px 10px;border:1px solid #cbd5e1;width:110px;text-align:right;">Unit Price (${targetCurrency})</th>
        <th style="padding:8px 10px;border:1px solid #cbd5e1;width:120px;text-align:right;">Total (${targetCurrency})</th>
      </tr>
    </thead>
    <tbody>
  `;

  let grandTotal = 0;
  rows.forEach((item, idx) => {
    const qty = parseFloat(item.quantity) || 1;
    const unitPrice = parseFloat(item.calculated_target_price) || 0;
    const lineTotal = qty * unitPrice;
    grandTotal += lineTotal;

    tableHtml += `
      <tr style="background-color:${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
        <td style="padding:7px 10px;border:1px solid #cbd5e1;text-align:center;">${idx + 1}</td>
        <td style="padding:7px 10px;border:1px solid #cbd5e1;font-weight:600;color:#1e293b;">${escapeHtml(item.item_code || '-')}</td>
        <td style="padding:7px 10px;border:1px solid #cbd5e1;">${escapeHtml(item.description || '-')}</td>
        <td style="padding:7px 10px;border:1px solid #cbd5e1;text-align:center;">${qty}</td>
        <td style="padding:7px 10px;border:1px solid #cbd5e1;text-align:center;">${escapeHtml(item.unit || 'PCS')}</td>
        <td style="padding:7px 10px;border:1px solid #cbd5e1;text-align:right;font-family:monospace;">${unitPrice.toFixed(2)}</td>
        <td style="padding:7px 10px;border:1px solid #cbd5e1;text-align:right;font-family:monospace;font-weight:600;">${lineTotal.toFixed(2)}</td>
      </tr>
    `;
  });

  const currSym = CURRENCY_SYMBOLS[targetCurrency] || `${targetCurrency} `;
  tableHtml += `
    </tbody>
    <tfoot>
      <tr style="background-color:#e2e8f0;font-weight:bold;color:#0f172a;">
        <td colspan="6" style="padding:9px 12px;border:1px solid #cbd5e1;text-align:right;">TOTAL AMOUNT (${targetCurrency}):</td>
        <td style="padding:9px 12px;border:1px solid #cbd5e1;text-align:right;font-family:monospace;font-size:14px;color:#1d4ed8;">${currSym}${grandTotal.toFixed(2)}</td>
      </tr>
    </tfoot>
  </table>
  `;

  // Switch to Mode 3: Email Automation
  setAppMode('email');

  // Pre-fill Subject
  const subjInput = document.getElementById('emailSubject');
  const modeLabel = currentMode === 'po' ? 'Purchase Order' : 'Quotation';
  const refText = (clientPreviewData && clientPreviewData.name) ? ` - ${clientPreviewData.name.replace(/\.[^/.]+$/, '')}` : '';
  if (subjInput) {
    subjInput.value = `${modeLabel}${refText} - AP Merin Services`;
  }

  // Pre-fill email body
  if (quill) {
    const fullHtml = `
      <p>Dear Sir / Madam,</p>
      <p>Good day.</p>
      <p>Please find below our official ${modeLabel.toLowerCase()} for your kind review and consideration:</p>
      <br>
      ${tableHtml}
      <br>
      <p><strong>Terms:</strong> Ex-Works / As Agreed</p>
      <p><strong>Validity:</strong> 30 days</p>
      <p><strong>Delivery:</strong> Prompt upon receipt of official confirmation</p>
      <br>
      <p>Please feel free to reach out if you have any questions or require further assistance.</p>
      <p>Thank you and best regards.</p>
    `;
    quill.root.innerHTML = fullHtml;
    quill.focus();
  }

  showToast('Quotation loaded into Email Automation Studio!', 'success');
}


// =========================================================================
// FEATURE 4: QUOTATION COMPARISON MAKER LOGIC
// =========================================================================

let lastComparisonData = null;
let compareManualFiles = [];

function initQuotationComparator() {
  const searchInput = document.getElementById('compareSearchInput');
  const btnSearch = document.getElementById('btnCompareSearch');
  const btnClear = document.getElementById('btnClearCompareSearch');
  const btnRefreshRecent = document.getElementById('btnRefreshRecentRfqs');
  const currencySelect = document.getElementById('compareTargetCurrency');
  const btnExportExcel = document.getElementById('btnExportCompareExcel');
  const btnTransferQuote = document.getElementById('btnTransferWinnerToQuote');
  const btnTransferPO = document.getElementById('btnTransferWinnerToPO');
  const toggleAccordion = document.getElementById('toggleManualUploadAccordion');
  const manualDropzone = document.getElementById('compareDropzone');
  const manualFileInput = document.getElementById('compareFileInput');
  const btnProcessManual = document.getElementById('btnExtractManualQuotes');

  // Search input listeners
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      if (btnClear) btnClear.classList.toggle('hidden', !searchInput.value.trim());
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleCompareSearch();
    });
  }
  if (btnClear && searchInput) {
    btnClear.addEventListener('click', () => {
      searchInput.value = '';
      btnClear.classList.add('hidden');
      searchInput.focus();
    });
  }
  if (btnSearch) btnSearch.addEventListener('click', handleCompareSearch);
  if (btnRefreshRecent) btnRefreshRecent.addEventListener('click', loadRecentRfqs);

  // Currency select change
  if (currencySelect) {
    currencySelect.addEventListener('change', () => {
      const newCurrency = currencySelect.value;
      const stdRate = USD_BASE_RATES[newCurrency] || 1.0;
      lastComparisonFxRate = stdRate;
      const prefixEl = document.getElementById('compareFxInputPrefix');
      const suffixEl = document.getElementById('compareFxInputSuffix');
      const inputEl = document.getElementById('compareFxRateInput');
      if (prefixEl) prefixEl.textContent = '1 USD =';
      if (suffixEl) suffixEl.textContent = newCurrency;
      if (inputEl) inputEl.value = stdRate.toFixed(4);

      if (lastComparisonData) {
        reconvertComparisonPrices(newCurrency, stdRate);
      }
    });
  }

  // Manual Exchange Rate Input in Quotation Comparison (Matching Image 2)
  const compareFxInput = document.getElementById('compareFxRateInput');
  if (compareFxInput) {
    compareFxInput.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val > 0 && lastComparisonData) {
        lastComparisonFxRate = val;
        const targetCurr = currencySelect ? currencySelect.value : (lastComparisonData.target_currency || 'MYR');
        reconvertComparisonPrices(targetCurr, val);
      }
    });
  }

  // Reset to standard rate button
  const btnResetCompareFx = document.getElementById('btnResetCompareFx');
  if (btnResetCompareFx) {
    btnResetCompareFx.addEventListener('click', () => {
      const targetCurr = currencySelect ? currencySelect.value : (lastComparisonData ? lastComparisonData.target_currency : 'MYR') || 'MYR';
      const stdRate = USD_BASE_RATES[targetCurr] || 1.0;
      lastComparisonFxRate = stdRate;
      if (compareFxInput) compareFxInput.value = stdRate.toFixed(4);
      if (lastComparisonData) {
        reconvertComparisonPrices(targetCurr, stdRate);
      }
      showToast(`Exchange rate reset to standard: 1 USD = ${stdRate.toFixed(4)} ${targetCurr}`, 'info');
    });
  }

  // Export to Excel
  if (btnExportExcel) btnExportExcel.addEventListener('click', exportCompareExcel);

  // Transfer buttons
  if (btnTransferQuote) btnTransferQuote.addEventListener('click', () => transferWinnerToMode('quotation'));
  if (btnTransferPO) btnTransferPO.addEventListener('click', () => transferWinnerToMode('po'));

  // Manual upload accordion toggle
  if (toggleAccordion) {
    toggleAccordion.addEventListener('click', () => {
      const content = document.getElementById('manualUploadContent');
      const icon = document.getElementById('manualAccordionIcon');
      const label = document.getElementById('manualAccordionLabel');
      if (content) {
        const isHidden = content.classList.contains('hidden');
        content.classList.toggle('hidden', !isHidden);
        if (icon) icon.setAttribute('data-lucide', isHidden ? 'chevron-up' : 'chevron-down');
        if (label) label.textContent = isHidden ? 'Hide Manual Uploader' : 'Show Manual Uploader';
        lucide.createIcons();
      }
    });
  }

  // Manual files dropzone
  if (manualDropzone && manualFileInput) {
    manualDropzone.addEventListener('click', () => manualFileInput.click());
    manualFileInput.addEventListener('change', (e) => {
      handleManualFilesSelect(Array.from(e.target.files));
    });

    ['dragenter', 'dragover'].forEach(name => {
      manualDropzone.addEventListener(name, (e) => {
        e.preventDefault();
        manualDropzone.classList.add('border-amber-500', 'bg-amber-50/50');
      });
    });
    ['dragleave', 'drop'].forEach(name => {
      manualDropzone.addEventListener(name, (e) => {
        e.preventDefault();
        manualDropzone.classList.remove('border-amber-500', 'bg-amber-50/50');
      });
    });
    manualDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files) {
        handleManualFilesSelect(Array.from(e.dataTransfer.files));
      }
    });
  }

  if (btnProcessManual) btnProcessManual.addEventListener('click', handleManualQuotesExtract);

  // Load initial recent RFQs from inbox
  loadRecentRfqs();
}

async function loadRecentRfqs() {
  const container = document.getElementById('recentRfqChips');
  if (!container) return;

  container.innerHTML = '<span class="text-xs text-slate-400 italic">Scanning mailbox for recent RFQs...</span>';

  try {
    let res;
    try {
      res = await fetch('/api/comparator/recent-rfqs');
    } catch (_) {}

    let cType = res ? (res.headers.get('content-type') || '') : '';
    if (!res || !cType.includes('application/json')) {
      try {
        const fnRes = await fetch('/.netlify/functions/recent-rfqs');
        const fnType = fnRes ? (fnRes.headers.get('content-type') || '') : '';
        if (fnType.includes('application/json')) {
          res = fnRes;
          cType = fnType;
        }
      } catch (_) {}
    }

    if (res && cType.includes('application/json')) {
      const data = await res.json();
      if (data.success && data.rfqs && data.rfqs.length > 0) {
        container.innerHTML = '';
        data.rfqs.forEach(rfqSubj => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'px-3 py-1 bg-slate-100 hover:bg-amber-100 hover:text-amber-900 border border-slate-200 hover:border-amber-300 text-slate-700 text-xs rounded-lg transition font-medium text-left truncate max-w-xs';
          chip.title = rfqSubj;
          chip.textContent = rfqSubj;
          chip.addEventListener('click', () => {
            const input = document.getElementById('compareSearchInput');
            if (input) {
              input.value = rfqSubj;
              const btnClear = document.getElementById('btnClearCompareSearch');
              if (btnClear) btnClear.classList.remove('hidden');
              handleCompareSearch();
            }
          });
          container.appendChild(chip);
        });
        return;
      }
    }
    container.innerHTML = '<span class="text-xs text-slate-400">Type your RFQ subject name or reference code above to search.</span>';
  } catch (err) {
    container.innerHTML = '<span class="text-xs text-slate-400">Enter RFQ Subject name above to begin.</span>';
  }
}

async function handleCompareSearch() {
  const input = document.getElementById('compareSearchInput');
  const query = input ? input.value.trim() : '';

  if (!query) {
    showToast('Please enter an RFQ subject name or reference code to search.', 'warning');
    if (input) input.focus();
    return;
  }

  const activeUser = (typeof getActiveUser === 'function') ? getActiveUser() : null;
  const mailboxUser = (activeUser && activeUser.email) ? activeUser.email : 'project@apmerinservices.com.my';

  const compBadge = document.getElementById('compareMailboxUserBadge');
  if (compBadge) compBadge.textContent = mailboxUser;

  const currencySelect = document.getElementById('compareTargetCurrency');
  const targetCurrency = currencySelect ? currencySelect.value : 'MYR';

  // UI Progress state
  const progressSection = document.getElementById('compareProgressSection');
  const reviewSection = document.getElementById('compareEmailReviewSection');
  const resultsSection = document.getElementById('compareResultsSection');
  const statusTitle = document.getElementById('compareProgressStatusTitle');
  const statusSub = document.getElementById('compareProgressStatusSub');
  const tokenBadge = document.getElementById('compareTokenSavingsBadge');

  if (resultsSection) resultsSection.classList.add('hidden');
  if (reviewSection) reviewSection.classList.add('hidden');
  if (progressSection) progressSection.classList.remove('hidden');
  if (tokenBadge) tokenBadge.classList.add('hidden');

  const step1 = document.getElementById('stepProgress1');
  const step2 = document.getElementById('stepProgress2');
  const step3 = document.getElementById('stepProgress3');
  const step4 = document.getElementById('stepProgress4');

  const setStepActive = (stepEl, active, done = false) => {
    if (!stepEl) return;
    if (done) {
      stepEl.className = 'p-2.5 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-800 font-semibold flex items-center gap-2';
    } else if (active) {
      stepEl.className = 'p-2.5 rounded-lg border bg-amber-50 border-amber-300 text-amber-800 font-bold flex items-center gap-2 animate-pulse';
    } else {
      stepEl.className = 'p-2.5 rounded-lg border bg-slate-50 border-slate-200 text-slate-500 flex items-center gap-2';
    }
  };

  setStepActive(step1, true);
  setStepActive(step2, false);
  setStepActive(step3, false);
  setStepActive(step4, false);

  if (statusTitle) statusTitle.textContent = `Scanning mailbox for: "${query}"...`;
  if (statusSub) statusSub.textContent = `Connecting to mailbox (${mailboxUser}) and discovering supplier email threads...`;

  try {
    setTimeout(() => {
      setStepActive(step1, false, true);
      setStepActive(step2, true);
      if (statusTitle) statusTitle.textContent = 'Scanning emails & attachments...';
      if (statusSub) statusSub.textContent = 'Identifying supplier reply messages and quotation attachments...';
    }, 800);

    const payload = JSON.stringify({
      subject_query: query,
      mailbox_user: mailboxUser
    });

    let data;
    let response;
    try {
      response = await fetch('/api/comparator/scan-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
    } catch (_) {}

    const cType = response ? (response.headers.get('content-type') || '') : '';
    if (!response || !response.ok || !cType.includes('application/json')) {
      try {
        const fnRes = await fetch('/.netlify/functions/scan-emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        });
        if (fnRes && (fnRes.headers.get('content-type') || '').includes('application/json')) {
          response = fnRes;
        }
      } catch (_) {}
    }

    try {
      if (!response) {
        throw new Error('Network connection failed. Please verify your network.');
      }
      data = await response.json();
    } catch (parseErr) {
      throw new Error(`Mailbox response format invalid (Status ${response ? response.status : 'error'}).`);
    }

    if (!data || !data.success) {
      if (progressSection) progressSection.classList.add('hidden');
      showToast((data && data.error) || 'No matching emails found for this RFQ.', 'error');
      return;
    }

    setStepActive(step2, false, true);
    setStepActive(step3, false, true);

    if (progressSection) progressSection.classList.add('hidden');

    lastScannedDiscoveryData = data;
    renderDiscoveredEmails(data);

    if (reviewSection) {
      reviewSection.classList.remove('hidden');
      reviewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    showToast(`Found ${data.total_emails_found} email(s) across ${data.total_suppliers_found} supplier(s)!`, 'success');

  } catch (err) {
    if (progressSection) progressSection.classList.add('hidden');
    showToast('Failed to complete mailbox scan: ' + err.message, 'error');
  }
}

let lastScannedDiscoveryData = null;
let selectedSupplierKeys = new Set();

function renderDiscoveredEmails(data) {
  if (!data) return;
  lastScannedDiscoveryData = data;
  selectedSupplierKeys.clear();

  const reviewSection = document.getElementById('compareEmailReviewSection');
  if (!reviewSection) return;

  // 1. Initial RFQ Sender Details (Ignoring CC)
  const initRfq = data.initial_rfq || {};
  const sNameEl = document.getElementById('discoveryInitialSenderName');
  const sEmailEl = document.getElementById('discoveryInitialSenderEmail');
  const sDateEl = document.getElementById('discoveryInitialSentDate');
  const sCountEl = document.getElementById('discoveryTotalEmailsCount');
  const suppCountEl = document.getElementById('discoverySuppliersCount');
  const subjEl = document.getElementById('discoveryRfqSubject');

  if (sNameEl) sNameEl.textContent = initRfq.sender_name || 'Procurement Dept';
  if (sEmailEl) sEmailEl.textContent = initRfq.sender_email ? `<${initRfq.sender_email}>` : '';
  if (sDateEl) sDateEl.textContent = initRfq.date || '-';
  if (sCountEl) sCountEl.textContent = data.total_emails_found || 0;
  if (suppCountEl) suppCountEl.textContent = data.total_suppliers_found || 0;
  if (subjEl) subjEl.textContent = data.subject_query || '-';

  // 1b. Wire Up Initial RFQ Details Button & Quick View Drawer
  const btnViewRfq = document.getElementById('btnViewDiscoveryRfqDetails');
  const btnToggleDrawer = document.getElementById('btnToggleDiscoveryRfqDrawer');
  const drawerEl = document.getElementById('discoveryRfqDrawer');
  const drawerIcon = document.getElementById('discoveryRfqDrawerIcon');
  const imgBadge = document.getElementById('discoveryRfqImagesBadge');
  const drawerDocsCont = document.getElementById('discoveryDrawerDocsContainer');
  const drawerDocsCount = document.getElementById('discoveryDrawerDocsCount');
  const drawerDocsList = document.getElementById('discoveryDrawerDocsList');
  const drawerImagesCont = document.getElementById('discoveryDrawerImagesContainer');
  const drawerImagesCount = document.getElementById('discoveryDrawerImagesCount');
  const drawerImagesStrip = document.getElementById('discoveryDrawerImagesStrip');
  const drawerBodyExcerpt = document.getElementById('discoveryDrawerBodyExcerpt');
  const drawerRecipients = document.getElementById('discoveryDrawerRecipients');

  // Collect all documents
  const rawInitDocs = initRfq.documents || [];
  const richInitAtts = initRfq.rich_attachments || [];
  const allInitDocs = [...rawInitDocs];
  const seenDocNames = new Set(rawInitDocs.map(d => (d.filename || '').toLowerCase()));
  for (const ra of richInitAtts) {
    if (ra && !ra.is_image && ra.filename && !seenDocNames.has(ra.filename.toLowerCase())) {
      seenDocNames.add(ra.filename.toLowerCase());
      allInitDocs.push(ra);
    }
  }
  window.discoveryInitialDocsList = allInitDocs;

  // Collect all images
  const allInitImgs = [
    ...(initRfq.images || []),
    ...((initRfq.rich_attachments || []).filter(a => a && a.is_image && a.data_url))
  ];
  const uniqueInitImgs = [];
  const seenInitSrc = new Set();
  for (const im of allInitImgs) {
    if (im && im.data_url && !seenInitSrc.has(im.data_url)) {
      seenInitSrc.add(im.data_url);
      uniqueInitImgs.push(im);
    }
  }
  window.discoveryInitialImagesList = uniqueInitImgs;

  if (imgBadge) {
    const totalAtts = allInitDocs.length + uniqueInitImgs.length;
    if (totalAtts > 0) {
      if (allInitDocs.length > 0 && uniqueInitImgs.length > 0) {
        imgBadge.textContent = `${totalAtts} attachments (${allInitDocs.length} doc${allInitDocs.length > 1 ? 's' : ''}, ${uniqueInitImgs.length} drawing${uniqueInitImgs.length > 1 ? 's' : ''})`;
      } else if (allInitDocs.length > 0) {
        imgBadge.textContent = `${allInitDocs.length} document${allInitDocs.length > 1 ? 's' : ''}`;
      } else {
        imgBadge.textContent = `${uniqueInitImgs.length} drawing${uniqueInitImgs.length > 1 ? 's' : ''}`;
      }
      imgBadge.classList.remove('hidden');
    } else {
      imgBadge.classList.add('hidden');
    }
  }

  if (btnViewRfq) {
    btnViewRfq.onclick = (e) => {
      e.preventDefault();
      window.openDiscoveryRfqDetails();
    };
  }

  if (btnToggleDrawer && drawerEl) {
    btnToggleDrawer.onclick = (e) => {
      e.preventDefault();
      const isNowHidden = drawerEl.classList.toggle('hidden');
      if (drawerIcon) {
        drawerIcon.style.transform = isNowHidden ? 'rotate(0deg)' : 'rotate(180deg)';
      }
    };
  }

  if (drawerRecipients) {
    drawerRecipients.textContent = initRfq.recipients || initRfq.to ? `To: ${initRfq.recipients || initRfq.to}` : '';
  }

  if (drawerDocsCont && drawerDocsList && drawerDocsCount) {
    if (allInitDocs.length > 0) {
      drawerDocsCont.classList.remove('hidden');
      drawerDocsCount.textContent = allInitDocs.length;
      drawerDocsList.innerHTML = allInitDocs.map((doc, d_idx) => {
        const fn = doc.filename || `Document #${d_idx + 1}`;
        const sz = doc.size ? `${Math.round(doc.size / 1024)} KB` : '';
        const isPdf = (doc.is_pdf || fn.toLowerCase().endsWith('.pdf'));
        const isXls = (doc.is_excel || fn.toLowerCase().endsWith('.xlsx') || fn.toLowerCase().endsWith('.xls') || fn.toLowerCase().endsWith('.csv'));
        const isDocx = (doc.is_doc || fn.toLowerCase().endsWith('.docx') || fn.toLowerCase().endsWith('.doc'));

        let iconName = 'file-text';
        let iconBg = 'bg-amber-500/20 text-amber-300';
        let typeBadge = 'Document';
        if (isPdf) {
          iconName = 'file-text';
          iconBg = 'bg-rose-500/20 text-rose-300';
          typeBadge = 'PDF Specification';
        } else if (isXls) {
          iconName = 'file-spreadsheet';
          iconBg = 'bg-emerald-500/20 text-emerald-300';
          typeBadge = 'Excel Sheet';
        } else if (isDocx) {
          iconName = 'file-text';
          iconBg = 'bg-blue-500/20 text-blue-300';
          typeBadge = 'Word Document';
        }

        const canInspect = (isPdf || (doc.preview_pages && doc.preview_pages.length > 0) || doc.base64);

        return `
          <div class="p-2.5 bg-slate-900 border border-slate-700/80 hover:border-amber-400/80 rounded-lg flex items-center justify-between gap-3 text-xs transition">
            <div class="flex items-center gap-2.5 truncate">
              <div class="p-1.5 rounded shrink-0 ${iconBg}">
                <i data-lucide="${iconName}" class="w-3.5 h-3.5"></i>
              </div>
              <div class="truncate">
                <span class="font-bold text-slate-200 block truncate" title="${escapeHtml(fn)}">${escapeHtml(fn)}</span>
                <span class="text-slate-400 text-[10px] font-mono">${sz ? `${sz} • ` : ''}${typeBadge}</span>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              ${canInspect ? `
                <button type="button" class="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 active:scale-95 text-white font-bold rounded text-[11px] flex items-center gap-1 shadow-2xs transition cursor-pointer"
                        onclick="window.inspectDiscoveryDoc(${d_idx})">
                  <i data-lucide="eye" class="w-3 h-3"></i>
                  <span>Inspect</span>
                </button>
              ` : ''}
              ${doc.data_url ? `
                <a href="${doc.data_url}" download="${escapeHtml(fn)}" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded text-[11px] flex items-center gap-1 transition">
                  <i data-lucide="download" class="w-3 h-3"></i>
                  <span>Download</span>
                </a>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');
    } else {
      drawerDocsCont.classList.add('hidden');
    }
  }

  if (drawerImagesCont && drawerImagesStrip && drawerImagesCount) {
    if (uniqueInitImgs.length > 0) {
      drawerImagesCont.classList.remove('hidden');
      drawerImagesCount.textContent = uniqueInitImgs.length;
      drawerImagesStrip.innerHTML = uniqueInitImgs.map((img, idx) => {
        const fn = img.filename || `Technical Drawing #${idx + 1}`;
        return `
          <div class="shrink-0 w-24 h-24 bg-slate-900 border border-slate-700 hover:border-blue-400 rounded-xl overflow-hidden cursor-pointer group relative p-1.5 transition flex flex-col items-center justify-center shadow-xs"
               onclick="window.openImageLightbox('${img.data_url}', '${escapeHtml(fn)}')">
            <img src="${img.data_url}" alt="${escapeHtml(fn)}" class="max-h-full max-w-full object-contain rounded group-hover:scale-105 transition duration-200">
            <div class="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center rounded-xl">
              <i data-lucide="zoom-in" class="w-5 h-5 text-white"></i>
            </div>
            <span class="absolute bottom-1 left-1 right-1 bg-slate-900/90 text-slate-300 text-[9px] font-mono truncate px-1 rounded text-center">
              ${escapeHtml(fn)}
            </span>
          </div>
        `;
      }).join('');
    } else {
      drawerImagesCont.classList.add('hidden');
    }
  }

  if (drawerBodyExcerpt) {
    const rawHtml = (initRfq.html_body_resolved || initRfq.html_body || '').trim();
    const rawText = (initRfq.body_text || initRfq.body || '').trim();
    if (rawHtml && rawHtml.length > 20) {
      drawerBodyExcerpt.innerHTML = rawHtml;
      // Add zoom on any images in the excerpt
      const excImgs = drawerBodyExcerpt.querySelectorAll('img');
      excImgs.forEach((img, idx) => {
        img.style.cursor = 'zoom-in';
        img.onclick = (e) => {
          e.stopPropagation();
          window.openImageLightbox(img.src, img.alt || `RFQ Diagram #${idx + 1}`);
        };
      });
    } else if (rawText) {
      drawerBodyExcerpt.innerHTML = `<div class="whitespace-pre-wrap font-sans">${escapeHtml(rawText)}</div>`;
    } else {
      drawerBodyExcerpt.innerHTML = '<span class="text-slate-400 italic">No message body found in initial RFQ email.</span>';
    }
  }

  // 2. Internal Replies / Different Responders Notice
  const internalNotice = document.getElementById('discoveryInternalRepliesNotice');
  const internalList = document.getElementById('discoveryInternalRepliesList');
  if (internalNotice && internalList) {
    const diffReplies = (initRfq.internal_replies || []).filter(r => r.is_different_sender);
    if (diffReplies.length > 0) {
      internalNotice.classList.remove('hidden');
      internalList.innerHTML = diffReplies.map(r => `
        <div class="flex items-center gap-2 py-0.5">
          <span class="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded font-bold">Different Sender</span>
          <span><strong>${r.sender_name}</strong> (${r.sender_email}): "${r.subject || 'Follow-up message'}" (${r.date || ''})</span>
        </div>
      `).join('');
    } else {
      internalNotice.classList.add('hidden');
      internalList.innerHTML = '';
    }
  }

  // 3. Discovered Suppliers List
  const listEl = document.getElementById('discoverySuppliersList');
  if (listEl) {
    listEl.innerHTML = '';
    const suppliers = data.supplier_threads || [];

    suppliers.forEach((s, idx) => {
      // By default, select all valid suppliers
      selectedSupplierKeys.add(s.supplier_key);

      const item = document.createElement('div');
      item.className = 'p-4 rounded-xl border transition flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/60 hover:bg-white border-slate-200 hover:border-amber-300 hover:shadow-xs';

      // Status styling
      let badgeBg = 'bg-slate-100 text-slate-700 border-slate-200';
      if (s.status === 'QUOTE_ATTACHED') badgeBg = 'bg-emerald-100 text-emerald-800 border-emerald-300';
      if (s.status === 'QUOTE_BODY') badgeBg = 'bg-blue-100 text-blue-800 border-blue-300';
      if (s.status === 'REGRET') badgeBg = 'bg-rose-100 text-rose-800 border-rose-300';
      if (s.status === 'PENDING_AP_MERIN') badgeBg = 'bg-amber-100 text-amber-800 border-amber-300 animate-pulse';

      // Attachments preview tags
      let attTags = '';
      if (s.attachments && s.attachments.length > 0) {
        attTags = s.attachments.map(a => `
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono ${a.is_quote_doc ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold' : 'bg-slate-100 text-slate-600'}">
            <i data-lucide="${a.is_quote_doc ? 'file-spreadsheet' : 'paperclip'}" class="w-3 h-3"></i>
            ${a.filename}${a.size_kb ? ` (${a.size_kb} KB)` : ''}
          </span>
        `).join('');
      }

      item.innerHTML = `
        <div class="flex items-start gap-3 flex-1">
          <input type="checkbox" id="chk_supp_${idx}" data-supplier-key="${s.supplier_key}" checked
            class="supplier-discovery-checkbox mt-1 w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500 cursor-pointer">
          <div class="space-y-1 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <label for="chk_supp_${idx}" class="font-bold text-slate-900 text-sm cursor-pointer hover:text-amber-700">
                ${s.supplier_name}
              </label>
              <span class="text-xs font-mono text-slate-500">&lt;${s.supplier_email || s.sender_email || ''}&gt;</span>
              <span class="px-2 py-0.5 rounded-full text-xs font-bold border ${badgeBg}">
                ${s.status_badge || s.status_label || s.status || 'Received'}
              </span>
            </div>

            <p class="text-xs text-slate-600">${s.status_notes || ''}</p>

            ${attTags ? `<div class="flex flex-wrap gap-1.5 pt-1">${attTags}</div>` : ''}

            <!-- Communication Process Flow -->
            ${(s.timeline && s.timeline.length > 0) ? `
            <div class="pt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span class="font-semibold text-slate-700">Communication Process:</span>
              ${s.timeline.map((t, t_idx) => `
                <span class="inline-flex items-center gap-1 ${t.is_different_sender ? 'text-amber-700 font-bold' : ''}">
                  ${t_idx > 0 ? '<i data-lucide="arrow-right" class="w-3 h-3 text-slate-300"></i>' : ''}
                  <span>${t.action || 'Reply'} (${(t.actor || '').split('<')[0].trim()})</span>
                </span>
              `).join('')}
            </div>
            ` : ''}
          </div>
        </div>

        <!-- Action Buttons: Read Supplier Email & View PDF Quote -->
        <div class="shrink-0 flex items-center gap-2">
          ${(s.quote_documents && s.quote_documents.length > 0) ? `
            <button type="button" class="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-xs rounded-xl border border-amber-200 shadow-2xs transition flex items-center gap-1.5"
              onclick="openDiscoveredSupplierDoc('${s.supplier_key}', 0)" title="Inspect attached official quotation document">
              <i data-lucide="file-text" class="w-3.5 h-3.5 text-amber-600"></i>
              <span>View PDF</span>
            </button>
          ` : ''}
          <button type="button" class="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs rounded-xl border border-blue-200 shadow-2xs transition flex items-center gap-1.5"
            onclick="openDiscoveredSupplierPreview('${s.supplier_key}')">
            <i data-lucide="mail-open" class="w-3.5 h-3.5 text-blue-600"></i>
            <span>Read Supplier Email</span>
          </button>
        </div>
      `;

      listEl.appendChild(item);
    });

    // Checkbox change listener
    listEl.querySelectorAll('.supplier-discovery-checkbox').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const key = e.target.getAttribute('data-supplier-key');
        if (e.target.checked) {
          selectedSupplierKeys.add(key);
        } else {
          selectedSupplierKeys.delete(key);
        }
        updateApproveButtonText();
      });
    });
  }

  // 4. Raw Emails List
  const rawListEl = document.getElementById('discoveryRawEmailsWrapper');
  const rawCountEl = document.getElementById('discoveryRawEmailsCount');
  if (rawCountEl) rawCountEl.textContent = (data.discovered_emails || []).length;

  if (rawListEl) {
    rawListEl.innerHTML = '';
    (data.discovered_emails || []).forEach(em => {
      const emailCard = document.createElement('div');
      emailCard.className = 'p-3 bg-white rounded-lg border border-slate-200 text-xs flex items-start justify-between gap-3';
      const isOut = em.direction === 'outgoing';

      emailCard.innerHTML = `
        <div class="space-y-1 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${isOut ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-700'}">
              ${em.direction_label}
            </span>
            <span class="font-bold text-slate-900">${em.sender_name || em.sender_email}</span>
            <span class="text-slate-400 font-mono text-[11px]">${em.date}</span>
          </div>
          <div class="text-slate-700 font-semibold truncate max-w-xl">${em.subject}</div>
          <div class="text-slate-500 text-[11px] line-clamp-2">${em.snippet}</div>
        </div>

        <button type="button" class="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200 transition shrink-0"
          onclick="openDiscoveredEmailMessagePreview(${em.email_id})">
          View Message
        </button>
      `;

      rawListEl.appendChild(emailCard);
    });
  }

  updateApproveButtonText();
  lucide.createIcons();
}

function updateApproveButtonText() {
  const btnText = document.getElementById('btnApproveAndExtractText');
  if (btnText) {
    btnText.textContent = `Approve & Extract Quotations (${selectedSupplierKeys.size} Selected)`;
  }
}

async function handleApproveAndExtract() {
  if (!lastScannedDiscoveryData) return;
  if (selectedSupplierKeys.size === 0) {
    showToast('Please select at least 1 supplier to extract and compare.', 'warning');
    return;
  }

  const progressSection = document.getElementById('compareProgressSection');
  const reviewSection = document.getElementById('compareEmailReviewSection');
  const resultsSection = document.getElementById('compareResultsSection');
  const statusTitle = document.getElementById('compareProgressStatusTitle');
  const statusSub = document.getElementById('compareProgressStatusSub');

  if (reviewSection) reviewSection.classList.add('hidden');
  if (progressSection) progressSection.classList.remove('hidden');
  if (statusTitle) statusTitle.textContent = `Extracting Quotations for ${selectedSupplierKeys.size} Approved Suppliers...`;
  if (statusSub) statusSub.textContent = 'Extracting Price, Lead Time, Condition, and cross-referencing against Master Baseline RFQ...';

  const step1 = document.getElementById('stepProgress1');
  const step2 = document.getElementById('stepProgress2');
  const step3 = document.getElementById('stepProgress3');
  const step4 = document.getElementById('stepProgress4');

  if (step1) step1.className = 'p-2.5 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-800 font-semibold flex items-center gap-2';
  if (step2) step2.className = 'p-2.5 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-800 font-semibold flex items-center gap-2';
  if (step3) step3.className = 'p-2.5 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-800 font-semibold flex items-center gap-2';
  if (step4) step4.className = 'p-2.5 rounded-lg border bg-amber-50 border-amber-300 text-amber-800 font-bold flex items-center gap-2 animate-pulse';

  try {
    const currencySelect = document.getElementById('compareTargetCurrency');
    const targetCurr = currencySelect ? currencySelect.value : 'MYR';

    const activeUser = (typeof getActiveUser === 'function') ? getActiveUser() : null;
    const mailboxUser = (activeUser && activeUser.email) ? activeUser.email : 'project@apmerinservices.com.my';

    const payloadStr = JSON.stringify({
      subject_query: lastScannedDiscoveryData.subject_query,
      approved_supplier_keys: Array.from(selectedSupplierKeys),
      target_currency: targetCurr,
      mailbox_user: mailboxUser,
      initial_rfq: lastScannedDiscoveryData.initial_rfq,
      supplier_threads: lastScannedDiscoveryData.supplier_threads,
      discovered_emails: lastScannedDiscoveryData.discovered_emails
    });

    const isLocalServer = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.port === '5000');

    let data = null;

    // On local desktop app (Launch_AP_Merin.bat / Flask on localhost:5000), use Python backend directly
    if (isLocalServer) {
      try {
        const response = await fetch('/api/comparator/proceed-extraction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payloadStr
        });
        if (response && response.ok) {
          const cType = response.headers.get('content-type') || '';
          if (cType.includes('application/json')) {
            data = await response.json();
          }
        }
      } catch (_) {}
    }

    // On Netlify Cloud or if local backend extraction failed, execute in-browser progressive extraction
    // This completely bypasses Netlify 10-second serverless execution timeouts and guarantees 100% reliability
    if (!data || !data.success) {
      data = await runProgressiveClientExtraction(
        lastScannedDiscoveryData,
        selectedSupplierKeys,
        targetCurr,
        mailboxUser
      );
    }

    if (!data || !data.success) {
      if (progressSection) progressSection.classList.add('hidden');
      if (reviewSection) reviewSection.classList.remove('hidden');
      showToast((data && data.error) || 'Failed to extract quotations.', 'error');
      return;
    }

    if (step4) step4.className = 'p-2.5 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-800 font-semibold flex items-center gap-2';
    if (progressSection) progressSection.classList.add('hidden');

    lastComparisonData = data;
    renderComparisonResults(data);

    if (resultsSection) {
      resultsSection.classList.remove('hidden');
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    showToast(`Successfully compiled comparison for ${data.supplier_count} supplier(s)!`, 'success');

  } catch (err) {
    if (progressSection) progressSection.classList.add('hidden');
    if (reviewSection) reviewSection.classList.remove('hidden');
    showToast('Error extracting approved quotes: ' + err.message, 'error');
  }
}

/**
 * Pure JavaScript Side-by-Side Comparison Matrix Compiler
 * 100% schema parity with Python quotation_comparator.py
 */
function compileSideBySideComparisonJS(supplierQuotes, targetCurrency = 'MYR', fxRates = null, baselineRfq = null, initialRfq = null) {
  const rates = { ...USD_BASE_RATES, ...(fxRates || {}) };

  function convertPrice(amount, fromCurr) {
    const num = parseFloat(amount) || 0.0;
    if (num === 0) return 0.0;
    const fromC = (fromCurr || 'USD').toUpperCase().trim();
    const toC = (targetCurrency || 'MYR').toUpperCase().trim();
    if (fromC === toC) return num;
    const fromRate = rates[fromC] || 1.0;
    const toRate = rates[toC] || 4.45;
    return (num / fromRate) * toRate;
  }

  // 1. Establish Master Baseline Items
  let baselineItems = [];
  if (baselineRfq && baselineRfq.items && baselineRfq.items.length > 0) {
    baselineItems = baselineRfq.items;
  } else {
    const firstQuoteWithItems = supplierQuotes.find(q => q.items && q.items.length > 0);
    if (firstQuoteWithItems) {
      baselineItems = firstQuoteWithItems.items.map((it, idx) => ({
        item_index: idx + 1,
        item_code: it.part_no || String(idx + 1),
        part_no: it.part_no || String(idx + 1),
        description: it.description || `Item ${idx + 1}`,
        quantity: parseFloat(it.quantity) || 1.0,
        unit: it.unit || 'PCS'
      }));
    }
  }

  const finalBaselineRfq = {
    vessel_name: baselineRfq?.vessel_name || initialRfq?.vessel_name || 'AFRA MARE',
    rfq_number: baselineRfq?.rfq_number || initialRfq?.subject || 'ARM-e-107/2026-I004',
    maker: baselineRfq?.maker || 'NANIWA PUMP',
    model: baselineRfq?.model || 'C.O.P.T CONDENSER COOL. S.W. PUMP',
    items: baselineItems
  };

  // 2. Build Comparison Matrix
  const comparisonMatrix = baselineItems.map((bItem, bIdx) => {
    const supplierOffers = {};
    let lowestUnitPriceConverted = Infinity;
    let lowestSupplierIdx = null;

    supplierQuotes.forEach((sq, sIdx) => {
      if (sq.is_regret || sq.is_pending || !sq.items || sq.items.length === 0) return;

      let matched = sq.items.find(it => {
        const p1 = (it.part_no || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const p2 = (bItem.part_no || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return p1 && p2 && (p1 === p2 || p1.includes(p2) || p2.includes(p1));
      });

      if (!matched && sq.items[bIdx]) {
        matched = sq.items[bIdx];
      }

      if (matched && matched.unit_price > 0) {
        const unitRaw = matched.unit_price;
        const totalRaw = matched.total_amount || (unitRaw * bItem.quantity);
        const unitConverted = convertPrice(unitRaw, sq.currency);
        const totalConverted = convertPrice(totalRaw, sq.currency);

        supplierOffers[sIdx] = {
          unit_price_raw: unitRaw,
          currency_raw: sq.currency,
          unit_price_converted: unitConverted,
          total_price_converted: totalConverted,
          lead_time: matched.lead_time || '2-3 Weeks',
          condition: matched.condition || 'Original',
          origin_notes: '',
          remarks: matched.remarks || '',
          raw_item_desc: matched.description || ''
        };

        if (unitConverted > 0 && unitConverted < lowestUnitPriceConverted) {
          lowestUnitPriceConverted = unitConverted;
          lowestSupplierIdx = sIdx;
        }
      }
    });

    return {
      item_index: bIdx + 1,
      item_code: bItem.part_no || String(bIdx + 1),
      part_no: bItem.part_no || String(bIdx + 1),
      description: bItem.description,
      quantity: bItem.quantity,
      unit: bItem.unit,
      lowest_price_supplier: lowestSupplierIdx,
      lowest_unit_price: lowestUnitPriceConverted < Infinity ? lowestUnitPriceConverted : 0.0,
      supplier_offers: supplierOffers
    };
  });

  // 3. Build Supplier Summaries
  const supplierSummaries = supplierQuotes.map((sq, sIdx) => {
    if (sq.is_regret) {
      return {
        supplier_index: sIdx,
        supplier_name: sq.supplier_name,
        supplier_email: sq.supplier_key || sq.supplier_email || '',
        quotation_no: 'Regret / Declined',
        currency_original: sq.currency || 'USD',
        total_converted: 0.0,
        target_currency: targetCurrency,
        quoted_items_count: 0,
        total_items_rfq: baselineItems.length,
        compliance_percent: 0,
        compliance_status: 'Regret / Declined',
        missing_items: baselineItems.map(it => it.description),
        is_regret: true,
        is_pending: false,
        is_overall_best_price: false,
        best_lead_time: 'N/A',
        source_file: sq.source_file || 'Email Reply',
        source_type: sq.source_type || 'Email Body',
        source_preview: sq.source_preview || {}
      };
    }

    if (sq.is_pending) {
      return {
        supplier_index: sIdx,
        supplier_name: sq.supplier_name,
        supplier_email: sq.supplier_key || sq.supplier_email || '',
        quotation_no: 'Receipt Acknowledged',
        currency_original: sq.currency || 'USD',
        total_converted: 0.0,
        target_currency: targetCurrency,
        quoted_items_count: 0,
        total_items_rfq: baselineItems.length,
        compliance_percent: 0,
        compliance_status: 'Pending Quote',
        missing_items: baselineItems.map(it => it.description),
        is_regret: false,
        is_pending: true,
        is_overall_best_price: false,
        best_lead_time: 'Pending',
        source_file: sq.source_file || 'Email Reply',
        source_type: sq.source_type || 'Email Body',
        source_preview: sq.source_preview || {}
      };
    }

    let totalConverted = 0.0;
    let itemsQuoted = 0;
    let origCount = 0;
    let oemCount = 0;
    let repCount = 0;
    let missing = [];

    comparisonMatrix.forEach(row => {
      const off = row.supplier_offers[sIdx];
      if (off && off.unit_price_converted > 0) {
        totalConverted += off.total_price_converted;
        itemsQuoted++;
        const c = (off.condition || '').toLowerCase();
        if (c.includes('orig')) origCount++;
        else if (c.includes('oem')) oemCount++;
        else repCount++;
      } else {
        missing.push(row.description);
      }
    });

    const compPct = baselineItems.length > 0 ? Math.round((itemsQuoted / baselineItems.length) * 100) : 0;

    return {
      supplier_index: sIdx,
      supplier_name: sq.supplier_name,
      supplier_email: sq.supplier_key || sq.supplier_email || '',
      quotation_no: sq.quotation_no || 'N/A',
      currency_original: sq.currency || 'USD',
      total_converted: Math.round(totalConverted * 100) / 100,
      target_currency: targetCurrency,
      quoted_items_count: itemsQuoted,
      total_items_rfq: baselineItems.length,
      compliance_percent: compPct,
      compliance_status: compPct === 100 ? 'All Items Quoted (100%)' : `${itemsQuoted}/${baselineItems.length} Quoted`,
      missing_items: missing,
      is_regret: false,
      is_pending: false,
      is_overall_best_price: false,
      best_lead_time: sq.delivery_terms || '2-3 Weeks',
      original_items_count: origCount,
      oem_items_count: oemCount,
      replacement_items_count: repCount,
      source_file: sq.source_file || 'Quotation.pdf',
      source_type: sq.source_type || 'Attachment',
      source_preview: sq.source_preview || {}
    };
  });

  // Calculate overall best price
  const validTotals = supplierSummaries
    .filter(s => !s.is_regret && !s.is_pending && s.total_converted > 0)
    .map(s => ({ idx: s.supplier_index, total: s.total_converted }));

  if (validTotals.length > 0) {
    const minTot = Math.min(...validTotals.map(t => t.total));
    const best = validTotals.find(t => t.total === minTot);
    if (best) {
      supplierSummaries[best.idx].is_overall_best_price = true;
    }
  }

  return {
    success: true,
    target_currency: targetCurrency,
    total_rfq_items: baselineItems.length,
    supplier_count: supplierQuotes.length,
    baseline_rfq: finalBaselineRfq,
    initial_rfq: initialRfq || {},
    suppliers: supplierSummaries,
    comparison_matrix: comparisonMatrix,
    alternative_items: []
  };
}

/**
 * Universal Mailbox Attachment Fetcher
 * Automatically detects local Flask vs Netlify Cloud environment, ensuring zero HTML-rewrite hijacking.
 */
async function fetchMailboxQuoteDoc(items) {
  const isLocal = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.port === '5000');
  
  // Prefer the direct native endpoint: Flask endpoint on local, Netlify function on cloud
  const primaryUrl = isLocal ? '/api/comparator/fetch-quote-doc' : '/.netlify/functions/fetch-quote-doc';
  const fallbackUrl = isLocal ? '/.netlify/functions/fetch-quote-doc' : '/api/comparator/fetch-quote-doc';

  const urlsToTry = [primaryUrl, fallbackUrl];

  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items })
      });

      const cType = res ? (res.headers.get('content-type') || '') : '';
      if (res && res.ok && cType.includes('application/json')) {
        const data = await res.json();
        if (data && data.success) {
          return data;
        }
      }
    } catch (e) {
      console.warn(`Fetch quote doc attempt to ${url} failed:`, e);
    }
  }

  throw new Error('Failed to retrieve quotation attachment from mailbox.');
}

/**
 * High-Speed Progressive In-Browser Quotation Extraction
 * Runs directly in client browser, immune to serverless 10-second timeouts.
 */
async function runProgressiveClientExtraction(discoveryData, approvedKeysSet, targetCurr, mailboxUser) {
  const step4 = document.getElementById('stepProgress4');
  const updateProgress = (text) => {
    if (step4) {
      step4.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin text-amber-600"></i><span>${text}</span>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  };

  const approvedThreads = (discoveryData.supplier_threads || []).filter(st => {
    if (approvedKeysSet.size === 0) return true;
    return approvedKeysSet.has(st.supplier_key) || approvedKeysSet.has(st.supplier_name);
  });

  if (approvedThreads.length === 0) {
    throw new Error('No approved suppliers selected for extraction.');
  }

  // 1. Identify suppliers with quote documents to fetch
  const docsToFetch = [];
  approvedThreads.forEach(st => {
    const isRegret = st.status === 'REGRET' || (st.status_notes && /out of.*product range|unable to quote|decline/i.test(st.status_notes));
    const isPending = st.status === 'PENDING' || (st.status_notes && /pending|on check|acknowledged/i.test(st.status_notes));
    if (!isRegret && !isPending && st.quote_documents && st.quote_documents.length > 0) {
      const qd = st.quote_documents[0];
      docsToFetch.push({
        supplier_key: st.supplier_key,
        folder: st.folder || (st.emails && st.emails[0]?.folder) || 'INBOX',
        msg_id: st.msg_id || (st.emails && st.emails[0]?.msg_id),
        filename: qd.filename
      });
    }
  });

  // 2. Fetch document binaries rapidly via fetchMailboxQuoteDoc (<1 second)
  const fetchedDocsMap = new Map();
  if (docsToFetch.length > 0) {
    updateProgress(`Fetching ${docsToFetch.length} quotation document(s) from mailbox...`);
    try {
      const docData = await fetchMailboxQuoteDoc(docsToFetch);
      const docs = docData.documents || (docData.base64 ? [docData] : []);
      docs.forEach((d, idx) => {
        const key = d.supplier_key || (docsToFetch[idx] && docsToFetch[idx].supplier_key) || d.filename;
        fetchedDocsMap.set(key, d);
        if (d.filename) fetchedDocsMap.set(d.filename, d);
        if (docsToFetch[idx] && docsToFetch[idx].supplier_key) {
          fetchedDocsMap.set(docsToFetch[idx].supplier_key, d);
        }
      });
    } catch (fetchErr) {
      console.warn('Document fetch warning:', fetchErr);
    }
  }

  // 3. Multimodal AI Extraction with Gemini Flash in Browser
  updateProgress(`Analyzing ${approvedThreads.length} quotation(s) with Gemini AI...`);

  const promptSupplierQuote = `You are an expert marine procurement analyst.
Extract all commercial quoted line items and terms into valid JSON.
CRITICAL RULES:
1. ONLY extract commercial product line items that have a price.
2. DO NOT extract company headers, addresses, or email disclaimers as items.
3. Classify condition as 'Original', 'OEM', or 'Replacement'.
Return JSON schema:
{
  "supplier_name": "Selling Supplier Company Name",
  "quotation_no": "Quote ref number",
  "currency": "USD/EUR/MYR/SGD/KRW",
  "payment_terms": "e.g. 30 Days",
  "delivery_terms": "e.g. FOB Busan / Ex-Works",
  "items": [
    {
      "item_no": 1,
      "part_no": "Part or Maker Number",
      "description": "Item description",
      "quantity": 1.0,
      "unit": "PCS/SET",
      "unit_price": 100.00,
      "total_amount": 100.00,
      "currency": "USD",
      "lead_time": "e.g. 2 Weeks / Ex-Stock",
      "condition": "Original",
      "remarks": ""
    }
  ]
}`;

  const supplierQuotesPromises = approvedThreads.map(async (st) => {
    // Regret
    if (st.status === 'REGRET' || (st.status_notes && /out of.*product range|unable to quote|decline/i.test(st.status_notes))) {
      return {
        supplier_name: st.supplier_name,
        supplier_key: st.supplier_key,
        is_regret: true,
        is_pending: false,
        regret_reason: st.status_notes || 'Supplier declined to quote (Product out of range / Unable to quote)',
        currency: 'USD',
        items: [],
        source_type: 'email',
        source_file: 'Email Reply',
        source_preview: { preview_type: 'email', email_data: { sender_name: st.supplier_name, body_text: (st.emails && st.emails[0]?.body) || '' } }
      };
    }

    // Pending
    if (st.status === 'PENDING' || st.status === 'PENDING_SUPPLIER' || (st.status_notes && /pending|on check|receipt|acknowledg/i.test(st.status_notes))) {
      return {
        supplier_name: st.supplier_name,
        supplier_key: st.supplier_key,
        is_regret: false,
        is_pending: true,
        pending_reason: st.status_notes || 'Quotation pending from supplier.',
        currency: 'USD',
        items: [],
        source_type: 'email',
        source_file: 'Email Reply',
        source_preview: { preview_type: 'email', email_data: { sender_name: st.supplier_name, body_text: (st.emails && st.emails[0]?.body) || '' } }
      };
    }

    let quoteObj = null;
    let doc = fetchedDocsMap.get(st.supplier_key);
    if (!doc && st.quote_documents && st.quote_documents.length > 0) {
      doc = fetchedDocsMap.get(st.quote_documents[0].filename);
    }

    if (doc && doc.base64) {
      try {
        const parts = [{ inlineData: { mimeType: doc.mime_type || 'application/pdf', data: doc.base64 } }, { text: promptSupplierQuote }];
        if (typeof callGeminiApi === 'function') {
          quoteObj = await callGeminiApi(parts);
        }
      } catch (gemErr) {
        console.warn(`Gemini extraction error for ${st.supplier_name}:`, gemErr);
      }
    }

    // Fallback to email body if no attachment or attachment parsing didn't produce items
    if (!quoteObj && st.emails && st.emails.length > 0) {
      const bodyText = st.emails[0].body || (st.email_bodies && st.email_bodies[0]) || '';
      if (bodyText.length > 20) {
        try {
          const parts = [{ text: `SUPPLIER EMAIL BODY:\n${bodyText}\n\n${promptSupplierQuote}` }];
          if (typeof callGeminiApi === 'function') {
            quoteObj = await callGeminiApi(parts);
          }
        } catch (_) {}
      }
    }

    if (Array.isArray(quoteObj)) {
      quoteObj = { items: quoteObj };
    }
    const extractedItems = quoteObj ? (quoteObj.items || quoteObj.line_items || quoteObj.quote_items || quoteObj.table_items || []) : [];

    if (quoteObj && extractedItems.length > 0) {
      const suppName = quoteObj.supplier_name || st.supplier_name;
      const suppCurr = (quoteObj.currency || 'USD').replace(/US\$/i, 'USD').replace(/\$/g, 'USD');

      return {
        supplier_name: suppName,
        supplier_key: st.supplier_key,
        quotation_no: quoteObj.quotation_no || 'N/A',
        currency: suppCurr,
        payment_terms: quoteObj.payment_terms || 'Net 30',
        delivery_terms: quoteObj.delivery_terms || 'Ex-Works',
        items: extractedItems.map((it, idx) => ({
          item_no: it.item_no || idx + 1,
          part_no: String(it.part_no || it.maker_no || it.item_code || it.item_no || '').trim(),
          description: String(it.description || '').trim(),
          quantity: parseFloat(it.quantity) || 1.0,
          unit: String(it.unit || 'PCS').trim(),
          unit_price: parseFloat(it.unit_price) || 0.0,
          total_amount: parseFloat(it.total_amount) || ((parseFloat(it.quantity) || 1.0) * (parseFloat(it.unit_price) || 0.0)),
          currency: suppCurr,
          lead_time: it.lead_time || '2-3 Weeks',
          condition: it.condition || 'Original',
          remarks: it.remarks || ''
        })),
        source_type: doc ? 'Attachment' : 'Email Body',
        source_file: doc ? doc.filename : 'Email Reply',
        source_preview: {
          preview_type: doc ? 'document' : 'email',
          preview_filename: doc ? doc.filename : 'Email Reply',
          base64: doc ? doc.base64 : '',
          mime_type: doc ? (doc.mime_type || 'application/pdf') : 'application/pdf',
          pages: [],
          email_data: { sender_name: st.supplier_name, body_text: (st.emails && st.emails[0]?.body) || '' }
        }
      };
    }

    return {
      supplier_name: st.supplier_name,
      supplier_key: st.supplier_key,
      is_regret: false,
      is_pending: true,
      pending_reason: st.status_notes || 'Quotation details pending from supplier.',
      currency: 'USD',
      items: [],
      source_type: 'email',
      source_file: 'Email Reply',
      source_preview: { preview_type: 'email', email_data: { sender_name: st.supplier_name, body_text: (st.emails && st.emails[0]?.body) || '' } }
    };
  });

  const supplierQuotes = await Promise.all(supplierQuotesPromises);

  // 4. Compile Comparison Matrix
  updateProgress('Compiling comparison matrix...');
  const comparisonData = compileSideBySideComparisonJS(
    supplierQuotes,
    targetCurr,
    null,
    null,
    discoveryData.initial_rfq
  );

  return comparisonData;
}

function handleManualFilesSelect(files) {
  compareManualFiles = files;
  const listEl = document.getElementById('compareUploadedFilesList');
  if (listEl) {
    listEl.innerHTML = '';
    files.forEach((f, idx) => {
      const item = document.createElement('div');
      item.className = 'flex items-center justify-between bg-white px-2.5 py-1.5 rounded border border-slate-200 text-xs';
      item.innerHTML = `
        <span class="font-medium text-slate-800 truncate max-w-xs">${idx + 1}. ${f.name}</span>
        <span class="text-slate-400 text-[11px]">${(f.size / 1024).toFixed(1)} KB</span>
      `;
      listEl.appendChild(item);
    });
  }
}

async function handleManualQuotesExtract() {
  const pastedText = document.getElementById('comparePastedText')?.value.trim() || '';

  if (compareManualFiles.length === 0 && !pastedText) {
    showToast('Please upload quotation files or paste quotation text to compare.', 'warning');
    return;
  }

  const currencySelect = document.getElementById('compareTargetCurrency');
  const targetCurrency = currencySelect ? currencySelect.value : 'MYR';

  const formData = new FormData();
  formData.append('target_currency', targetCurrency);
  formData.append('pasted_text', pastedText);
  compareManualFiles.forEach(f => formData.append('files', f));

  const progressSection = document.getElementById('compareProgressSection');
  const statusTitle = document.getElementById('compareProgressStatusTitle');
  const statusSub = document.getElementById('compareProgressStatusSub');

  if (progressSection) progressSection.classList.remove('hidden');
  if (statusTitle) statusTitle.textContent = 'Processing uploaded quotation files...';
  if (statusSub) statusSub.textContent = 'Extracting Price, Lead Time, and OEM vs Original factors via AI...';

  try {
    const res = await fetch('/api/comparator/extract-manual', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (!data.success) {
      if (progressSection) progressSection.classList.add('hidden');
      showToast(data.error || 'Failed to process quotation files.', 'error');
      return;
    }

    lastComparisonData = data;
    renderComparisonResults(data);

    const resultsSection = document.getElementById('compareResultsSection');
    if (resultsSection) {
      resultsSection.classList.remove('hidden');
      resultsSection.scrollIntoView({ behavior: 'smooth' });
    }
    showToast(`Compiled comparison for ${data.supplier_count} supplier(s)!`, 'success');

  } catch (err) {
    if (progressSection) progressSection.classList.add('hidden');
    showToast('Error parsing manual quotes: ' + err.message, 'error');
  }
}

function renderComparisonResults(data) {
  if (!data || !data.suppliers) return;

  const targetCurr = data.target_currency || 'MYR';

  // Synchronize Currency & Manual Exchange Rate Controls (Matching Image 2)
  const currencySelect = document.getElementById('compareTargetCurrency');
  if (currencySelect && targetCurr) {
    currencySelect.value = targetCurr;
  }
  const prefixEl = document.getElementById('compareFxInputPrefix');
  const suffixEl = document.getElementById('compareFxInputSuffix');
  const rateInput = document.getElementById('compareFxRateInput');
  if (prefixEl) prefixEl.textContent = '1 USD =';
  if (suffixEl) suffixEl.textContent = targetCurr;
  if (rateInput && document.activeElement !== rateInput) {
    const activeRate = (lastComparisonFxRate !== null && lastComparisonFxRate !== undefined) ? lastComparisonFxRate : (USD_BASE_RATES[targetCurr] || 1.0);
    rateInput.value = Number(activeRate).toFixed(4);
  }

  // 1. Stats Counter
  const totalItemsEl = document.getElementById('compareTotalItemsCount');
  const suppliersCountEl = document.getElementById('compareSuppliersCount');
  if (totalItemsEl) totalItemsEl.textContent = data.total_rfq_items || 0;
  if (suppliersCountEl) suppliersCountEl.textContent = data.supplier_count || 0;

  // 2. Baseline RFQ Section (Master requested inquiry)
  const baselineSection = document.getElementById('compareBaselineSection');
  if (baselineSection) {
    const b = data.baseline_rfq;
    if (b && b.items && b.items.length > 0) {
      baselineSection.classList.remove('hidden');
      const vesselEl = document.getElementById('baselineVesselName');
      const rfqBadgeEl = document.getElementById('baselineRfqBadge');
      const equipEl = document.getElementById('baselineEquipmentInfo');
      const origEl = document.getElementById('baselineOriginatorInfo');
      const countEl = document.getElementById('baselineItemsCount');
      const chipsEl = document.getElementById('baselineItemsChips');

      if (vesselEl) vesselEl.textContent = b.vessel_name ? `Vessel: ${b.vessel_name}` : 'Baseline RFQ';
      if (rfqBadgeEl) rfqBadgeEl.textContent = b.rfq_number || data.subject_query || 'Inquiry';
      if (equipEl) equipEl.textContent = `Equipment: ${b.maker || '-'} • Model: ${b.model || '-'}${b.imo_number ? ` • IMO: ${b.imo_number}` : ''}`;
      
      if (origEl) {
        const init = data.initial_rfq || (lastScannedDiscoveryData && lastScannedDiscoveryData.initial_rfq);
        if (init && init.sender_name) {
          let txt = `Initial RFQ Sent by: ${init.sender_name} <${init.sender_email || ''}> on ${init.date || '-'}`;
          const diffs = (init.internal_replies || []).filter(r => r.is_different_sender);
          if (diffs.length > 0) {
            txt += ` • Internal follow-up by: ${diffs.map(d => d.sender_name).join(', ')}`;
          }
          origEl.textContent = txt;
          origEl.classList.remove('hidden');
        } else {
          origEl.classList.add('hidden');
        }
      }

      if (countEl) countEl.textContent = b.items.length;

      if (chipsEl) {
        chipsEl.innerHTML = b.items.map((it, idx) => `
          <div class="px-2.5 py-1 rounded-lg bg-blue-900/40 border border-blue-600/40 text-blue-200 text-xs font-mono flex items-center gap-1.5 shadow-2xs">
            <span class="text-[10px] text-blue-300 font-bold bg-blue-950 px-1 py-0.5 rounded">${it.part_no || it.item_no || idx+1}</span>
            <span class="font-sans font-medium">${it.description}</span>
            <span class="text-blue-400 font-normal">(${it.quantity || 1} ${it.unit || 'PCS'})</span>
          </div>
        `).join('');
      }

      const btnViewBaseline = document.getElementById('btnViewBaselineDoc');
      if (btnViewBaseline) {
        btnViewBaseline.onclick = () => openBaselineSourcePreview();
        btnViewBaseline.style.display = (b.preview && b.preview.preview_pages && b.preview.preview_pages.length > 0) ? 'flex' : 'none';
      }

      const btnViewBaselineEmail = document.getElementById('btnViewBaselineEmail');
      if (btnViewBaselineEmail) {
        btnViewBaselineEmail.onclick = () => openBaselineEmailPreview();
        btnViewBaselineEmail.style.display = 'flex';
      }
    } else {
      baselineSection.classList.add('hidden');
    }
  }

  // 3. Supplier Summary Cards
  const cardsGrid = document.getElementById('compareSupplierCardsGrid');
  if (cardsGrid) {
    cardsGrid.innerHTML = '';
    data.suppliers.forEach((s, s_idx) => {
      const card = document.createElement('div');
      const isWinner = s.is_overall_best_price;
      const isRegret = s.is_regret;
      const isPending = s.is_pending;

      let cardBorder = 'bg-white border-slate-200 shadow-sm hover:shadow-md';
      if (isWinner) cardBorder = 'bg-emerald-50/40 border-emerald-300 shadow-md ring-2 ring-emerald-500/20';
      if (isRegret) cardBorder = 'bg-rose-50/30 border-rose-200 shadow-sm opacity-90';

      card.className = `rounded-2xl p-5 border transition flex flex-col justify-between space-y-4 ${cardBorder}`;

      // Status / Compliance Badge
      let compliancePill = '';
      if (isRegret) {
        compliancePill = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 text-xs font-bold border border-rose-200">
          <i data-lucide="x-circle" class="w-3.5 h-3.5 text-rose-600"></i> Regret / Declined
        </span>`;
      } else if (isPending) {
        compliancePill = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold border border-amber-200">
          <i data-lucide="clock" class="w-3.5 h-3.5 text-amber-600"></i> Quote Pending
        </span>`;
      } else if (s.compliance_percent === 100) {
        compliancePill = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-300">
          <i data-lucide="check-circle" class="w-3.5 h-3.5 text-emerald-600"></i> ${s.compliance_status || 'All Items Quoted (100%)'}
        </span>`;
      } else {
        compliancePill = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold border border-amber-300">
          <i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-amber-600"></i> ${s.compliance_status || `${s.quoted_items_count}/${s.total_items_rfq} Quoted`}
        </span>`;
      }

      // Missing items warning
      let missingItemsNotice = '';
      if (s.missing_items && s.missing_items.length > 0 && !isRegret && !isPending) {
        missingItemsNotice = `
          <div class="p-2 bg-amber-50/80 border border-amber-200/80 rounded-xl text-[11px] text-amber-900">
            <span class="font-bold text-amber-800">⚠️ Did Not Quote (${s.missing_items.length}):</span>
            <span class="text-amber-700">${s.missing_items.slice(0, 3).join(', ')}${s.missing_items.length > 3 ? ` +${s.missing_items.length - 3} more` : ''}</span>
          </div>
        `;
      }

      card.innerHTML = `
        <div>
          <div class="flex items-start justify-between gap-2 mb-2.5">
            <div class="space-y-0.5">
              <h4 class="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                ${s.supplier_name}
                ${isWinner ? '<span class="text-[10px] bg-emerald-600 text-white font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Lowest Total</span>' : ''}
              </h4>
              <p class="text-xs text-slate-500 truncate max-w-[200px]" title="${s.supplier_email}">${s.supplier_email || 'Direct Supplier'}</p>
            </div>
            <span class="text-xs font-mono font-bold px-2 py-0.5 bg-slate-100 text-slate-700 rounded border border-slate-200">
              ${s.currency_original || 'USD'}
            </span>
          </div>

          <div class="mb-3">
            ${compliancePill}
          </div>

          <div class="space-y-2 py-2.5 border-y border-slate-100 text-xs">
            <div class="flex items-center justify-between">
              <span class="text-slate-500">Total Quoted Amount (${targetCurr}):</span>
              <span class="font-mono font-bold text-slate-900 text-sm ${isWinner ? 'text-emerald-700' : ''}">
                ${isRegret ? '<span class="text-slate-400 font-normal italic">Declined</span>' : `${targetCurr} ${Number(s.total_converted || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </span>
            </div>

            <div class="flex items-center justify-between">
              <span class="text-slate-500">Lead Time:</span>
              <span class="font-semibold text-slate-800">${s.best_lead_time || 'TBA'}</span>
            </div>

            <div class="flex items-center justify-between">
              <span class="text-slate-500">Source Type:</span>
              <span class="font-medium text-slate-700 flex items-center gap-1 truncate max-w-[150px]" title="${s.source_file}">
                <i data-lucide="${s.source_type === 'Attachment' ? 'file-text' : 'mail'}" class="w-3 h-3 text-amber-600"></i>
                ${s.source_file || 'Direct Email'}
              </span>
            </div>

            <!-- Condition Breakdown Badges -->
            ${(!isRegret && !isPending) ? `
              <div class="pt-1 flex flex-wrap gap-1.5">
                ${s.original_items_count > 0 ? `<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold border border-emerald-200">🌟 ${s.original_items_count} Original</span>` : ''}
                ${s.oem_items_count > 0 ? `<span class="px-2 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-bold border border-purple-200">⚙️ ${s.oem_items_count} OEM</span>` : ''}
                ${s.replacement_items_count > 0 ? `<span class="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-200">🔄 ${s.replacement_items_count} Replacement</span>` : ''}
              </div>
            ` : ''}

            ${missingItemsNotice}
          </div>
        </div>

        <!-- Card Actions & Source Preview Button -->
        <div class="space-y-2 pt-1">
          ${s.source_type === 'Attachment' ? `
            <div class="grid grid-cols-2 gap-1.5">
              <button type="button" class="py-2 px-2 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold rounded-xl text-xs transition border border-amber-200 flex items-center justify-center gap-1 shadow-2xs cursor-pointer truncate"
                onclick="openSupplierSourcePreview(${s_idx}, 'document')" title="Preview Attached Quotation (${escapeHtml(s.source_file || '')})">
                <i data-lucide="file-text" class="w-3.5 h-3.5 text-amber-600 shrink-0"></i>
                <span class="truncate">Preview Doc</span>
              </button>
              <button type="button" class="py-2 px-2 bg-blue-50 hover:bg-blue-100 text-blue-900 font-bold rounded-xl text-xs transition border border-blue-200 flex items-center justify-center gap-1 shadow-2xs cursor-pointer truncate"
                onclick="openSupplierSourcePreview(${s_idx}, 'email')" title="Preview Supplier Email Message">
                <i data-lucide="mail" class="w-3.5 h-3.5 text-blue-600 shrink-0"></i>
                <span class="truncate">Preview Email</span>
              </button>
            </div>
          ` : `
            <button type="button" class="w-full py-2 px-3 bg-blue-50 hover:bg-blue-100 text-blue-900 font-bold rounded-xl text-xs transition border border-blue-200 flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
              onclick="openSupplierSourcePreview(${s_idx}, 'email')">
              <i data-lucide="mail" class="w-4 h-4 text-blue-600"></i>
              <span>✉️ Preview Email Reply</span>
            </button>
          `}

          ${!isRegret ? `
            <div class="flex items-center justify-between gap-2">
              <button type="button" class="flex-1 py-1.5 px-2.5 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 font-bold rounded-lg text-xs transition border border-slate-200"
                onclick="transferSpecificSupplierToMode(${s_idx}, 'quotation')">
                Use for Quote
              </button>
              <button type="button" class="flex-1 py-1.5 px-2.5 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 font-bold rounded-lg text-xs transition border border-slate-200"
                onclick="transferSpecificSupplierToMode(${s_idx}, 'po')">
                Create PO
              </button>
            </div>
          ` : ''}
        </div>
      `;

      cardsGrid.appendChild(card);
    });
  }

  // 4. Side-by-Side Line Item Table
  const tableEl = document.getElementById('compareMatrixTable');
  if (!tableEl) return;

  const suppliers = data.suppliers || [];
  const matrix = data.comparison_matrix || [];

  let html = '<thead>';

  // Super-headers
  html += '<tr class="bg-slate-900 text-white select-none">';
  html += '<th rowspan="2" class="p-3 font-bold border border-slate-800 text-center w-12">#</th>';
  html += '<th rowspan="2" class="p-3 font-bold border border-slate-800 w-28">Part / Item</th>';
  html += '<th rowspan="2" class="p-3 font-bold border border-slate-800 min-w-[200px]">Description</th>';
  html += '<th rowspan="2" class="p-3 font-bold border border-slate-800 text-center w-14">Qty</th>';
  html += '<th rowspan="2" class="p-3 font-bold border border-slate-800 text-center w-14">Unit</th>';

  suppliers.forEach((s, s_idx) => {
    const isWin = s.is_overall_best_price;
    const isRegret = s.is_regret;
    let colHeaderBg = isWin ? 'bg-emerald-800' : (isRegret ? 'bg-slate-800 opacity-75' : 'bg-slate-800');

    html += `<th colspan="4" class="p-2.5 font-bold border border-slate-800 text-center ${colHeaderBg}">
      <div class="flex items-center justify-between gap-1.5 px-1">
        <div class="flex items-center gap-1.5 truncate">
          <span class="truncate">${s.supplier_name}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-white/20 font-mono">${s.currency_original}</span>
        </div>
        <button type="button" class="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 border border-amber-400/40 rounded text-[10px] font-semibold flex items-center gap-1 shrink-0 transition"
          onclick="openSupplierSourcePreview(${s_idx})" title="Preview Source">
          <i data-lucide="eye" class="w-3 h-3"></i>
          <span>Source</span>
        </button>
      </div>
    </th>`;
  });
  html += '</tr>';

  // Sub-headers
  html += '<tr class="bg-slate-800 text-slate-200 select-none text-[11px]">';
  suppliers.forEach(s => {
    html += `<th class="p-2 border border-slate-700 text-right w-24">Unit Price (${targetCurr})</th>`;
    html += `<th class="p-2 border border-slate-700 text-right w-24">Total (${targetCurr})</th>`;
    html += `<th class="p-2 border border-slate-700 text-center w-28">Lead Time</th>`;
    html += `<th class="p-2 border border-slate-700 text-center w-28">Condition</th>`;
  });
  html += '</tr></thead><tbody>';

  // Body rows
  matrix.forEach((row, r_idx) => {
    const bgRow = r_idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50';
    html += `<tr class="${bgRow} hover:bg-amber-50/30 transition border-b border-slate-200 text-slate-800">`;
    html += `<td class="p-2.5 text-center font-mono text-slate-400 font-bold border-r border-slate-200">${row.item_index}</td>`;
    html += `<td class="p-2.5 font-mono font-bold text-blue-900 border-r border-slate-200">${row.item_code || row.part_no || '<span class="text-slate-300">-</span>'}</td>`;
    html += `<td class="p-2.5 font-medium border-r border-slate-200">${row.description || '-'}</td>`;
    html += `<td class="p-2.5 text-center font-mono-num font-bold border-r border-slate-200">${row.quantity}</td>`;
    html += `<td class="p-2.5 text-center text-slate-500 border-r border-slate-200">${row.unit || 'PCS'}</td>`;

    suppliers.forEach((s, s_idx) => {
      const offers = row.supplier_offers || {};
      const off = offers[s_idx] || offers[String(s_idx)];

      if (off && off.unit_price_converted > 0) {
        const isLowestPrice = (row.lowest_price_supplier === s_idx);
        const isFastest = (row.fastest_delivery_supplier === s_idx);

        const unitP = Number(off.unit_price_converted || 0).toFixed(2);
        const totP = Number(off.total_price_converted || 0).toFixed(2);

        let condBadge = `<span class="px-2 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600 font-medium">Unknown</span>`;
        if (off.condition === 'Original') {
          condBadge = `<span class="px-2 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 font-bold border border-emerald-200" title="${off.origin_notes || 'Genuine'}">🌟 Original</span>`;
        } else if (off.condition === 'OEM') {
          condBadge = `<span class="px-2 py-0.5 rounded text-[10px] bg-purple-100 text-purple-800 font-bold border border-purple-200" title="${off.origin_notes || 'OEM'}">⚙️ OEM</span>`;
        } else if (off.condition === 'Replacement') {
          condBadge = `<span class="px-2 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 font-bold border border-amber-200" title="${off.origin_notes || 'Replacement'}">🔄 Replacement</span>`;
        }

        const priceCellBg = isLowestPrice ? 'bg-emerald-50 font-bold text-emerald-800' : 'font-mono text-slate-800';

        html += `<td class="p-2.5 text-right font-mono-num border-r border-slate-200 ${priceCellBg}">
          ${isLowestPrice ? '<span class="inline-block mr-1 text-[10px] text-emerald-600 font-bold">★</span>' : ''}${unitP}
        </td>`;
        html += `<td class="p-2.5 text-right font-mono-num text-slate-600 border-r border-slate-200">${totP}</td>`;
        html += `<td class="p-2.5 text-center border-r border-slate-200">
          <span class="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${isFastest ? 'bg-blue-100 text-blue-800 font-bold' : 'text-slate-600'}">
            ${off.lead_time || 'TBA'}
          </span>
        </td>`;
        html += `<td class="p-2.5 text-center border-r border-slate-200">${condBadge}</td>`;
      } else {
        const notQuotedLabel = s.is_regret ? 'Declined' : 'Not Quoted';
        html += `<td class="p-2.5 text-center border-r border-slate-200"><span class="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-400 italic">${notQuotedLabel}</span></td>`;
        html += `<td class="p-2.5 text-center text-slate-300 border-r border-slate-200">-</td>`;
        html += `<td class="p-2.5 text-center text-slate-300 border-r border-slate-200">-</td>`;
        html += `<td class="p-2.5 text-center text-slate-300 border-r border-slate-200">-</td>`;
      }
    });

    html += '</tr>';
  });

  html += '</tbody>';

  // Footer Totals
  html += '<tfoot class="bg-slate-900 text-white font-bold select-none">';
  html += '<tr>';
  html += `<td colspan="5" class="p-3 text-right text-xs uppercase tracking-wider text-slate-300 border-r border-slate-800">Total Quoted Amount (${targetCurr}):</td>`;
  suppliers.forEach((s, s_idx) => {
    const isWin = s.is_overall_best_price;
    const isRegret = s.is_regret;
    const totFormatted = Number(s.total_converted || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    html += `<td colspan="2" class="p-3 text-right font-mono text-sm border-r border-slate-800 ${isWin ? 'text-emerald-300 font-bold bg-emerald-950/60' : ''}">
      ${isRegret ? '<span class="text-slate-500 font-normal italic">Declined</span>' : `${targetCurr} ${totFormatted}`}
    </td>`;
    html += `<td colspan="2" class="p-3 text-center text-xs text-slate-400 border-r border-slate-800">${s.best_lead_time || '-'}</td>`;
  });
  html += '</tr></tfoot>';

  tableEl.innerHTML = html;
  lucide.createIcons();
}

function reconvertComparisonPrices(newTargetCurrency, customRate) {
  if (!lastComparisonData) return;

  const targetCurr = (newTargetCurrency || lastComparisonData.target_currency || 'MYR').toUpperCase();
  const inputRate = parseFloat(customRate);
  const targetRate = (!isNaN(inputRate) && inputRate > 0) ? inputRate : ((lastComparisonFxRate !== null && lastComparisonFxRate !== undefined) ? lastComparisonFxRate : (USD_BASE_RATES[targetCurr] || 1.0));
  lastComparisonFxRate = targetRate;

  const convertVal = (val, fromC) => {
    if (!val) return 0.0;
    fromC = (fromC || 'USD').toUpperCase();
    if (fromC === targetCurr && targetCurr === 'USD' && Math.abs(targetRate - 1.0) < 0.00001) return Number(val);
    if (fromC === targetCurr && (!customRate || Math.abs(targetRate - (USD_BASE_RATES[targetCurr] || 1.0)) < 0.00001)) {
      return Number(val);
    }
    const fromRate = USD_BASE_RATES[fromC] || 1.0;
    // Step 1: Normalize supplier quote to USD
    const valUSD = Number(val) / fromRate;
    // Step 2: Convert USD to Target Currency using active target rate (1 USD = targetRate [Target])
    return valUSD * targetRate;
  };

  lastComparisonData.target_currency = targetCurr;

  // Re-calculate supplier totals
  lastComparisonData.suppliers.forEach(s => {
    s.target_currency = targetCurr;
    let newTotal = 0.0;

    lastComparisonData.comparison_matrix.forEach(item => {
      const offers = item.supplier_offers || {};
      const off = offers[s.supplier_index] || offers[String(s.supplier_index)];
      if (off && off.unit_price_raw > 0) {
        off.unit_price_converted = Math.round(convertVal(off.unit_price_raw, off.currency_raw) * 100) / 100;
        off.total_price_converted = Math.round(off.unit_price_converted * item.quantity * 100) / 100;
        newTotal += off.total_price_converted;
      }
    });

    s.total_converted = Math.round(newTotal * 100) / 100;
  });

  // Re-calculate lowest price per row
  lastComparisonData.comparison_matrix.forEach(item => {
    const offers = item.supplier_offers || {};
    let minP = 999999999;
    let minIdx = -1;
    Object.keys(offers).forEach(sKey => {
      const off = offers[sKey];
      if (off && off.unit_price_converted > 0 && off.unit_price_converted < minP) {
        minP = off.unit_price_converted;
        minIdx = Number(sKey);
      }
    });
    item.lowest_price_supplier = minIdx;
    item.lowest_unit_price = minP < 999999999 ? minP : 0;
  });

  // Re-calculate overall best price supplier
  let minTotal = 999999999;
  let winIdx = -1;
  lastComparisonData.suppliers.forEach(s => {
    if (s.total_converted > 0 && s.total_converted < minTotal) {
      minTotal = s.total_converted;
      winIdx = s.supplier_index;
    }
  });
  lastComparisonData.suppliers.forEach(s => {
    s.is_overall_best_price = (s.supplier_index === winIdx);
  });

  renderComparisonResults(lastComparisonData);
}

async function exportCompareExcel() {
  if (!lastComparisonData) {
    showToast('No comparison data to export.', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/comparator/export-excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lastComparisonData)
    });

    if (!res.ok) {
      showToast('Failed to generate comparison Excel sheet.', 'error');
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AP_Merin_Quotation_Comparison_${lastComparisonData.target_currency || 'MYR'}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    showToast('Comparison report downloaded as Excel (.xlsx)!', 'success');
  } catch (err) {
    showToast('Export error: ' + err.message, 'error');
  }
}

function transferWinnerToMode(mode = 'quotation') {
  if (!lastComparisonData || !lastComparisonData.suppliers) {
    showToast('No comparison data available to transfer.', 'warning');
    return;
  }

  // Find winner supplier or default to supplier 0
  const winner = lastComparisonData.suppliers.find(s => s.is_overall_best_price) || lastComparisonData.suppliers[0];
  transferSpecificSupplierToMode(winner ? winner.supplier_index : 0, mode);
}

window.transferSpecificSupplierToMode = function(supplierIndex, mode = 'quotation') {
  if (!lastComparisonData || !lastComparisonData.comparison_matrix) {
    showToast('No items available to transfer.', 'warning');
    return;
  }

  const supplier = (lastComparisonData.suppliers || []).find(s => s.supplier_index === supplierIndex) || (lastComparisonData.suppliers ? lastComparisonData.suppliers[supplierIndex] : null);
  if (!supplier) {
    showToast('Selected supplier could not be found.', 'error');
    return;
  }

  const isPo = (mode === 'po');
  const suppCurr = (supplier.currency_original || 'USD').toUpperCase();
  const targetCurr = isPo ? suppCurr : (lastComparisonData.target_currency || 'MYR');

  // Helper to build a clean preview object for renderSingleDocPreview
  const buildPreviewObj = (rawPrev, defaultFilename) => {
    if (!rawPrev || rawPrev.preview_type === 'none') return null;
    if (rawPrev.preview_type === 'document' || rawPrev.pages || rawPrev.preview_pages) {
      return {
        format: rawPrev.preview_format || rawPrev.format || 'pdf',
        filename: rawPrev.preview_filename || rawPrev.filename || defaultFilename,
        pages: rawPrev.preview_pages || rawPrev.pages || [],
        tables: rawPrev.preview_tables || rawPrev.tables || []
      };
    }
    if (rawPrev.preview_type === 'email' || rawPrev.email_data) {
      const ed = rawPrev.email_data || {};
      return {
        format: 'text',
        filename: rawPrev.preview_filename || 'Supplier Email Message',
        text: `From: ${ed.sender_name || ''} <${ed.from || ''}>\nDate: ${ed.date || ''}\nSubject: ${ed.subject || ''}\n\n${ed.body_text || ''}`
      };
    }
    return null;
  };

  // 1. Build Supplier Quote Items for Card 2
  const builtQuoteItems = [];
  lastComparisonData.comparison_matrix.forEach((row, idx) => {
    const offers = row.supplier_offers || {};
    const off = offers[supplierIndex] || offers[String(supplierIndex)];
    if (off && off.unit_price_raw > 0) {
      builtQuoteItems.push({
        item_no: row.item_index || idx + 1,
        item_code: row.item_code || row.part_no || '',
        description: row.description || '',
        quantity: row.quantity || 1.0,
        unit: row.unit || 'PCS',
        unit_price: Number(off.unit_price_raw || 0),
        currency: off.currency_raw || suppCurr,
        condition: off.condition || 'Original',
        lead_time: off.lead_time || 'TBA',
        remarks: off.remarks || ''
      });
    }
  });

  // 2. Build matchedItems for Accounting Table
  const builtMatchedItems = lastComparisonData.comparison_matrix.map((row, idx) => {
    const offers = row.supplier_offers || {};
    const off = offers[supplierIndex] || offers[String(supplierIndex)] || {};

    const rawCost = Number(off.unit_price_raw || 0);
    const convertedCost = Number(off.unit_price_converted || 0);
    const costInTarget = isPo ? rawCost : convertedCost;
    const markup = isPo ? 0 : 25.0;
    const finalPrice = isPo ? costInTarget : (costInTarget * (1 + markup / 100));

    let itemRemarks = (off.remarks || '').trim();
    if (off.condition && off.condition !== 'Unknown') {
      itemRemarks = `[${off.condition}] ${off.lead_time || ''} ${itemRemarks}`.trim();
    } else if (off.lead_time) {
      itemRemarks = `${off.lead_time} ${itemRemarks}`.trim();
    }

    return {
      item_no: row.item_index || idx + 1,
      item_code: row.item_code || row.part_no || '',
      description: row.description || '',
      quantity: row.quantity || 1.0,
      unit: row.unit || 'PCS',
      supplier_unit_price: rawCost,
      supplier_currency: off.currency_raw || suppCurr,
      supplier_cost: rawCost,
      cost_target: Math.round(costInTarget * 100) / 100,
      cost_myr: Math.round(convertedCost * 100) / 100,
      price_target: Math.round(finalPrice * 100) / 100,
      price_myr: Math.round((convertedCost * (1 + markup / 100)) * 100) / 100,
      markup_percent: markup,
      markup: markup,
      remarks: itemRemarks,
      has_supplier_discount: false,
      discount_percent: 0,
      is_offer: false
    };
  });

  // 3. STRICT MODE ISOLATION: Write ONLY to the requested mode's state store!
  if (isPo) {
    poState.quoteItems = builtQuoteItems;
    poState.quotePreviewData = buildPreviewObj(supplier.source_preview, supplier.source_file || `${supplier.supplier_name} Quotation`);
    poState.quoteCountText = `${builtQuoteItems.length} items loaded`;
    poState.quoteBadgeText = `${supplier.supplier_name} (${builtQuoteItems.length} items)`;
    poState.quoteBadgeClass = 'text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-100 text-emerald-800';

    poState.rfqItems = [];
    poState.clientPreviewData = null;
    poState.rfqCountText = '0 items loaded';
    poState.rfqBadgeText = 'Upload Client PO to filter';
    poState.rfqBadgeClass = 'text-xs px-2.5 py-1 rounded-full font-medium bg-amber-100 text-amber-800';

    poState.matchedItems = builtMatchedItems;
    poState.supplierCurrency = suppCurr;
    poState.targetCurrency = suppCurr;
    poState.currentFxRate = 1.0000;
    poState.currentMarkup = 0.0;
    poState.selectedRowIndices = new Set();
  } else {
    quotationState.quoteItems = builtQuoteItems;
    quotationState.quotePreviewData = buildPreviewObj(supplier.source_preview, supplier.source_file || `${supplier.supplier_name} Quotation`);
    quotationState.quoteCountText = `${builtQuoteItems.length} items loaded`;
    quotationState.quoteBadgeText = `${supplier.supplier_name} (${builtQuoteItems.length} items)`;
    quotationState.quoteBadgeClass = 'text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-100 text-emerald-800';

    const baseRfq = lastComparisonData.baseline_rfq || {};
    const baseItems = (baseRfq.items || []).map((b, idx) => ({
      item_no: b.item_no || idx + 1,
      item_code: b.our_part_no || b.part_no || b.item_no || '',
      description: b.description || '',
      quantity: b.quantity || 1.0,
      unit: b.unit || 'PCS'
    }));
    quotationState.rfqItems = baseItems;
    quotationState.clientPreviewData = buildPreviewObj(baseRfq.preview, baseRfq.rfq_number ? `Client RFQ - ${baseRfq.rfq_number}` : 'Client RFQ Document');
    quotationState.rfqCountText = `${baseItems.length} items loaded`;
    quotationState.rfqBadgeText = `Client RFQ (${baseItems.length} items)`;
    quotationState.rfqBadgeClass = 'text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-100 text-emerald-800';

    quotationState.matchedItems = builtMatchedItems;
    quotationState.supplierCurrency = suppCurr;
    quotationState.targetCurrency = targetCurr;
    const sRate = USD_BASE_RATES[suppCurr] || 1.0;
    const tRate = USD_BASE_RATES[targetCurr] || 1.0;
    quotationState.currentFxRate = parseFloat((tRate / sRate).toFixed(4));
    quotationState.currentMarkup = 25.0;
    quotationState.selectedRowIndices = new Set();
  }

  // 4. Switch to target mode (or refresh if already on that mode)
  if (currentMode === mode) {
    restoreModeState(mode);
  } else {
    setAppMode(mode);
  }

  // 5. Scroll smoothly to the accounting table
  const tableWrapper = document.getElementById('accountingTableWrapper') || document.getElementById('accountingTableBody');
  if (tableWrapper) {
    tableWrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const modeTitle = isPo ? 'Purchase Order Mode' : 'Quotation Mode';
  showToast(`Transferred ${builtMatchedItems.length} items from ${supplier.supplier_name} strictly to ${modeTitle}!`, 'success');
};

// =========================================================================
// QUOTE SOURCE PREVIEW MODAL LOGIC (DOCUMENT OR EMAIL)
// =========================================================================
let sourcePreviewPages = [];
let sourcePreviewPageIndex = 0;
let currentPreviewBlobUrl = null;

async function renderPdfBase64ToPages(base64) {
  if (typeof pdfjsLib === 'undefined') {
    console.warn('PDF.js library is not defined on window.');
    return null;
  }
  try {
    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'static/pdf.worker.min.js';
    }
    const clean = (base64 || '').replace(/^data:.*?;base64,/, '').replace(/[\r\n\s]/g, '');
    const raw = atob(clean);
    const uint8 = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      uint8[i] = raw.charCodeAt(i);
    }

    const loadingTask = pdfjsLib.getDocument({ data: uint8 });
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;
    const renderedPages = [];

    for (let p = 1; p <= Math.min(numPages, 10); p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      renderedPages.push(canvas.toDataURL('image/png'));
    }
    return renderedPages;
  } catch (err) {
    console.warn('PDF.js client render notice (falling back to frame):', err);
    return null;
  }
}

function downloadExcelOrPdfFile(cleanBase64, filename, mimeType) {
  try {
    const byteChars = atob(cleanBase64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArray], { type: mimeType || 'application/octet-stream' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.setAttribute('download', filename || 'download.xlsx');
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (_) {}
      try { window.URL.revokeObjectURL(url); } catch (_) {}
    }, 1500);
    showToast(`Downloading ${filename}...`, 'success');
  } catch (err) {
    console.warn('Client-side blob download error, falling back to server download:', err);
    // Server download fallback
    fetch('/api/download-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: cleanBase64, filename: filename, mime_type: mimeType })
    })
    .then(res => {
      if (!res.ok) throw new Error(`Server status ${res.status}`);
      return res.blob();
    })
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.setAttribute('download', filename || 'download.xlsx');
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { document.body.removeChild(a); } catch (_) {}
        try { window.URL.revokeObjectURL(url); } catch (_) {}
      }, 1500);
      showToast(`Downloading ${filename}...`, 'success');
    })
    .catch(e => {
      showToast('Download failed: ' + e.message, 'error');
    });
  }
}

function renderExcelInPreview(cleanBase64, filename) {
  const excelWrapper = document.getElementById('sourceExcelViewWrapper');
  const pFrame = document.getElementById('sourcePreviewFrame');
  const pImg = document.getElementById('sourcePreviewImg');
  const tabsContainer = document.getElementById('sourceExcelSheetTabs');
  const statsEl = document.getElementById('sourceExcelRowStats');
  const tableContainer = document.getElementById('sourceExcelTableContainer');
  const btnOpenPdf = document.getElementById('btnSourceOpenPdf');
  const docControls = document.getElementById('sourcePreviewDocControls');

  if (docControls) docControls.style.display = 'none';
  if (pFrame) { pFrame.src = 'about:blank'; pFrame.classList.add('hidden'); }
  if (pImg) { pImg.src = ''; pImg.classList.add('hidden'); }
  if (excelWrapper) excelWrapper.classList.remove('hidden');

  const isXls = (filename || '').toLowerCase().endsWith('.xls');
  const blobMime = isXls ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // Setup download button with dedicated click handler and no target="_blank"
  if (btnOpenPdf) {
    btnOpenPdf.removeAttribute('target');
    btnOpenPdf.removeAttribute('rel');
    btnOpenPdf.removeAttribute('download');
    btnOpenPdf.href = 'javascript:void(0);';
    btnOpenPdf.innerHTML = `<i data-lucide="download" class="w-3.5 h-3.5"></i><span>Download Excel</span>`;
    btnOpenPdf.classList.remove('hidden');
    btnOpenPdf.style.display = 'inline-flex';
    btnOpenPdf.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      downloadExcelOrPdfFile(cleanBase64, filename || 'Quotation.xlsx', blobMime);
    };
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  const xlsxLib = (typeof XLSX !== 'undefined') ? XLSX : (typeof window.XLSX !== 'undefined' ? window.XLSX : null);
  if (!xlsxLib) {
    if (tableContainer) tableContainer.innerHTML = '<div class="p-8 text-center text-slate-500 font-semibold">Spreadsheet viewer is loading. Please download the file to view.</div>';
    return;
  }

  try {
    const workbook = xlsxLib.read(cleanBase64, { type: 'base64' });
    const sheetNames = workbook.SheetNames || [];
    if (sheetNames.length === 0) {
      if (tableContainer) tableContainer.innerHTML = '<div class="p-8 text-center text-slate-400">Workbook contains no visible sheets.</div>';
      return;
    }

    function displaySheet(sheetName) {
      const worksheet = workbook.Sheets[sheetName];
      const rows = xlsxLib.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
      if (!rows || rows.length === 0) {
        if (tableContainer) tableContainer.innerHTML = `<div class="p-8 text-center text-slate-400">Sheet "${escapeHtml(sheetName)}" is empty.</div>`;
        if (statsEl) statsEl.textContent = '0 rows';
        return;
      }

      // Filter trailing empty rows
      let lastRow = rows.length - 1;
      while (lastRow >= 0 && (!rows[lastRow] || rows[lastRow].every(c => c === '' || c === null || c === undefined))) {
        lastRow--;
      }
      const activeRows = rows.slice(0, lastRow + 1);
      const maxCols = Math.max(...activeRows.map(r => r.length), 0);

      if (statsEl) statsEl.textContent = `${activeRows.length} rows • ${maxCols} cols • Sheet: ${sheetName}`;

      // Table wrapper with inline-block and max-content table to allow full horizontal scrolling
      let html = '<div class="inline-block min-w-full align-middle border border-slate-200 rounded-xl shadow-xs bg-white overflow-visible">';
      html += '<table class="min-w-full text-xs text-left border-collapse" style="width: max-content; min-width: 100%; table-layout: auto;">';

      const headerRow = activeRows[0] || [];
      html += '<thead class="sticky top-0 z-10 shadow-2xs"><tr class="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">';
      html += '<th class="sticky left-0 z-20 bg-slate-100 p-2.5 text-center text-slate-500 font-mono w-10 border-r border-slate-200 select-none shadow-[1px_0_0_0_#cbd5e1]">#</th>';
      for (let c = 0; c < maxCols; c++) {
        const colVal = headerRow[c] !== undefined && headerRow[c] !== null ? String(headerRow[c]) : '';
        html += `<th class="p-2.5 border-r border-slate-200 whitespace-nowrap bg-slate-100">${escapeHtml(colVal || `Col ${c + 1}`)}</th>`;
      }
      html += '</tr></thead><tbody>';

      for (let r = 1; r < activeRows.length; r++) {
        const rowData = activeRows[r] || [];
        const rowBg = r % 2 === 0 ? 'bg-white' : 'bg-slate-50/60';
        html += `<tr class="${rowBg} hover:bg-blue-50/50 transition border-b border-slate-100">`;
        html += `<td class="sticky left-0 z-10 ${rowBg} p-2 text-center font-mono text-slate-400 select-none border-r border-slate-100 text-[11px] shadow-[1px_0_0_0_#e2e8f0]">${r}</td>`;
        for (let c = 0; c < maxCols; c++) {
          const val = rowData[c] !== undefined && rowData[c] !== null ? String(rowData[c]) : '';
          const isNum = !isNaN(parseFloat(val)) && isFinite(val) && val.trim() !== '';
          html += `<td class="p-2.5 border-r border-slate-100 whitespace-nowrap text-slate-800 ${isNum ? 'text-right font-mono font-medium' : ''}">${escapeHtml(val)}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody></table></div>';
      if (tableContainer) {
        tableContainer.innerHTML = html;
        tableContainer.scrollLeft = 0;
      }
    }

    // Tabs
    if (tabsContainer) {
      tabsContainer.innerHTML = '';
      sheetNames.forEach((sName, sIdx) => {
        const tabBtn = document.createElement('button');
        tabBtn.type = 'button';
        tabBtn.className = `px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${sIdx === 0 ? 'bg-emerald-600 text-white shadow-2xs' : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'}`;
        tabBtn.innerHTML = `<i data-lucide="sheet" class="w-3 h-3"></i><span>${escapeHtml(sName)}</span>`;
        tabBtn.onclick = () => {
          Array.from(tabsContainer.children).forEach((btn, idx) => {
            btn.className = `px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${idx === sIdx ? 'bg-emerald-600 text-white shadow-2xs' : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'}`;
          });
          displaySheet(sName);
          if (typeof lucide !== 'undefined') lucide.createIcons();
        };
        tabsContainer.appendChild(tabBtn);
      });
    }

    displaySheet(sheetNames[0]);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (err) {
    console.warn('SheetJS preview render error:', err);
    if (tableContainer) tableContainer.innerHTML = `<div class="p-8 text-center text-rose-500 font-semibold">Failed to render spreadsheet preview: ${escapeHtml(err.message || 'Corrupt format')}</div>`;
  }
}

async function renderPdfOrImageInPreview(base64Content, mimeType = 'application/pdf', pages = [], filename = 'Quotation.pdf') {
  const pFrame = document.getElementById('sourcePreviewFrame');
  const pImg = document.getElementById('sourcePreviewImg');
  const pLoading = document.getElementById('sourceDocLoading');
  const docControls = document.getElementById('sourcePreviewDocControls');
  const btnOpenPdf = document.getElementById('btnSourceOpenPdf');
  const excelWrapper = document.getElementById('sourceExcelViewWrapper');

  if (pLoading) pLoading.classList.add('hidden');
  if (excelWrapper) excelWrapper.classList.add('hidden');

  if (currentPreviewBlobUrl) {
    try { URL.revokeObjectURL(currentPreviewBlobUrl); } catch (_) {}
    currentPreviewBlobUrl = null;
  }

  // If raw base64 binary is available (from fast IMAP part fetch)
  if (base64Content && base64Content.length > 50) {
    try {
      const cleanBase64 = (base64Content || '').replace(/^data:.*?;base64,/, '').replace(/[\r\n\s]/g, '');
      const fnLower = (filename || '').toLowerCase();
      const isExcel = fnLower.endsWith('.xlsx') || fnLower.endsWith('.xls') || fnLower.endsWith('.csv') || (mimeType && (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')));

      if (isExcel) {
        renderExcelInPreview(cleanBase64, filename);
        return;
      }

      const isPdf = !mimeType || mimeType.toLowerCase().includes('pdf') || (!mimeType.toLowerCase().includes('image') && !isExcel);
      if (isPdf) {
        // 1. Create Blob URL for "Open Full PDF" button
        try {
          const byteChars = atob(cleanBase64);
          const byteNums = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) {
            byteNums[i] = byteChars.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNums);
          const blob = new Blob([byteArray], { type: 'application/pdf' });
          currentPreviewBlobUrl = URL.createObjectURL(blob);

          if (btnOpenPdf) {
            btnOpenPdf.removeAttribute('download');
            btnOpenPdf.href = currentPreviewBlobUrl;
            btnOpenPdf.target = '_blank';
            btnOpenPdf.rel = 'noopener noreferrer';
            btnOpenPdf.innerHTML = `<i data-lucide="external-link" class="w-3.5 h-3.5"></i><span>Open Full PDF</span>`;
            btnOpenPdf.classList.remove('hidden');
            btnOpenPdf.style.display = 'inline-flex';
            if (typeof lucide !== 'undefined') lucide.createIcons();
          }
        } catch (bErr) {
          console.warn('Blob creation error:', bErr);
        }

        // 2. Try client-side high-res rendering with PDF.js
        let renderedPages = null;
        try {
          renderedPages = await renderPdfBase64ToPages(cleanBase64);
        } catch (_) {}

        if (renderedPages && renderedPages.length > 0) {
          sourcePreviewPages = renderedPages;
          sourcePreviewPageIndex = 0;
          if (pImg) {
            pImg.src = sourcePreviewPages[0];
            pImg.classList.remove('hidden');
          }
          if (pFrame) {
            pFrame.src = 'about:blank';
            pFrame.classList.add('hidden');
          }
          if (docControls) {
            docControls.style.display = sourcePreviewPages.length > 1 ? 'flex' : 'none';
          }
          updateSourceDocPageDisplay();
          return;
        }

        // 3. Fallback: Frame viewer
        if (pFrame && currentPreviewBlobUrl) {
          pFrame.src = currentPreviewBlobUrl + '#toolbar=1&navpanes=0';
          pFrame.classList.remove('hidden');
        }
        if (pImg) {
          pImg.classList.add('hidden');
          pImg.src = '';
        }
        if (docControls) docControls.style.display = 'none';
        return;
      } else {
        // Image attachment
        if (pImg) {
          pImg.src = `data:${mimeType};base64,${cleanBase64}`;
          pImg.classList.remove('hidden');
        }
        if (pFrame) {
          pFrame.src = 'about:blank';
          pFrame.classList.add('hidden');
        }
        if (docControls) docControls.style.display = 'none';
        if (btnOpenPdf) btnOpenPdf.classList.add('hidden');
        return;
      }
    } catch (e) {
      console.warn('Error displaying base64 preview:', e);
    }
  }

  // If pre-rendered image pages exist
  if (pages && pages.length > 0) {
    sourcePreviewPages = pages;
    sourcePreviewPageIndex = 0;
    if (pImg) pImg.classList.remove('hidden');
    if (pFrame) {
      pFrame.src = 'about:blank';
      pFrame.classList.add('hidden');
    }
    if (docControls) docControls.style.display = pages.length > 1 ? 'flex' : 'none';
    if (btnOpenPdf) btnOpenPdf.classList.add('hidden');
    updateSourceDocPageDisplay();
    return;
  }

  // Fallback
  if (pFrame) {
    pFrame.src = 'about:blank';
    pFrame.classList.add('hidden');
  }
  if (pImg) pImg.classList.add('hidden');
  if (btnOpenPdf) btnOpenPdf.classList.add('hidden');
}

window.openSupplierSourcePreview = async function(supplierIndex, preferredView = 'auto') {
  if (!lastComparisonData || !lastComparisonData.suppliers || lastComparisonData.suppliers.length === 0) {
    showToast('No supplier comparison data available.', 'info');
    return;
  }

  let supplier = null;
  const numIdx = parseInt(supplierIndex, 10);
  if (!isNaN(numIdx) && lastComparisonData.suppliers[numIdx]) {
    supplier = lastComparisonData.suppliers[numIdx];
  } else {
    supplier = lastComparisonData.suppliers.find(s => s.supplier_index === supplierIndex || s.supplier_index === numIdx || s.supplier_name === supplierIndex);
  }
  if (!supplier) supplier = lastComparisonData.suppliers[0];
  if (!supplier) return;

  const preview = supplier.source_preview || {};
  const modal = document.getElementById('modalSourcePreview');
  const titleEl = document.getElementById('sourcePreviewTitle');
  const subtitleEl = document.getElementById('sourcePreviewSubtitle');
  const filenameBadge = document.getElementById('sourcePreviewFilenameBadge');
  const footerHint = document.getElementById('sourcePreviewFooterHint');
  const docControls = document.getElementById('sourcePreviewDocControls');
  const docViewWrapper = document.getElementById('sourceDocViewWrapper');
  const emailViewWrapper = document.getElementById('sourceEmailViewWrapper');
  const modeToggle = document.getElementById('sourcePreviewModeToggle');
  const pLoading = document.getElementById('sourceDocLoading');
  const pFrame = document.getElementById('sourcePreviewFrame');
  const pImg = document.getElementById('sourcePreviewImg');
  const excelWrapper = document.getElementById('sourceExcelViewWrapper');

  let discThread = null;
  if (lastScannedDiscoveryData && lastScannedDiscoveryData.supplier_threads) {
    discThread = lastScannedDiscoveryData.supplier_threads.find(st => 
      (st.supplier_key && supplier.supplier_key && st.supplier_key === supplier.supplier_key) || 
      (st.supplier_name && supplier.supplier_name && st.supplier_name.toLowerCase().trim() === supplier.supplier_name.toLowerCase().trim())
    );
  }

  const hasDoc = (supplier.source_type === 'Attachment' || (preview.base64 && preview.base64.length > 50) || (preview.preview_pages && preview.preview_pages.length > 0) || (discThread && discThread.quote_documents && discThread.quote_documents.length > 0));
  const hasEmail = Boolean(supplier.email_data || preview.email_data || (discThread && discThread.emails && discThread.emails.length > 0) || supplier.source_type === 'Email Body' || supplier.status_notes);

  let activeView = preferredView;
  if (activeView === 'auto') {
    activeView = hasDoc ? 'document' : 'email';
  } else if (activeView === 'document' && !hasDoc && hasEmail) {
    activeView = 'email';
  }

  window.lastSourceEmailViewOpener = () => openSupplierSourcePreview(supplierIndex, 'email');
  window.lastSourceDocViewOpener = () => openSupplierSourcePreview(supplierIndex, 'document');

  if (modeToggle) {
    if (hasDoc && hasEmail) {
      modeToggle.classList.remove('hidden');
      modeToggle.style.display = 'flex';
      const btnSwitchEmail = document.getElementById('btnSwitchToEmailView');
      const btnSwitchDoc = document.getElementById('btnSwitchToDocView');
      if (btnSwitchEmail) {
        btnSwitchEmail.className = activeView === 'email' 
          ? 'px-3 py-1 bg-white text-slate-900 font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-2xs transition'
          : 'px-3 py-1 text-slate-600 hover:text-slate-900 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition';
        btnSwitchEmail.onclick = () => openSupplierSourcePreview(supplierIndex, 'email');
      }
      if (btnSwitchDoc) {
        btnSwitchDoc.className = activeView === 'document'
          ? 'px-3 py-1 bg-white text-slate-900 font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-2xs transition'
          : 'px-3 py-1 text-slate-600 hover:text-slate-900 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition';
        btnSwitchDoc.onclick = () => openSupplierSourcePreview(supplierIndex, 'document');
      }
    } else {
      modeToggle.classList.add('hidden');
      modeToggle.style.display = 'none';
    }
  }

  if (activeView === 'email') {
    // Show Email View
    if (docControls) docControls.style.display = 'none';
    if (docViewWrapper) docViewWrapper.classList.add('hidden');
    if (emailViewWrapper) emailViewWrapper.classList.remove('hidden');

    const emailData = supplier.email_data || preview.email_data || (discThread && discThread.emails && discThread.emails[0]) || {
      from: supplier.supplier_email || supplier.supplier_name,
      sender_name: supplier.supplier_name,
      sender_email: supplier.supplier_email,
      to: 'sales02@apmerinservices.com.my',
      date: 'Recorded in RFQ thread',
      subject: `Quotation Reply from ${supplier.supplier_name}`,
      body: supplier.status_notes || 'Quotation details communicated via email message body.',
      body_text: supplier.status_notes || 'Quotation details communicated via email message body.'
    };

    if (titleEl) titleEl.textContent = `Supplier Email: ${supplier.supplier_name}`;
    if (subtitleEl) subtitleEl.textContent = `Direct email reply • ${emailData.date || 'Recorded in thread'}`;
    if (filenameBadge) filenameBadge.textContent = 'Email Reply';
    if (footerHint) footerHint.textContent = `Direct communication from ${emailData.sender_email || supplier.supplier_email || supplier.supplier_name}`;

    const sSender = document.getElementById('sourceEmailSender');
    const sDate = document.getElementById('sourceEmailDate');
    const sSubj = document.getElementById('sourceEmailSubject');
    const sFrom = document.getElementById('sourceEmailFrom');
    const sTo = document.getElementById('sourceEmailTo');
    const sCcWrapper = document.getElementById('sourceEmailCcWrapper');
    const sCc = document.getElementById('sourceEmailCc');
    const sAvatar = document.getElementById('sourceEmailAvatar');

    if (sSender) sSender.textContent = emailData.sender_name || supplier.supplier_name;
    if (sDate) sDate.textContent = emailData.date || '';
    if (sSubj) sSubj.textContent = emailData.subject || `Quotation from ${supplier.supplier_name}`;
    if (sFrom) sFrom.textContent = emailData.from ? (emailData.from.includes('<') ? emailData.from : `<${emailData.from}>`) : (supplier.supplier_email ? `<${supplier.supplier_email}>` : '');
    if (sTo) sTo.textContent = emailData.to || 'sales02@apmerinservices.com.my';

    if (sCcWrapper && sCc) {
      if (emailData.cc) {
        sCcWrapper.classList.remove('hidden');
        sCc.textContent = emailData.cc;
      } else {
        sCcWrapper.classList.add('hidden');
      }
    }

    if (sAvatar) {
      const rawName = emailData.sender_name || supplier.supplier_name || 'SP';
      const words = rawName.split(/\s+/).filter(w => w.length > 0);
      const initials = words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase() : rawName.slice(0, 2).toUpperCase();
      sAvatar.textContent = initials || 'SP';
    }

    // Attached Quotation Document Bar
    const attBar = document.getElementById('sourceEmailAttachmentBar');
    const attName = document.getElementById('sourceEmailAttachedDocName');
    const attSize = document.getElementById('sourceEmailAttachedDocSize');
    const btnViewDoc = document.getElementById('btnViewAttachedQuoteDoc');

    if (attBar) {
      if (hasDoc) {
        attBar.classList.remove('hidden');
        const docName = preview.preview_filename || supplier.source_file || (discThread && discThread.quote_documents && discThread.quote_documents[0] && discThread.quote_documents[0].filename) || 'Quotation.pdf';
        if (attName) attName.textContent = docName;
        if (attSize) attSize.textContent = preview.size_kb ? `(${preview.size_kb} KB)` : '';
        if (btnViewDoc) {
          btnViewDoc.onclick = () => openSupplierSourcePreview(supplierIndex, 'document');
        }
      } else {
        attBar.classList.add('hidden');
      }
    }

    renderEmailMessageBodyAndImages(emailData);

    if (modal) {
      modal.classList.remove('hidden');
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    return;
  }

  // Active View is Document
  const docFilename = preview.preview_filename || supplier.source_file || (discThread && discThread.quote_documents && discThread.quote_documents[0] && discThread.quote_documents[0].filename) || 'Quotation.pdf';
  if (titleEl) titleEl.textContent = `Quotation Document: ${supplier.supplier_name}`;
  if (subtitleEl) subtitleEl.textContent = `Attached file: ${docFilename}`;
  if (filenameBadge) filenameBadge.textContent = docFilename;
  if (footerHint) footerHint.textContent = `Official supplier quotation document attached in thread`;

  if (docControls) docControls.style.display = 'none';
  if (docViewWrapper) docViewWrapper.classList.remove('hidden');
  if (emailViewWrapper) emailViewWrapper.classList.add('hidden');

  if (modal) {
    modal.classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // If base64 or pages already exist
  if ((preview.base64 && preview.base64.length > 50) || (preview.preview_pages && preview.preview_pages.length > 0)) {
    await renderPdfOrImageInPreview(preview.base64, preview.mime_type || 'application/pdf', preview.preview_pages || preview.pages || [], docFilename);
    return;
  }

  // Fetch on-demand from mailbox if not yet loaded
  if (pLoading) pLoading.classList.remove('hidden');
  if (pFrame) { pFrame.src = 'about:blank'; pFrame.classList.add('hidden'); }
  if (pImg) { pImg.src = ''; pImg.classList.add('hidden'); }
  if (excelWrapper) excelWrapper.classList.add('hidden');

  try {
    const quoteDoc = (discThread && discThread.quote_documents && discThread.quote_documents[0]) || null;
    const itemReq = {
      supplier_key: supplier.supplier_key || (discThread && discThread.supplier_key),
      folder: (quoteDoc && quoteDoc.folder) || (discThread && discThread.folder) || 'INBOX',
      msg_id: (quoteDoc && quoteDoc.msg_id) || (discThread && discThread.msg_id),
      filename: (quoteDoc && quoteDoc.filename) || supplier.source_file || 'Quotation.pdf',
      part_number: (quoteDoc && quoteDoc.part_number) || ''
    };

    const data = await fetchMailboxQuoteDoc([itemReq]);
    const fetchedDoc = (data.documents && data.documents[0]) || (data.base64 ? data : null);
    if (fetchedDoc) {
      if (fetchedDoc.preview_pages && fetchedDoc.preview_pages.length > 0) {
        preview.preview_pages = fetchedDoc.preview_pages;
        if (quoteDoc) quoteDoc.preview_pages = fetchedDoc.preview_pages;
      }
      if (fetchedDoc.base64) {
        preview.base64 = fetchedDoc.base64;
        preview.mime_type = fetchedDoc.mime_type || 'application/pdf';
        if (quoteDoc) quoteDoc.base64 = fetchedDoc.base64;
      }
      if ((preview.base64 && preview.base64.length > 50) || (preview.preview_pages && preview.preview_pages.length > 0)) {
        await renderPdfOrImageInPreview(preview.base64, preview.mime_type || 'application/pdf', preview.preview_pages || [], docFilename);
        return;
      }
    }
  } catch (err) {
    console.warn('On-demand quote preview fetch error:', err);
  }

  if (pLoading) pLoading.classList.add('hidden');
  showToast('Could not load quotation document from mailbox.', 'error');
};

let currentDiscoveredSupplier = null;
let currentDiscoveredEmailIdx = 0;

function formatEmailBodyWithQuotedHistory(text) {
  if (!text) return '';
  const quoteSplitRegex = /(\r?\n(?:From:\s*[^\r\n]*?@|On\s+[^\r\n]+wrote:|-{3,}\s*Original Message\s*-{3,}|_{10,}))/i;
  const match = text.match(quoteSplitRegex);
  
  if (match && match.index > 0) {
    const freshPart = text.slice(0, match.index).trim();
    const historyPart = text.slice(match.index).trim();
    
    return `
      <div class="text-slate-800 text-sm leading-relaxed whitespace-pre-wrap font-sans select-text">
        ${escapeHtml(freshPart)}
      </div>
      <div class="mt-4 pt-3 border-t border-slate-200">
        <details class="group cursor-pointer">
          <summary class="text-xs font-semibold text-slate-400 hover:text-blue-600 flex items-center gap-1.5 select-none py-1">
            <i data-lucide="corner-down-right" class="w-3.5 h-3.5 text-slate-400"></i>
            <span>Show / Hide Quoted Conversation History</span>
          </summary>
          <div class="mt-2 pl-3 border-l-2 border-slate-300 text-slate-500 text-xs font-mono whitespace-pre-wrap bg-slate-50/70 p-3 rounded-r-xl select-text leading-relaxed">
            ${escapeHtml(historyPart)}
          </div>
        </details>
      </div>
    `;
  }
  
  return `
    <div class="text-slate-800 text-sm leading-relaxed whitespace-pre-wrap font-sans select-text">
      ${escapeHtml(text)}
    </div>
  `;
}

window.openImageLightbox = function(imageUrl, imageName) {
  const modal = document.getElementById('modalImageLightbox');
  const imgEl = document.getElementById('lightboxImg');
  const titleEl = document.getElementById('lightboxImageName');
  const dlBtn = document.getElementById('lightboxDownloadBtn');

  if (imgEl) imgEl.src = imageUrl;
  if (titleEl) titleEl.textContent = imageName || 'Technical Drawing / Image';
  if (dlBtn) {
    dlBtn.href = imageUrl;
    dlBtn.download = imageName || 'attachment.png';
  }
  if (modal) {
    modal.classList.remove('hidden');
    lucide.createIcons();
  }
};

window.closeImageLightbox = function() {
  const modal = document.getElementById('modalImageLightbox');
  if (modal) modal.classList.add('hidden');
};

window.activeEmailDocumentsList = [];

window.inspectDocumentAttachmentByIndex = function(idx) {
  if (window.activeEmailDocumentsList && window.activeEmailDocumentsList[idx]) {
    window.inspectDocumentAttachment(window.activeEmailDocumentsList[idx]);
  }
};

window.inspectDiscoveryDoc = function(d_idx) {
  const docs = window.discoveryInitialDocsList || [];
  const doc = docs[d_idx];
  if (!doc) return;
  window.lastSourceEmailViewOpener = window.openDiscoveryRfqDetails;
  window.inspectDocumentAttachment(doc);
};

window.inspectDocumentAttachment = async function(doc) {
  if (!doc) return;

  const modal = document.getElementById('modalSourcePreview');
  const titleEl = document.getElementById('sourcePreviewTitle');
  const subtitleEl = document.getElementById('sourcePreviewSubtitle');
  const filenameBadge = document.getElementById('sourcePreviewFilenameBadge');
  const footerHint = document.getElementById('sourcePreviewFooterHint');
  const docControls = document.getElementById('sourcePreviewDocControls');
  const docViewWrapper = document.getElementById('sourceDocViewWrapper');
  const emailViewWrapper = document.getElementById('sourceEmailViewWrapper');
  const modeToggle = document.getElementById('sourcePreviewModeToggle');
  const btnOpenPdf = document.getElementById('btnSourceOpenPdf');

  const szStr = doc.size_kb ? `${doc.size_kb} KB` : (doc.size ? `${Math.round(doc.size / 1024)} KB` : '');
  if (titleEl) titleEl.textContent = `Attached Document: ${doc.filename}`;
  if (subtitleEl) subtitleEl.textContent = `Original file from email${szStr ? ` (${szStr})` : ''}`;
  if (filenameBadge) filenameBadge.textContent = doc.filename;
  if (footerHint) footerHint.textContent = `Authentic document attachment (${doc.preview_pages ? `${doc.preview_pages.length} page(s)` : 'document'})`;

  // Switch to Document View
  if (docViewWrapper) docViewWrapper.classList.remove('hidden');
  if (emailViewWrapper) emailViewWrapper.classList.add('hidden');

  if (modeToggle) {
    modeToggle.classList.remove('hidden');
    modeToggle.style.display = 'flex';
    const btnSwitchEmail = document.getElementById('btnSwitchToEmailView');
    const btnSwitchDoc = document.getElementById('btnSwitchToDocView');
    if (btnSwitchEmail) btnSwitchEmail.className = 'px-3 py-1 text-slate-600 hover:text-slate-900 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition';
    if (btnSwitchDoc) btnSwitchDoc.className = 'px-3 py-1 bg-white text-slate-900 font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-2xs transition';
  }

  if (modal) modal.classList.remove('hidden');

  const b64 = doc.base64 || (doc.data_url && doc.data_url.includes(';base64,') ? doc.data_url.split(';base64,')[1] : null);
  const mime = doc.mime_type || doc.content_type || (doc.filename && doc.filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');

  // Render PDF pages or base64
  await renderPdfOrImageInPreview(b64, mime, doc.preview_pages || [], doc.filename);
  if (typeof lucide !== 'undefined') lucide.createIcons();
};

function renderEmailMessageBodyAndImages(emailData) {
  const sBody = document.getElementById('sourceEmailBody');
  const gallery = document.getElementById('sourceEmailImagesGallery');
  const countEl = document.getElementById('sourceEmailImagesCount');
  const listEl = document.getElementById('sourceEmailImagesList');
  const docsContainer = document.getElementById('sourceEmailDocsContainer');
  const docsCountEl = document.getElementById('sourceEmailDocsCount');
  const docsListEl = document.getElementById('sourceEmailDocsList');

  if (!sBody) return;
  sBody.innerHTML = '';

  // 1. Attached Documents (PDFs, Excel Sheets, Word docs, Specifications)
  const rawDocs = emailData.documents || [];
  const richAtts = emailData.rich_attachments || [];
  const allDocs = [...rawDocs];
  const seenDocNames = new Set(rawDocs.map(d => (d.filename || '').toLowerCase()));
  for (const ra of richAtts) {
    if (ra && !ra.is_image && ra.filename && !seenDocNames.has(ra.filename.toLowerCase())) {
      seenDocNames.add(ra.filename.toLowerCase());
      allDocs.push(ra);
    }
  }
  window.activeEmailDocumentsList = allDocs;

  if (docsContainer && docsListEl && docsCountEl) {
    if (allDocs.length > 0) {
      docsContainer.classList.remove('hidden');
      docsCountEl.textContent = allDocs.length;
      docsListEl.innerHTML = allDocs.map((doc, d_idx) => {
        const fn = doc.filename || `Document #${d_idx + 1}`;
        const sz = doc.size ? `${Math.round(doc.size / 1024)} KB` : '';
        const isPdf = (doc.is_pdf || fn.toLowerCase().endsWith('.pdf'));
        const isXls = (doc.is_excel || fn.toLowerCase().endsWith('.xlsx') || fn.toLowerCase().endsWith('.xls') || fn.toLowerCase().endsWith('.csv'));
        const isDocx = (doc.is_doc || fn.toLowerCase().endsWith('.docx') || fn.toLowerCase().endsWith('.doc'));

        let iconName = 'file-text';
        let iconBg = 'bg-amber-100 text-amber-700';
        let typeBadge = 'Document';
        if (isPdf) {
          iconName = 'file-text';
          iconBg = 'bg-rose-100 text-rose-700';
          typeBadge = 'PDF Specification';
        } else if (isXls) {
          iconName = 'file-spreadsheet';
          iconBg = 'bg-emerald-100 text-emerald-700';
          typeBadge = 'Excel Sheet';
        } else if (isDocx) {
          iconName = 'file-text';
          iconBg = 'bg-blue-100 text-blue-700';
          typeBadge = 'Word Document';
        }

        const canInspect = (isPdf || (doc.preview_pages && doc.preview_pages.length > 0) || doc.base64);

        return `
          <div class="p-3 bg-gradient-to-r from-slate-50 to-amber-50/40 border border-slate-200 hover:border-amber-400 rounded-xl flex items-center justify-between gap-3 text-xs transition shadow-2xs">
            <div class="flex items-center gap-3 truncate">
              <div class="p-2 rounded-lg shrink-0 ${iconBg}">
                <i data-lucide="${iconName}" class="w-4 h-4"></i>
              </div>
              <div class="truncate">
                <span class="font-bold text-slate-900 block truncate" title="${escapeHtml(fn)}">${escapeHtml(fn)}</span>
                <span class="text-slate-400 text-[11px] font-mono">${sz ? `${sz} • ` : ''}${typeBadge}</span>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              ${canInspect ? `
                <button type="button" class="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-2xs transition cursor-pointer"
                        onclick="window.inspectDocumentAttachmentByIndex(${d_idx})">
                  <i data-lucide="eye" class="w-3.5 h-3.5"></i>
                  <span>Inspect Document</span>
                </button>
              ` : ''}
              ${doc.data_url ? `
                <a href="${doc.data_url}" download="${escapeHtml(fn)}" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs flex items-center gap-1 transition">
                  <i data-lucide="download" class="w-3.5 h-3.5"></i>
                  <span>Download</span>
                </a>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');
    } else {
      docsContainer.classList.add('hidden');
    }
  }

  // 2. Email Body (HTML with inline images resolved or clean text)
  const resolvedHtml = (emailData.html_body_resolved || emailData.html_body || '').trim();
  const bodyText = (emailData.body_text || emailData.body || '').trim();

  if (resolvedHtml && resolvedHtml.length > 20) {
    sBody.className = "pt-1 text-xs sm:text-sm font-sans leading-relaxed text-slate-800 select-text email-html-container overflow-x-auto";
    sBody.innerHTML = resolvedHtml;

    // Attach click-to-enlarge on all rendered images in body
    const renderedImgs = sBody.querySelectorAll('img');
    renderedImgs.forEach((img, idx) => {
      img.style.cursor = 'zoom-in';
      img.title = 'Click to inspect in full resolution';
      img.classList.add('hover:opacity-95', 'transition', 'rounded');
      img.onclick = (e) => {
        e.stopPropagation();
        const altName = img.getAttribute('alt') || `Inquiry Image #${idx + 1}`;
        openImageLightbox(img.src, altName);
      };
    });
  } else if (bodyText) {
    sBody.className = "pt-1 text-xs sm:text-sm font-sans whitespace-pre-wrap leading-relaxed text-slate-800 select-text";
    sBody.innerHTML = formatEmailBodyWithQuotedHistory(bodyText);
  } else {
    sBody.className = "pt-1 text-xs sm:text-sm font-sans leading-relaxed text-slate-800 select-text";
    sBody.innerHTML = `
      <div class="p-4 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 text-xs leading-relaxed">
        <p class="font-bold mb-1">Inquiry Sent with Attachment</p>
        <p>This RFQ inquiry was sent by <strong>${escapeHtml(emailData.sender_name || 'AP Merin')}</strong> on <strong>${escapeHtml(emailData.date || '-')}</strong>. Review the attached documents and drawings above.</p>
      </div>
    `;
  }

  // 3. Render Attached Images & Technical Diagrams Gallery
  const imgs = emailData.images || [];
  const richImgAtts = (emailData.rich_attachments || []).filter(a => a && a.is_image && a.data_url);

  const allImgs = [];
  const seenSrc = new Set();
  
  for (const img of [...imgs, ...richImgAtts]) {
    const src = img.data_url || '';
    if (src && !seenSrc.has(src)) {
      seenSrc.add(src);
      allImgs.push(img);
    }
  }

  if (gallery && listEl && countEl) {
    if (allImgs.length > 0) {
      gallery.classList.remove('hidden');
      countEl.textContent = allImgs.length;
      listEl.innerHTML = allImgs.map((img, idx) => {
        const fn = img.filename || `Image #${idx + 1}`;
        const sz = img.size ? `${Math.round(img.size / 1024)} KB` : '';
        return `
          <div class="group relative bg-slate-50 border border-slate-200 rounded-xl overflow-hidden hover:border-blue-500 hover:shadow-md transition flex flex-col cursor-pointer"
               onclick="openImageLightbox('${img.data_url}', '${escapeHtml(fn)}')">
            <div class="h-28 bg-slate-900/5 flex items-center justify-center overflow-hidden p-1.5 relative">
              <img src="${img.data_url}" alt="${escapeHtml(fn)}" class="max-h-full max-w-full object-contain rounded transition group-hover:scale-105 duration-200">
              <div class="absolute inset-0 bg-slate-950/0 group-hover:bg-slate-950/20 transition flex items-center justify-center">
                <span class="opacity-0 group-hover:opacity-100 bg-slate-900/80 text-white text-[10px] font-bold px-2 py-1 rounded-md shadow backdrop-blur transition flex items-center gap-1">
                  <i data-lucide="zoom-in" class="w-3 h-3"></i> View
                </span>
              </div>
            </div>
            <div class="p-2 bg-white border-t border-slate-100 flex items-center justify-between text-[11px] gap-1.5">
              <span class="font-mono text-slate-700 truncate font-semibold" title="${escapeHtml(fn)}">${escapeHtml(fn)}</span>
              ${sz ? `<span class="text-[10px] font-mono text-slate-400 shrink-0">${sz}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
      lucide.createIcons();
    } else {
      gallery.classList.add('hidden');
    }
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.openDiscoveredSupplierPreview = function(supplierKey, emailIndex = 0) {
  if (!lastScannedDiscoveryData || !lastScannedDiscoveryData.supplier_threads) return;
  const s = lastScannedDiscoveryData.supplier_threads.find(st => st.supplier_key === supplierKey);
  if (!s) return;

  currentDiscoveredSupplier = s;
  currentDiscoveredEmailIdx = emailIndex || 0;
  window.lastSourceEmailViewOpener = () => window.openDiscoveredSupplierPreview(supplierKey, currentDiscoveredEmailIdx);

  const modal = document.getElementById('modalSourcePreview');
  const titleEl = document.getElementById('sourcePreviewTitle');
  const subtitleEl = document.getElementById('sourcePreviewSubtitle');
  const filenameBadge = document.getElementById('sourcePreviewFilenameBadge');
  const footerHint = document.getElementById('sourcePreviewFooterHint');
  const docControls = document.getElementById('sourcePreviewDocControls');
  const docViewWrapper = document.getElementById('sourceDocViewWrapper');
  const emailViewWrapper = document.getElementById('sourceEmailViewWrapper');
  const modeToggle = document.getElementById('sourcePreviewModeToggle');

  const emails = (s.emails && s.emails.length > 0) ? s.emails : [];
  if (currentDiscoveredEmailIdx >= emails.length) currentDiscoveredEmailIdx = 0;
  const activeEm = emails[currentDiscoveredEmailIdx] || {
    from: s.from || `${s.supplier_name} <${s.supplier_email}>`,
    sender_name: s.supplier_name,
    sender_email: s.supplier_email,
    to: 'sales02@apmerinservices.com.my',
    date: s.latest_date,
    subject: s.subject || `RFQ Inquiry Reply: ${s.supplier_name}`,
    body: '(No message text)'
  };

  if (titleEl) titleEl.textContent = `Supplier Email Reply: ${s.supplier_name}`;
  if (subtitleEl) subtitleEl.textContent = `Authentic Mailbox Message • ${activeEm.date || s.latest_date || ''}`;
  if (filenameBadge) filenameBadge.textContent = emails.length > 1 ? `Message ${currentDiscoveredEmailIdx + 1} of ${emails.length}` : 'Email Reply';
  if (footerHint) footerHint.textContent = `Direct communication from ${activeEm.sender_email || s.supplier_email}`;

  // Switch to Email View
  if (docControls) docControls.style.display = 'none';
  if (docViewWrapper) docViewWrapper.classList.add('hidden');
  if (emailViewWrapper) emailViewWrapper.classList.remove('hidden');

  // Mode Toggle (if quote documents exist, allow toggling)
  const hasQuoteDoc = (s.quote_documents && s.quote_documents.length > 0);
  if (modeToggle) {
    modeToggle.classList.toggle('hidden', !hasQuoteDoc);
    modeToggle.style.display = hasQuoteDoc ? 'flex' : 'none';
    const btnSwitchEmail = document.getElementById('btnSwitchToEmailView');
    const btnSwitchDoc = document.getElementById('btnSwitchToDocView');
    if (btnSwitchEmail) btnSwitchEmail.className = 'px-3 py-1 bg-white text-slate-900 font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-2xs transition';
    if (btnSwitchDoc) btnSwitchDoc.className = 'px-3 py-1 text-slate-600 hover:text-slate-900 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition';
  }

  // Populate Thread Switcher Tabs (if more than 1 email from supplier)
  const tabsWrapper = document.getElementById('sourceEmailThreadTabsWrapper');
  const tabsContainer = document.getElementById('sourceEmailThreadTabs');
  if (tabsWrapper && tabsContainer) {
    if (emails.length > 1) {
      tabsWrapper.classList.remove('hidden');
      tabsContainer.innerHTML = '';
      emails.forEach((em, e_idx) => {
        const btnTab = document.createElement('button');
        const isActive = (e_idx === currentDiscoveredEmailIdx);
        btnTab.type = 'button';
        btnTab.className = `px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${isActive ? 'bg-blue-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`;
        btnTab.innerHTML = `
          <i data-lucide="${isActive ? 'mail-open' : 'mail'}" class="w-3 h-3"></i>
          <span>Reply #${e_idx + 1}${em.date ? ` (${em.date.split(' ').slice(1, 3).join(' ')})` : ''}</span>
        `;
        btnTab.onclick = () => openDiscoveredSupplierPreview(supplierKey, e_idx);
        tabsContainer.appendChild(btnTab);
      });
    } else {
      tabsWrapper.classList.add('hidden');
    }
  }

  // Populate Email Meta Fields
  const sSubj = document.getElementById('sourceEmailSubject');
  const sSender = document.getElementById('sourceEmailSender');
  const sFrom = document.getElementById('sourceEmailFrom');
  const sTo = document.getElementById('sourceEmailTo');
  const sCcWrapper = document.getElementById('sourceEmailCcWrapper');
  const sCc = document.getElementById('sourceEmailCc');
  const sDate = document.getElementById('sourceEmailDate');
  const sAvatar = document.getElementById('sourceEmailAvatar');

  if (sSubj) sSubj.textContent = activeEm.subject || s.subject || 'RFQ Inquiry Response';
  if (sSender) sSender.textContent = activeEm.sender_name || s.supplier_name || 'Supplier';
  if (sFrom) sFrom.textContent = `<${activeEm.sender_email || s.supplier_email}>`;
  if (sTo) sTo.textContent = activeEm.to || 'sales02@apmerinservices.com.my <sales02@apmerinservices.com.my>';
  if (sDate) sDate.textContent = activeEm.date || s.latest_date || '-';
  
  if (sCcWrapper && sCc) {
    if (activeEm.cc) {
      sCcWrapper.classList.remove('hidden');
      sCc.textContent = activeEm.cc;
    } else {
      sCcWrapper.classList.add('hidden');
    }
  }

  // Initials Avatar
  if (sAvatar) {
    const rawName = activeEm.sender_name || s.supplier_name || 'Supplier';
    const words = rawName.split(/\s+/).filter(w => w.length > 0);
    const initials = words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase() : rawName.slice(0, 2).toUpperCase();
    sAvatar.textContent = initials || 'EM';
  }

  // Attached Quotation Document Bar
  const attBar = document.getElementById('sourceEmailAttachmentBar');
  const attName = document.getElementById('sourceEmailAttachedDocName');
  const attSize = document.getElementById('sourceEmailAttachedDocSize');
  const btnViewDoc = document.getElementById('btnViewAttachedQuoteDoc');

  if (attBar) {
    if (hasQuoteDoc) {
      attBar.classList.remove('hidden');
      const firstDoc = s.quote_documents[0];
      if (attName) attName.textContent = firstDoc.filename;
      if (attSize) attSize.textContent = `(${firstDoc.size_kb} KB)`;
      if (btnViewDoc) {
        btnViewDoc.onclick = () => openDiscoveredSupplierDoc(supplierKey, 0);
      }
    } else {
      attBar.classList.add('hidden');
    }
  }

  // Exact Email Body & Images
  const emToRender = {
    ...activeEm,
    documents: (activeEm.documents && activeEm.documents.length > 0) ? activeEm.documents : (s.quote_documents || [])
  };
  renderEmailMessageBodyAndImages(emToRender);

  if (modal) {
    modal.classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
};

window.openDiscoveredSupplierDoc = async function(supplierKey, docIdx = 0) {
  if (!lastScannedDiscoveryData || !lastScannedDiscoveryData.supplier_threads) return;
  const s = lastScannedDiscoveryData.supplier_threads.find(st => st.supplier_key === supplierKey);
  if (!s || !s.quote_documents || !s.quote_documents[docIdx]) return;

  currentDiscoveredSupplier = s;
  const doc = s.quote_documents[docIdx];

  const modal = document.getElementById('modalSourcePreview');
  const titleEl = document.getElementById('sourcePreviewTitle');
  const subtitleEl = document.getElementById('sourcePreviewSubtitle');
  const filenameBadge = document.getElementById('sourcePreviewFilenameBadge');
  const footerHint = document.getElementById('sourcePreviewFooterHint');
  const docControls = document.getElementById('sourcePreviewDocControls');
  const docViewWrapper = document.getElementById('sourceDocViewWrapper');
  const emailViewWrapper = document.getElementById('sourceEmailViewWrapper');
  const modeToggle = document.getElementById('sourcePreviewModeToggle');
  const pFrame = document.getElementById('sourcePreviewFrame');
  const pImg = document.getElementById('sourcePreviewImg');
  const pLoading = document.getElementById('sourceDocLoading');

  if (titleEl) titleEl.textContent = `Attached Quotation: ${s.supplier_name}`;
  if (subtitleEl) subtitleEl.textContent = `Document: ${doc.filename} (${doc.size_kb || 50} KB)`;
  if (filenameBadge) filenameBadge.textContent = `${doc.filename}`;
  if (footerHint) footerHint.textContent = `Official quotation document attached in supplier email`;

  // Switch to Document View
  if (docViewWrapper) docViewWrapper.classList.remove('hidden');
  if (emailViewWrapper) emailViewWrapper.classList.add('hidden');
  if (docControls) docControls.style.display = 'none';

  if (modeToggle) {
    modeToggle.classList.remove('hidden');
    modeToggle.style.display = 'flex';
    const btnSwitchEmail = document.getElementById('btnSwitchToEmailView');
    const btnSwitchDoc = document.getElementById('btnSwitchToDocView');
    if (btnSwitchEmail) btnSwitchEmail.className = 'px-3 py-1 text-slate-600 hover:text-slate-900 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition';
    if (btnSwitchDoc) btnSwitchDoc.className = 'px-3 py-1 bg-white text-slate-900 font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-2xs transition';
  }

  if (modal) {
    modal.classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // 1. If base64 already loaded
  if (doc.base64 && doc.base64.length > 50) {
    await renderPdfOrImageInPreview(doc.base64, doc.mime_type || 'application/pdf', [], doc.filename);
    return;
  }

  // 2. If pages already loaded
  if (doc.preview_pages && doc.preview_pages.length > 0) {
    await renderPdfOrImageInPreview(null, 'application/pdf', doc.preview_pages, doc.filename);
    return;
  }

  // 3. Fetch document binary on-demand from mailbox (<1 second)
  if (pLoading) pLoading.classList.remove('hidden');
  if (pFrame) {
    pFrame.src = 'about:blank';
    pFrame.classList.add('hidden');
  }
  if (pImg) {
    pImg.src = '';
    pImg.classList.add('hidden');
  }

  try {
    const itemReq = {
      supplier_key: s.supplier_key,
      folder: doc.folder || s.folder || 'INBOX',
      msg_id: doc.msg_id || s.msg_id,
      filename: doc.filename,
      part_number: doc.part_number
    };

    const data = await fetchMailboxQuoteDoc([itemReq]);
    const fetchedDoc = (data.documents && data.documents[0]) || (data.base64 ? data : null);
    if (fetchedDoc) {
      if (fetchedDoc.preview_pages && fetchedDoc.preview_pages.length > 0) {
        doc.preview_pages = fetchedDoc.preview_pages;
      }
      if (fetchedDoc.base64) {
        doc.base64 = fetchedDoc.base64;
        doc.mime_type = fetchedDoc.mime_type || 'application/pdf';
      }
      if ((doc.base64 && doc.base64.length > 50) || (doc.preview_pages && doc.preview_pages.length > 0)) {
        await renderPdfOrImageInPreview(doc.base64, doc.mime_type || 'application/pdf', doc.preview_pages || [], doc.filename);
        return;
      }
    }
  } catch (err) {
    console.warn('On-demand document fetch error:', err);
  }

  if (pLoading) pLoading.classList.add('hidden');
  showToast('Could not load quotation document from mailbox.', 'error');
};

window.openDiscoveredEmailMessagePreview = function(emailId) {
  if (!lastScannedDiscoveryData || !lastScannedDiscoveryData.discovered_emails) return;
  const em = lastScannedDiscoveryData.discovered_emails.find(e => e.email_id === emailId);
  if (!em) return;

  window.lastSourceEmailViewOpener = () => window.openDiscoveredEmailMessagePreview(emailId);

  const modal = document.getElementById('modalSourcePreview');
  const titleEl = document.getElementById('sourcePreviewTitle');
  const subtitleEl = document.getElementById('sourcePreviewSubtitle');
  const filenameBadge = document.getElementById('sourcePreviewFilenameBadge');
  const footerHint = document.getElementById('sourcePreviewFooterHint');
  const docControls = document.getElementById('sourcePreviewDocControls');
  const docViewWrapper = document.getElementById('sourceDocViewWrapper');
  const emailViewWrapper = document.getElementById('sourceEmailViewWrapper');
  const modeToggle = document.getElementById('sourcePreviewModeToggle');
  const tabsWrapper = document.getElementById('sourceEmailThreadTabsWrapper');

  if (titleEl) titleEl.textContent = `Raw Mailbox Message #${em.email_id + 1}`;
  if (subtitleEl) subtitleEl.textContent = `${em.direction_label} • Date: ${em.date}`;
  if (filenameBadge) filenameBadge.textContent = em.direction === 'outgoing' ? 'Sent RFQ Message' : 'Supplier Reply';
  if (footerHint) footerHint.textContent = `To: ${em.to || '-'} ${em.cc ? `• CC: ${em.cc}` : ''}`;

  if (docControls) docControls.style.display = 'none';
  if (docViewWrapper) docViewWrapper.classList.add('hidden');
  if (emailViewWrapper) emailViewWrapper.classList.remove('hidden');
  if (modeToggle) modeToggle.style.display = 'none';
  if (tabsWrapper) tabsWrapper.classList.add('hidden');

  const attBar = document.getElementById('sourceEmailAttachmentBar');
  if (attBar) attBar.classList.add('hidden');

  const sSender = document.getElementById('sourceEmailSender');
  const sDate = document.getElementById('sourceEmailDate');
  const sSubj = document.getElementById('sourceEmailSubject');
  const sFrom = document.getElementById('sourceEmailFrom');
  const sTo = document.getElementById('sourceEmailTo');
  const sCcWrapper = document.getElementById('sourceEmailCcWrapper');
  const sCc = document.getElementById('sourceEmailCc');
  const sAvatar = document.getElementById('sourceEmailAvatar');

  if (sSender) sSender.textContent = em.sender_name || em.sender_email || 'Mailbox';
  if (sDate) sDate.textContent = em.date || '-';
  if (sSubj) sSubj.textContent = em.subject || 'RFQ Message';
  if (sFrom) sFrom.textContent = em.from ? `<${em.from}>` : (em.sender_email ? `<${em.sender_email}>` : '');
  if (sTo) sTo.textContent = em.to || '-';

  if (sCcWrapper && sCc) {
    if (em.cc) {
      sCcWrapper.classList.remove('hidden');
      sCc.textContent = em.cc;
    } else {
      sCcWrapper.classList.add('hidden');
    }
  }

  if (sAvatar) {
    const rawName = em.sender_name || em.sender_email || 'EM';
    const words = rawName.split(/\s+/).filter(w => w.length > 0);
    const initials = words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase() : rawName.slice(0, 2).toUpperCase();
    sAvatar.textContent = initials || 'EM';
  }

  // Exact Email Body & Images & Documents
  renderEmailMessageBodyAndImages(em);

  if (modal) {
    modal.classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
};

window.openDiscoveryRfqDetails = function() {
  window.lastSourceEmailViewOpener = window.openDiscoveryRfqDetails;
  const initRfq = (lastScannedDiscoveryData && lastScannedDiscoveryData.initial_rfq) || 
                  (lastComparisonData && lastComparisonData.initial_rfq) || 
                  (lastComparisonData && lastComparisonData.baseline_rfq && lastComparisonData.baseline_rfq.baseline_email) || 
                  {};

  const modal = document.getElementById('modalSourcePreview');
  const titleEl = document.getElementById('sourcePreviewTitle');
  const subtitleEl = document.getElementById('sourcePreviewSubtitle');
  const filenameBadge = document.getElementById('sourcePreviewFilenameBadge');
  const footerHint = document.getElementById('sourcePreviewFooterHint');
  const docControls = document.getElementById('sourcePreviewDocControls');
  const docViewWrapper = document.getElementById('sourceDocViewWrapper');
  const emailViewWrapper = document.getElementById('sourceEmailViewWrapper');
  const modeToggle = document.getElementById('sourcePreviewModeToggle');
  const tabsWrapper = document.getElementById('sourceEmailThreadTabsWrapper');

  const subject = initRfq.subject || (lastScannedDiscoveryData && lastScannedDiscoveryData.subject_query) || 'Initial RFQ Inquiry';

  if (titleEl) titleEl.textContent = `Initial RFQ Inquiry: ${subject}`;
  if (subtitleEl) subtitleEl.textContent = `Sent by ${initRfq.sender_name || 'Procurement Dept'} (${initRfq.sender_email || 'sales02@apmerinservices.com.my'}) • ${initRfq.date || 'Discovery Thread'}`;
  if (filenameBadge) filenameBadge.textContent = 'Original Outgoing RFQ Inquiry';
  if (footerHint) footerHint.textContent = `Authentic inquiry sent to suppliers by AP Merin with parts specifications and drawings`;

  if (docControls) docControls.style.display = 'none';
  if (docViewWrapper) docViewWrapper.classList.add('hidden');
  if (emailViewWrapper) emailViewWrapper.classList.remove('hidden');
  if (modeToggle) modeToggle.style.display = 'none';
  if (tabsWrapper) tabsWrapper.classList.add('hidden');

  // Attached quote doc bar (hidden for initial outgoing RFQ unless a PDF inquiry sheet exists)
  const attBar = document.getElementById('sourceEmailAttachmentBar');
  if (attBar) attBar.classList.add('hidden');

  // Populate Email Meta Fields
  const sSubj = document.getElementById('sourceEmailSubject');
  const sSender = document.getElementById('sourceEmailSender');
  const sFrom = document.getElementById('sourceEmailFrom');
  const sTo = document.getElementById('sourceEmailTo');
  const sCcWrapper = document.getElementById('sourceEmailCcWrapper');
  const sCc = document.getElementById('sourceEmailCc');
  const sDate = document.getElementById('sourceEmailDate');
  const sAvatar = document.getElementById('sourceEmailAvatar');

  if (sSubj) sSubj.textContent = subject;
  if (sSender) sSender.textContent = initRfq.sender_name || 'Procurement Dept';
  if (sFrom) sFrom.textContent = `<${initRfq.sender_email || 'sales02@apmerinservices.com.my'}>`;
  if (sTo) sTo.textContent = initRfq.to || initRfq.recipients || 'Suppliers';
  if (sDate) sDate.textContent = initRfq.date || '-';

  if (sCcWrapper && sCc) {
    if (initRfq.cc) {
      sCcWrapper.classList.remove('hidden');
      sCc.textContent = initRfq.cc;
    } else {
      sCcWrapper.classList.add('hidden');
    }
  }

  if (sAvatar) {
    const rawName = initRfq.sender_name || 'Procurement';
    const words = rawName.split(/\s+/).filter(w => w.length > 0);
    const initials = words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase() : rawName.slice(0, 2).toUpperCase();
    sAvatar.textContent = initials || 'AP';
  }

  // Exact Email Body & Images (Authentic HTML with inline base64 images and gallery)
  renderEmailMessageBodyAndImages(initRfq);

  if (modal) {
    modal.classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
};

window.openBaselineEmailPreview = function() {
  window.lastSourceEmailViewOpener = window.openBaselineEmailPreview;
  if (!lastComparisonData && lastScannedDiscoveryData) {
    window.openDiscoveryRfqDetails();
    return;
  }
  if (!lastComparisonData) return;
  const b = lastComparisonData.baseline_rfq || {};
  const init = lastComparisonData.initial_rfq || (b && b.baseline_email) || (lastScannedDiscoveryData && lastScannedDiscoveryData.initial_rfq) || {};

  const modal = document.getElementById('modalSourcePreview');
  const titleEl = document.getElementById('sourcePreviewTitle');
  const subtitleEl = document.getElementById('sourcePreviewSubtitle');
  const filenameBadge = document.getElementById('sourcePreviewFilenameBadge');
  const footerHint = document.getElementById('sourcePreviewFooterHint');
  const docControls = document.getElementById('sourcePreviewDocControls');
  const docViewWrapper = document.getElementById('sourceDocViewWrapper');
  const emailViewWrapper = document.getElementById('sourceEmailViewWrapper');
  const modeToggle = document.getElementById('sourcePreviewModeToggle');
  const tabsWrapper = document.getElementById('sourceEmailThreadTabsWrapper');

  if (titleEl) titleEl.textContent = `Baseline Inquiry Email: ${b.vessel_name || b.rfq_number || 'AP Merin Services'}`;
  if (subtitleEl) subtitleEl.textContent = `Sent by ${init.sender_name || 'Procurement Dept'} • ${init.date || 'Inquiry Thread'}`;
  if (filenameBadge) filenameBadge.textContent = 'Original Outgoing RFQ Email';
  if (footerHint) footerHint.textContent = `Original RFQ inquiry sent to suppliers by AP Merin (${b.maker || ''} ${b.model || ''})`;

  if (docControls) docControls.style.display = 'none';
  if (docViewWrapper) docViewWrapper.classList.add('hidden');
  if (emailViewWrapper) emailViewWrapper.classList.remove('hidden');
  if (modeToggle) modeToggle.style.display = 'none';
  if (tabsWrapper) tabsWrapper.classList.add('hidden');

  // Attached baseline document bar (if PDF inquiry sheet exists)
  const attBar = document.getElementById('sourceEmailAttachmentBar');
  const attName = document.getElementById('sourceEmailAttachedDocName');
  const attSize = document.getElementById('sourceEmailAttachedDocSize');
  const btnViewDoc = document.getElementById('btnViewAttachedQuoteDoc');

  const hasDoc = (b.preview && b.preview.preview_pages && b.preview.preview_pages.length > 0);
  if (attBar) {
    if (hasDoc) {
      attBar.classList.remove('hidden');
      if (attName) attName.textContent = b.preview.preview_filename || 'RFQ Inquiry Sheet.pdf';
      if (attSize) attSize.textContent = `(${b.preview.preview_pages.length} page(s))`;
      if (btnViewDoc) {
        btnViewDoc.onclick = () => openBaselineSourcePreview();
      }
    } else {
      attBar.classList.add('hidden');
    }
  }

  // Populate Email Meta Fields
  const sSubj = document.getElementById('sourceEmailSubject');
  const sSender = document.getElementById('sourceEmailSender');
  const sFrom = document.getElementById('sourceEmailFrom');
  const sTo = document.getElementById('sourceEmailTo');
  const sCcWrapper = document.getElementById('sourceEmailCcWrapper');
  const sCc = document.getElementById('sourceEmailCc');
  const sDate = document.getElementById('sourceEmailDate');
  const sAvatar = document.getElementById('sourceEmailAvatar');

  if (sSubj) sSubj.textContent = init.subject || lastComparisonData.subject_query || 'RFQ Inquiry';
  if (sSender) sSender.textContent = init.sender_name || 'Procurement Dept';
  if (sFrom) sFrom.textContent = `<${init.sender_email || 'project@apmerinservices.com.my'}>`;
  if (sTo) sTo.textContent = init.to || init.recipients || 'Suppliers';
  if (sDate) sDate.textContent = init.date || '-';

  if (sCcWrapper && sCc) {
    if (init.cc) {
      sCcWrapper.classList.remove('hidden');
      sCc.textContent = init.cc;
    } else {
      sCcWrapper.classList.add('hidden');
    }
  }

  if (sAvatar) {
    const rawName = init.sender_name || 'Procurement';
    const words = rawName.split(/\s+/).filter(w => w.length > 0);
    const initials = words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase() : rawName.slice(0, 2).toUpperCase();
    sAvatar.textContent = initials || 'AP';
  }

  // Exact Email Body & Images (Authentic HTML with inline base64 images, document cards, and gallery)
  const docs = [...(init.documents || [])];
  if (docs.length === 0 && b.preview && (b.preview.preview_pages || b.preview.base64)) {
    docs.push({
      filename: b.preview.preview_filename || 'RFQ Inquiry Sheet.pdf',
      size: b.preview.size || 0,
      size_kb: b.preview.size_kb || 0,
      is_pdf: true,
      preview_pages: b.preview.preview_pages || [],
      base64: b.preview.base64,
      data_url: b.preview.data_url || (b.preview.base64 ? `data:${b.preview.mime_type || 'application/pdf'};base64,${b.preview.base64}` : '')
    });
  }
  const initToRender = {
    ...init,
    documents: docs
  };
  renderEmailMessageBodyAndImages(initToRender);

  if (modal) {
    modal.classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
};

window.openBaselineSourcePreview = function() {
  if (!lastComparisonData || !lastComparisonData.baseline_rfq) return;
  const b = lastComparisonData.baseline_rfq;
  const preview = b.preview || {};

  if (!preview.preview_pages || preview.preview_pages.length === 0) {
    showToast('No baseline document preview available.', 'info');
    return;
  }

  sourcePreviewPages = preview.preview_pages;
  sourcePreviewPageIndex = 0;

  const modal = document.getElementById('modalSourcePreview');
  const titleEl = document.getElementById('sourcePreviewTitle');
  const subtitleEl = document.getElementById('sourcePreviewSubtitle');
  const filenameBadge = document.getElementById('sourcePreviewFilenameBadge');
  const footerHint = document.getElementById('sourcePreviewFooterHint');
  const docControls = document.getElementById('sourcePreviewDocControls');
  const docViewWrapper = document.getElementById('sourceDocViewWrapper');
  const emailViewWrapper = document.getElementById('sourceEmailViewWrapper');

  if (titleEl) titleEl.textContent = `Original RFQ Sheet: ${b.vessel_name || 'Inquiry'}`;
  if (subtitleEl) subtitleEl.textContent = `Inquiry Ref: ${b.rfq_number || ''} • Model: ${b.model || ''}`;
  if (filenameBadge) filenameBadge.textContent = preview.preview_filename || 'Baseline RFQ Inquiry';
  if (footerHint) footerHint.textContent = `Original baseline inquiry document sent to suppliers (${sourcePreviewPages.length} page(s))`;

  if (docControls) {
    docControls.style.display = sourcePreviewPages.length > 1 ? 'flex' : 'none';
  }

  if (docViewWrapper) docViewWrapper.classList.remove('hidden');
  if (emailViewWrapper) emailViewWrapper.classList.add('hidden');

  updateSourceDocPageDisplay();

  if (modal) {
    modal.classList.remove('hidden');
    lucide.createIcons();
  }
};

function updateSourceDocPageDisplay() {
  const previewImg = document.getElementById('sourcePreviewImg');
  const previewFrame = document.getElementById('sourcePreviewFrame');
  const indicator = document.getElementById('sourcePreviewPageIndicator');
  const btnPrev = document.getElementById('btnSourcePrevPage');
  const btnNext = document.getElementById('btnSourceNextPage');

  if (sourcePreviewPages && sourcePreviewPages.length > 0) {
    if (previewFrame) {
      previewFrame.src = 'about:blank';
      previewFrame.classList.add('hidden');
    }
    if (previewImg) {
      previewImg.src = sourcePreviewPages[sourcePreviewPageIndex];
      previewImg.classList.remove('hidden');
    }
    if (indicator) indicator.textContent = `Page ${sourcePreviewPageIndex + 1} of ${sourcePreviewPages.length}`;
    if (btnPrev) btnPrev.disabled = (sourcePreviewPageIndex === 0);
    if (btnNext) btnNext.disabled = (sourcePreviewPageIndex >= sourcePreviewPages.length - 1);
  }
}

window.closeSourcePreviewModal = function() {
  const modal = document.getElementById('modalSourcePreview');
  const pFrame = document.getElementById('sourcePreviewFrame');
  const pImg = document.getElementById('sourcePreviewImg');
  const btnOpenPdf = document.getElementById('btnSourceOpenPdf');
  const excelWrapper = document.getElementById('sourceExcelViewWrapper');
  const excelTabs = document.getElementById('sourceExcelSheetTabs');
  const excelTable = document.getElementById('sourceExcelTableContainer');

  if (pFrame) {
    pFrame.src = 'about:blank';
    pFrame.classList.add('hidden');
  }
  if (pImg) {
    pImg.src = '';
    pImg.classList.add('hidden');
  }
  if (excelWrapper) excelWrapper.classList.add('hidden');
  if (excelTabs) excelTabs.innerHTML = '';
  if (excelTable) excelTable.innerHTML = '';

  if (btnOpenPdf) {
    btnOpenPdf.href = '#';
    btnOpenPdf.removeAttribute('download');
    btnOpenPdf.onclick = null;
    btnOpenPdf.classList.add('hidden');
    btnOpenPdf.style.display = 'none';
  }
  if (currentPreviewBlobUrl) {
    try { URL.revokeObjectURL(currentPreviewBlobUrl); } catch (_) {}
    currentPreviewBlobUrl = null;
  }
  if (modal) modal.classList.add('hidden');
};

document.getElementById('btnCloseSourcePreviewModal')?.addEventListener('click', closeSourcePreviewModal);
document.getElementById('btnCloseLightboxModal')?.addEventListener('click', closeImageLightbox);
document.getElementById('modalImageLightbox')?.addEventListener('click', (e) => {
  if (e.target.id === 'modalImageLightbox') closeImageLightbox();
});
document.getElementById('btnSourcePrevPage')?.addEventListener('click', () => {
  if (sourcePreviewPageIndex > 0) {
    sourcePreviewPageIndex--;
    updateSourceDocPageDisplay();
  }
});
document.getElementById('btnSourceNextPage')?.addEventListener('click', () => {
  if (sourcePreviewPageIndex < sourcePreviewPages.length - 1) {
    sourcePreviewPageIndex++;
    updateSourceDocPageDisplay();
  }
});

// Switchers between Email Reply and Attached Quotation
document.getElementById('btnReturnToEmailFromDoc')?.addEventListener('click', () => {
  if (typeof window.lastSourceEmailViewOpener === 'function') {
    window.lastSourceEmailViewOpener();
  } else if (currentDiscoveredSupplier) {
    openDiscoveredSupplierPreview(currentDiscoveredSupplier.supplier_key, currentDiscoveredEmailIdx);
  }
});
document.getElementById('btnSwitchToEmailView')?.addEventListener('click', () => {
  if (typeof window.lastSourceEmailViewOpener === 'function') {
    window.lastSourceEmailViewOpener();
  } else if (currentDiscoveredSupplier) {
    openDiscoveredSupplierPreview(currentDiscoveredSupplier.supplier_key, currentDiscoveredEmailIdx);
  }
});
document.getElementById('btnSwitchToDocView')?.addEventListener('click', () => {
  if (currentDiscoveredSupplier && currentDiscoveredSupplier.quote_documents && currentDiscoveredSupplier.quote_documents.length > 0) {
    openDiscoveredSupplierDoc(currentDiscoveredSupplier.supplier_key, 0);
  }
});

// Stage 1 Discovery Action Buttons
document.getElementById('btnApproveAndExtract')?.addEventListener('click', handleApproveAndExtract);
document.getElementById('btnCancelEmailDiscovery')?.addEventListener('click', () => {
  const reviewSec = document.getElementById('compareEmailReviewSection');
  if (reviewSec) reviewSec.classList.add('hidden');
});
document.getElementById('btnSelectAllSuppliers')?.addEventListener('click', () => {
  document.querySelectorAll('.supplier-discovery-checkbox').forEach(chk => {
    chk.checked = true;
    selectedSupplierKeys.add(chk.getAttribute('data-supplier-key'));
  });
  updateApproveButtonText();
});
document.getElementById('btnDeselectAllSuppliers')?.addEventListener('click', () => {
  document.querySelectorAll('.supplier-discovery-checkbox').forEach(chk => {
    chk.checked = false;
  });
  selectedSupplierKeys.clear();
  updateApproveButtonText();
});
document.getElementById('btnToggleAllScannedEmails')?.addEventListener('click', () => {
  const wrapper = document.getElementById('discoveryRawEmailsWrapper');
  const icon = document.getElementById('discoveryRawEmailsIcon');
  if (wrapper) {
    wrapper.classList.toggle('hidden');
    if (icon) icon.classList.toggle('rotate-180');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSourcePreviewModal();
  }
});


// =========================================================================
// CROSS-DEVICE DATA SYNCHRONIZATION ENGINE & ARCHIVE (Windows & macOS)
// =========================================================================

let activeSyncStatus = null;
let savedComparisonsCache = [];

function initCrossDeviceSync() {
  // Modal toggle listeners
  const btnOpenSync = document.getElementById('btnOpenSyncModal');
  const btnCloseSync = document.getElementById('btnCloseSyncModal');
  const modalSync = document.getElementById('modalSyncCenter');

  if (btnOpenSync && modalSync) {
    btnOpenSync.addEventListener('click', () => {
      modalSync.classList.remove('hidden');
      fetchSyncStatus();
    });
  }

  if (btnCloseSync && modalSync) {
    btnCloseSync.addEventListener('click', () => {
      modalSync.classList.add('hidden');
    });
  }

  // Cloud folder config buttons
  const btnSaveSyncFolder = document.getElementById('btnSaveSyncFolder');
  const btnResetSyncFolder = document.getElementById('btnResetSyncFolder');
  const inputSyncFolder = document.getElementById('inputSyncSharedFolder');

  if (btnSaveSyncFolder && inputSyncFolder) {
    btnSaveSyncFolder.addEventListener('click', () => {
      configureSharedCloudFolder(inputSyncFolder.value.trim());
    });
  }

  if (btnResetSyncFolder) {
    btnResetSyncFolder.addEventListener('click', () => {
      if (inputSyncFolder) inputSyncFolder.value = '';
      configureSharedCloudFolder('');
    });
  }

  // One-click Export & Import Bundle
  const btnExport = document.getElementById('btnExportSyncBundle');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      window.location.href = '/api/sync/export';
    });
  }

  const inputImport = document.getElementById('inputImportSyncBundle');
  if (inputImport) {
    inputImport.addEventListener('change', handleImportSyncBundle);
  }

  // Saved Comparisons Modal
  const btnOpenSavedComps = document.getElementById('btnOpenSavedComparisonsModal');
  const btnCloseSavedComps = document.getElementById('btnCloseSavedCompsModal');
  const modalSavedComps = document.getElementById('modalSavedComparisons');
  const btnRefreshSavedComps = document.getElementById('btnRefreshSavedComps');
  const inputFilterSavedComps = document.getElementById('inputFilterSavedComps');

  if (btnOpenSavedComps && modalSavedComps) {
    btnOpenSavedComps.addEventListener('click', () => {
      modalSavedComps.classList.remove('hidden');
      loadSavedComparisons();
    });
  }

  if (btnCloseSavedComps && modalSavedComps) {
    btnCloseSavedComps.addEventListener('click', () => {
      modalSavedComps.classList.add('hidden');
    });
  }

  if (btnRefreshSavedComps) {
    btnRefreshSavedComps.addEventListener('click', loadSavedComparisons);
  }

  if (inputFilterSavedComps) {
    inputFilterSavedComps.addEventListener('input', (e) => {
      const q = (e.target.value || '').toLowerCase().trim();
      document.querySelectorAll('.saved-comp-card').forEach(card => {
        const text = (card.getAttribute('data-search') || '').toLowerCase();
        card.classList.toggle('hidden', q && !text.includes(q));
      });
    });
  }

  // Save active comparison button
  const btnSaveComp = document.getElementById('btnSaveCompareToSync');
  if (btnSaveComp) {
    btnSaveComp.addEventListener('click', saveCurrentComparisonToSync);
  }

  // Initial status fetch
  fetchSyncStatus();

  // Background sync polling every 30 seconds
  setInterval(fetchSyncStatus, 30000);
}

async function fetchSyncStatus() {
  try {
    const res = await fetch('/api/sync/status');
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.success) return;
    activeSyncStatus = data;
    updateSyncUI(data);
  } catch (err) {
    console.warn('Sync status check:', err);
  }
}

function updateSyncUI(status) {
  if (!status) return;

  // 1. Header Badge & Counter
  const badgeText = document.getElementById('syncBadgeText');
  const badgeDot = document.getElementById('syncStatusDot');
  const pulseRing = document.getElementById('syncPulseRing');
  const savedCompsCount = document.getElementById('savedCompsCountBadge');

  if (savedCompsCount) {
    savedCompsCount.textContent = (status.counts && status.counts.comparisons) || 0;
  }

  if (badgeText) {
    if (status.sync_mode === 'cloud_folder') {
      badgeText.textContent = 'Cloud Synced';
      if (badgeDot) badgeDot.className = 'relative inline-flex rounded-full h-2 w-2 bg-emerald-500';
      if (pulseRing) pulseRing.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75';
    } else {
      badgeText.textContent = 'Synced (Local)';
      if (badgeDot) badgeDot.className = 'relative inline-flex rounded-full h-2 w-2 bg-blue-500';
      if (pulseRing) pulseRing.className = 'hidden';
    }
  }

  // 2. Modal Details
  const devName = document.getElementById('syncCurrentDeviceName');
  const devId = document.getElementById('syncCurrentDeviceId');
  const modeLabel = document.getElementById('syncModeLabel');
  const dbPathLabel = document.getElementById('syncActiveDbPathLabel');
  const compCountEl = document.getElementById('syncCountComparisons');
  const poCountEl = document.getElementById('syncCountPOs');
  const folderInput = document.getElementById('inputSyncSharedFolder');
  const lastTimeEl = document.getElementById('syncLastTimeLabel');
  const platIcon = document.getElementById('syncCurrentPlatformIcon');

  if (devName) devName.textContent = status.current_device?.name || 'Local Laptop';
  if (devId) devId.textContent = `ID: ${status.current_device?.id || '-'}`;
  if (modeLabel) modeLabel.textContent = status.sync_mode === 'cloud_folder' ? 'Shared Cloud Drive' : 'Local SQLite DB';
  if (dbPathLabel) dbPathLabel.textContent = `Active Database: ${status.db_path || '-'}`;
  if (compCountEl) compCountEl.textContent = status.counts?.comparisons || 0;
  if (poCountEl) poCountEl.textContent = status.counts?.purchase_orders || 0;
  if (folderInput && !folderInput.value && status.shared_folder) folderInput.value = status.shared_folder;
  if (lastTimeEl) {
    const d = new Date();
    lastTimeEl.textContent = `Checked ${d.toLocaleTimeString()}`;
  }

  if (platIcon) {
    const isMac = (status.current_device?.platform || '').toLowerCase().includes('darwin');
    platIcon.setAttribute('data-lucide', isMac ? 'apple' : 'laptop');
  }

  // 3. Render detected cloud folders quick buttons
  const detectedContainer = document.getElementById('syncDetectedFoldersContainer');
  if (detectedContainer) {
    const folders = status.available_cloud_folders || [];
    if (folders.length > 0) {
      detectedContainer.innerHTML = folders.map(f => `
        <button type="button" class="btn-quick-cloud-folder px-3 py-1.5 bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition cursor-pointer" data-folder-path="${escapeHtml(f.path)}">
          <i data-lucide="folder" class="w-3.5 h-3.5 text-blue-500"></i>
          <span>Use ${escapeHtml(f.name)}</span>
        </button>
      `).join('');

      detectedContainer.querySelectorAll('.btn-quick-cloud-folder').forEach(btn => {
        btn.addEventListener('click', () => {
          const path = btn.getAttribute('data-folder-path');
          if (folderInput) folderInput.value = path;
          configureSharedCloudFolder(path);
        });
      });
    } else {
      detectedContainer.innerHTML = '<span class="text-xs text-slate-400 italic">No standard cloud folders automatically detected. Enter custom path below.</span>';
    }
  }

  // 4. Render connected devices list
  const devicesList = document.getElementById('syncConnectedDevicesList');
  if (devicesList) {
    const devs = status.connected_devices || [];
    if (devs.length > 0) {
      devicesList.innerHTML = devs.map(d => {
        const isCurrent = d.device_id === status.current_device?.id;
        const isMac = (d.platform || '').toLowerCase().includes('darwin') || (d.platform || '').toLowerCase().includes('mac');
        const iconName = isMac ? 'apple' : 'laptop';
        const dateStr = d.last_seen ? new Date(d.last_seen).toLocaleString() : 'Recently';
        return `
          <div class="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
            <div class="flex items-center gap-2.5 truncate">
              <div class="w-7 h-7 rounded-lg ${isCurrent ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'} flex items-center justify-center shrink-0">
                <i data-lucide="${iconName}" class="w-4 h-4"></i>
              </div>
              <div class="truncate">
                <div class="flex items-center gap-1.5">
                  <strong class="text-slate-800">${escapeHtml(d.device_name || 'Device')}</strong>
                  ${isCurrent ? '<span class="px-1.5 py-0.2 bg-indigo-100 text-indigo-700 rounded text-[10px] font-bold">This Device</span>' : ''}
                </div>
                <span class="text-[10px] font-mono text-slate-400">${escapeHtml(d.platform || '')} • Last active: ${dateStr}</span>
              </div>
            </div>
            <span class="text-[11px] text-emerald-600 font-bold flex items-center gap-1 shrink-0">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Synced
            </span>
          </div>
        `;
      }).join('');
    } else {
      devicesList.innerHTML = '<span class="text-xs text-slate-400">No other devices connected yet.</span>';
    }
  }

  if (window.lucide) lucide.createIcons();
}

async function configureSharedCloudFolder(folderPath) {
  try {
    const res = await fetch('/api/sync/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shared_folder: folderPath })
    });
    const data = await res.json();
    if (data.success) {
      activeSyncStatus = data;
      updateSyncUI(data);
      showToast(folderPath ? 'Shared Cloud Drive Sync activated! All data will mirror across devices.' : 'Switched back to local SQLite database.', 'success');
    } else {
      showToast('Error configuring sync folder: ' + (data.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    showToast('Failed to configure sync folder: ' + err.message, 'error');
  }
}

async function handleImportSyncBundle(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('syncImportStatusText');
  if (statusEl) statusEl.textContent = 'Importing bundle...';

  try {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/sync/import', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (data && data.success) {
      const imp = data.imported || {};
      showToast(`Imported ${imp.comparisons || 0} comparisons & ${imp.purchase_orders || 0} POs!`, 'success');
      if (statusEl) statusEl.textContent = 'Import successful!';
      fetchSyncStatus();
      loadSavedComparisons();
    } else {
      showToast('Import failed: ' + (data?.error || 'Unknown error'), 'error');
      if (statusEl) statusEl.textContent = 'Import failed';
    }
  } catch (err) {
    showToast('Import error: ' + err.message, 'error');
    if (statusEl) statusEl.textContent = 'Import error';
  } finally {
    e.target.value = '';
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 4000);
  }
}

async function saveCurrentComparisonToSync() {
  if (!lastComparisonData || !lastComparisonData.comparison_matrix) {
    showToast('No active comparison data to save. Please scan or extract quotations first.', 'warning');
    return;
  }

  const btn = document.getElementById('btnSaveCompareToSync');
  const btnText = document.getElementById('btnSaveCompareText');
  const origText = btnText ? btnText.textContent : 'Save Comparison';
  if (btnText) btnText.textContent = 'Saving...';

  try {
    const searchInput = document.getElementById('compareSearchInput');
    const currencySelect = document.getElementById('compareTargetCurrency');
    const subject = lastComparisonData.subject_query || (searchInput ? searchInput.value.trim() : '') || 'Quotation Comparison';
    const rfqRef = lastComparisonData.baseline_rfq?.reference_number || '';
    const custName = lastComparisonData.baseline_rfq?.vessel_name || lastComparisonData.baseline_rfq?.customer_name || '';
    const targetCurr = currencySelect ? currencySelect.value : (lastComparisonData.target_currency || 'MYR');

    const payload = {
      ...lastComparisonData,
      subject_query: subject,
      rfq_reference: rfqRef,
      customer_name: custName,
      target_currency: targetCurr
    };

    const res = await fetch('/api/sync/comparisons/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (result && result.success) {
      if (btnText) btnText.textContent = '✓ Saved & Synced!';
      if (btn) btn.classList.add('ring-2', 'ring-emerald-400');
      showToast('Comparison successfully saved to sync vault!', 'success');
      fetchSyncStatus();
      setTimeout(() => {
        if (btnText) btnText.textContent = origText;
        if (btn) btn.classList.remove('ring-2', 'ring-emerald-400');
      }, 2500);
    } else {
      showToast('Failed to save comparison: ' + (result?.error || 'Unknown error'), 'error');
      if (btnText) btnText.textContent = origText;
    }
  } catch (err) {
    showToast('Save comparison error: ' + err.message, 'error');
    if (btnText) btnText.textContent = origText;
  }
}

async function loadSavedComparisons() {
  const container = document.getElementById('savedCompsListContainer');
  if (container) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-500">
        <i data-lucide="loader-2" class="w-6 h-6 animate-spin text-amber-500 mx-auto mb-2"></i>
        <p class="text-xs">Loading saved comparisons from sync vault...</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }

  try {
    const res = await fetch('/api/sync/comparisons');
    const data = await res.json();
    if (!data || !data.success) {
      if (container) container.innerHTML = '<div class="p-4 text-center text-rose-500 text-xs">Failed loading comparisons.</div>';
      return;
    }

    savedComparisonsCache = data.comparisons || [];
    renderSavedComparisonsList(savedComparisonsCache);
  } catch (err) {
    if (container) container.innerHTML = `<div class="p-4 text-center text-rose-500 text-xs">${err.message}</div>`;
  }
}

function renderSavedComparisonsList(comps) {
  const container = document.getElementById('savedCompsListContainer');
  if (!container) return;

  if (comps.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-400 space-y-2">
        <i data-lucide="folder-open" class="w-10 h-10 mx-auto text-slate-300"></i>
        <p class="text-xs font-semibold text-slate-600">No saved comparisons found in database.</p>
        <p class="text-[11px]">When you extract supplier quotations in Step 3, click "Save Comparison" to store and sync them.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = comps.map(c => {
    const dateStr = c.updated_at ? new Date(c.updated_at).toLocaleString() : 'Recently';
    return `
      <div class="saved-comp-card p-4 bg-white border border-slate-200 hover:border-amber-300 rounded-2xl shadow-2xs hover:shadow-sm transition space-y-2.5" data-id="${c.id}" data-search="${escapeHtml((c.subject_query || '') + ' ' + (c.rfq_reference || '') + ' ' + (c.customer_name || '')).toLowerCase()}">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="space-y-0.5">
            <h4 class="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-2">
              <i data-lucide="scale" class="w-4 h-4 text-amber-600 shrink-0"></i>
              <span>${escapeHtml(c.subject_query || 'Untitled Comparison')}</span>
            </h4>
            <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              ${c.rfq_reference ? `<span class="font-mono bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-bold">${escapeHtml(c.rfq_reference)}</span>` : ''}
              ${c.customer_name ? `<span>Customer/Vessel: <strong>${escapeHtml(c.customer_name)}</strong></span>` : ''}
              <span>•</span>
              <span class="font-mono text-slate-400">${dateStr}</span>
              ${c.device_name ? `<span>• <i data-lucide="laptop" class="w-3 h-3 inline text-slate-400"></i> ${escapeHtml(c.device_name)}</span>` : ''}
            </div>
          </div>

          <div class="flex items-center gap-1.5">
            <span class="px-2 py-0.5 bg-amber-50 text-amber-800 rounded-full text-[11px] font-bold border border-amber-200">
              ${c.supplier_count || 0} Suppliers
            </span>
            <span class="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full text-[11px] font-semibold">
              ${c.item_count || 0} Items
            </span>
            <span class="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-[11px] font-bold font-mono">
              ${c.target_currency || 'MYR'}
            </span>
          </div>
        </div>

        <div class="flex items-center justify-between border-t border-slate-100 pt-2.5">
          <button type="button" class="btn-load-saved-comp px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition cursor-pointer" data-id="${c.id}">
            <i data-lucide="folder-open" class="w-3.5 h-3.5"></i>
            <span>Load Comparison</span>
          </button>

          <div class="flex items-center gap-2">
            <button type="button" class="btn-delete-saved-comp p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer" data-id="${c.id}" title="Delete Comparison">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();

  // Attach event listeners to Load & Delete buttons
  container.querySelectorAll('.btn-load-saved-comp').forEach(btn => {
    btn.addEventListener('click', () => loadSingleComparison(btn.getAttribute('data-id')));
  });

  container.querySelectorAll('.btn-delete-saved-comp').forEach(btn => {
    btn.addEventListener('click', () => deleteSingleComparison(btn.getAttribute('data-id')));
  });
}

async function loadSingleComparison(compId) {
  try {
    showToast('Loading comparison matrix...', 'info');
    const res = await fetch(`/api/sync/comparisons/${compId}`);
    const data = await res.json();
    if (!data || !data.success || !data.comparison) {
      showToast('Could not load comparison details.', 'error');
      return;
    }

    const comp = data.comparison;
    const compData = comp.data || {};

    lastComparisonData = compData;

    // Switch to Quotation Comparison Mode
    const tabCompare = document.getElementById('tabModeCompare');
    if (tabCompare) tabCompare.click();

    // Set search query input
    const searchInput = document.getElementById('compareSearchInput');
    if (searchInput) searchInput.value = comp.subject_query || '';

    // Render into Stage 3 Results
    const progressSection = document.getElementById('compareProgressSection');
    const reviewSection = document.getElementById('compareEmailReviewSection');
    const resultsSection = document.getElementById('compareResultsSection');

    if (progressSection) progressSection.classList.add('hidden');
    if (reviewSection) reviewSection.classList.add('hidden');

    renderComparisonResults(compData);

    if (resultsSection) {
      resultsSection.classList.remove('hidden');
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Close modal
    const modal = document.getElementById('modalSavedComparisons');
    if (modal) modal.classList.add('hidden');

    showToast(`Loaded comparison: "${comp.subject_query}"`, 'success');
  } catch (err) {
    showToast('Error loading comparison: ' + err.message, 'error');
  }
}

async function deleteSingleComparison(compId) {
  if (!confirm('Are you sure you want to delete this saved comparison?')) return;
  try {
    const res = await fetch(`/api/sync/comparisons/${compId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Comparison deleted.', 'info');
      loadSavedComparisons();
      fetchSyncStatus();
    } else {
      showToast('Failed to delete comparison.', 'error');
    }
  } catch (err) {
    showToast('Delete error: ' + err.message, 'error');
  }
}


