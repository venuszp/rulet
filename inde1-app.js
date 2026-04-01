
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  update,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBTcH3_tri2L7AHLh1e-YD-0s-QSthuE6Q",
  authDomain: "disk-c98ee.firebaseapp.com",
  databaseURL: "https://disk-c98ee-default-rtdb.firebaseio.com",
  projectId: "disk-c98ee",
  storageBucket: "disk-c98ee.firebasestorage.app",
  messagingSenderId: "59577059636",
  appId: "1:59577059636:web:e98f456d054cc360747d61"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const ADMIN_EMAILS = ['admin@humo.uz', 'venuszp@gmail.com'];

let authMode = 'login';
let currentAuthUser = null;
let currentProfile = null;
let currentHistory = [];
let adminUsersMap = {};
let activeMoneyUid = null;
let profileStop = null;
let historyStop = null;
let adminUsersStop = null;
let shouldShowWelcome = false;

function isAdminEmail(email) {
  return ADMIN_EMAILS.includes((email || '').trim().toLowerCase());
}

function normalizeCardNumber(card) {
  return String(card || '').replace(/\D/g, '');
}

function formatCardNumber(card) {
  return normalizeCardNumber(card).replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function formatAppealStatus(status) {
  if (status === 'pending') return 'На рассмотрении';
  if (status === 'approved') return 'Одобрена';
  if (status === 'rejected') return 'Отклонена';
  return 'Нет запроса';
}

function isUserBlocked(profile = currentProfile) {
  return !!(profile && profile.status === 'blocked');
}

function getAppealState(profile = currentProfile) {
  return profile && profile.appeal ? profile.appeal : null;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showAlert(title, msg, type = 'info') {
  const container = document.getElementById('alertContainer');
  const alert = document.createElement('div');
  const icon = type === 'success' ? '✅' : type === 'error' ? '🚫' : 'ℹ️';
  alert.className = `custom-alert ${type}`;
  alert.innerHTML = `
    <div class="alert-icon">${icon}</div>
    <div class="alert-body">
      <div class="alert-title">${title}</div>
      <div class="alert-msg">${msg}</div>
    </div>
  `;
  container.appendChild(alert);
  setTimeout(() => alert.classList.add('show'), 10);
  setTimeout(() => {
    alert.classList.remove('show');
    setTimeout(() => alert.remove(), 400);
  }, 2600);
}

function blockRestrictedAction() {
  showAlert('Карта заблокирована', 'Изменения недоступны. Подайте апелляцию или дождитесь разблокировки.', 'error');
  return true;
}

async function generateUniqueCard() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let card = '9860';
    for (let i = 0; i < 12; i += 1) card += Math.floor(Math.random() * 10);
    const snap = await get(ref(db, `cards/${card}`));
    if (!snap.exists()) return card;
  }
  throw new Error('Не удалось выпустить карту. Попробуйте снова.');
}

function setAdminButtonState() {
  const isAdmin = !!currentAuthUser && (currentProfile?.role === 'admin' || isAdminEmail(currentAuthUser.email));
  document.getElementById('adminBtn').style.display = isAdmin ? 'inline-flex' : 'none';
}

function updateTransferState() {
  const blocked = isUserBlocked();
  const transferBtn = document.getElementById('transferBtn');
  const txCard = document.getElementById('txCard');
  const txAmount = document.getElementById('txAmount');
  if (!transferBtn || !txCard || !txAmount) return;

  transferBtn.innerText = blocked ? '🔒 Карта заблокирована' : '⚡ Отправить';
  transferBtn.disabled = blocked;
  transferBtn.style.opacity = blocked ? '0.7' : '1';
  transferBtn.style.cursor = blocked ? 'not-allowed' : 'pointer';
  txCard.disabled = blocked;
  txAmount.disabled = blocked;
}

function updateBalanceUI() {
  document.getElementById('cardBalance').innerText = `${(currentProfile?.balance || 0).toLocaleString()} UZS`;
}

function updateTxHistory() {
  const cont = document.getElementById('txHistory');
  if (!currentHistory.length) {
    cont.innerHTML = '<div class="no-tx">Транзакций пока нет</div>';
    return;
  }

  cont.innerHTML = currentHistory
    .slice()
    .sort((a, b) => b.date - a.date)
    .map(t => `
      <div class="tx-item">
        <div class="tx-icon ${t.type}">${t.type === 'in' ? '↙' : '↗'}</div>
        <div class="tx-details">
          <div class="tx-label">${t.desc}</div>
          <div class="tx-date">${new Date(t.date).toLocaleString()}</div>
        </div>
        <div class="tx-amount ${t.type}">${t.type === 'in' ? '+' : '-'}${Number(t.amt || 0).toLocaleString()}</div>
      </div>
    `)
    .join('');
}

function updateAppealStatus() {
  const appeal = getAppealState();
  const box = document.getElementById('appealStatusBox');
  const btn = document.getElementById('appealBtn');
  const input = document.getElementById('appealReason');
  if (!box || !btn || !input) return;

  if (!isUserBlocked()) {
    box.style.display = 'none';
    btn.disabled = true;
    btn.style.opacity = '0.6';
    input.disabled = true;
    input.value = '';
    return;
  }

  input.disabled = !!(appeal && appeal.status === 'pending');
  btn.disabled = !!(appeal && appeal.status === 'pending');
  btn.style.opacity = btn.disabled ? '0.65' : '1';

  if (!appeal) {
    box.style.display = 'none';
    input.disabled = false;
    return;
  }

  box.style.display = 'block';
  const adminComment = appeal.adminComment ? `<br><br><span>${appeal.adminComment}</span>` : '';
  box.innerHTML = `<strong>Статус: ${formatAppealStatus(appeal.status)}</strong><span>${appeal.message || 'Без комментария'}</span>${adminComment}`;
}

function updateSettingsState() {
  const blocked = isUserBlocked();
  ['setFirst', 'setLast', 'setNewPass', 'setNewPassConfirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = blocked;
  });
  document.getElementById('settingsBlockedNote').style.display = blocked ? 'block' : 'none';
  updateAppealStatus();
}

function initDash(showWelcome = false) {
  if (!currentProfile) return;
  const blocked = isUserBlocked();
  document.getElementById('blockBanner').style.display = blocked ? 'block' : 'none';
  document.getElementById('cardBlockedOverlay').classList.toggle('active', blocked);
  document.getElementById('balanceFrozenNote').style.display = blocked ? 'block' : 'none';
  document.getElementById('userName').innerText = `${currentProfile.first} ${currentProfile.last}`;
  document.getElementById('userAvatar').innerText = (currentProfile.first || 'U')[0];
  document.getElementById('cardHolder').innerText = `${currentProfile.first} ${currentProfile.last}`;
  document.getElementById('cardNumber').innerText = formatCardNumber(currentProfile.card);
  updateBalanceUI();
  updateTxHistory();
  updateTransferState();
  setAdminButtonState();
  showScreen('dashScreen');
  if (showWelcome) showAlert('Добро пожаловать', 'Система Humo Digital готова к работе.', 'success');
}
function attachHistoryListener(uid) {
  if (historyStop) historyStop();
  historyStop = onValue(ref(db, `histories/${uid}`), snap => {
    currentHistory = snap.exists() ? Object.values(snap.val()) : [];
    updateTxHistory();
  });
}

function attachProfileListener(uid) {
  if (profileStop) profileStop();
  profileStop = onValue(ref(db, `users/${uid}`), async snap => {
    if (!snap.exists()) {
      currentProfile = null;
      if (historyStop) {
        historyStop();
        historyStop = null;
      }
      showScreen('setupScreen');
      return;
    }

    currentProfile = snap.val();
    if (isAdminEmail(currentAuthUser?.email) && currentProfile.role !== 'admin') {
      await update(ref(db, `users/${uid}`), { role: 'admin' });
      return;
    }

    attachHistoryListener(uid);
    initDash(shouldShowWelcome);
    shouldShowWelcome = false;
    if (document.getElementById('settingsOverlay').classList.contains('active')) openSettings();
  });
}

function subscribeAdminUsers() {
  if (adminUsersStop) return;
  adminUsersStop = onValue(ref(db, 'users'), snap => {
    adminUsersMap = snap.exists() ? snap.val() : {};
    renderAdminUsers();
    renderAppealRequests();
    updateAdminStats();
  });
}

function unsubscribeAdminUsers() {
  if (adminUsersStop) {
    adminUsersStop();
    adminUsersStop = null;
  }
}

window.switchAuthTab = (mode) => {
  authMode = mode;
  document.getElementById('tabLogin').classList.toggle('active', mode === 'login');
  document.getElementById('tabReg').classList.toggle('active', mode === 'register');
  document.getElementById('authBtnText').innerText = mode === 'login' ? 'Войти' : 'Создать аккаунт';
  document.getElementById('authError').innerText = '';
};

window.handleAuth = async () => {
  const email = document.getElementById('authEmail').value.trim();
  const pass = document.getElementById('authPass').value.trim();
  const err = document.getElementById('authError');
  err.innerText = '';

  if (!email || !pass) {
    err.innerText = 'Заполните все поля';
    return;
  }

  try {
    if (authMode === 'login') {
      shouldShowWelcome = true;
      await signInWithEmailAndPassword(auth, email, pass);
    } else {
      await createUserWithEmailAndPassword(auth, email, pass);
      showAlert('Аккаунт создан', 'Заполните профиль для выпуска карты.', 'success');
    }
  } catch (e) {
    err.innerText = e.code === 'auth/email-already-in-use'
      ? 'Email уже занят'
      : e.code === 'auth/invalid-credential'
      ? 'Неверный email или пароль'
      : e.message;
  }
};

window.handleSetup = async () => {
  if (!currentAuthUser) return;
  const first = document.getElementById('setupFirst').value.trim();
  const last = document.getElementById('setupLast').value.trim();
  const age = Number(document.getElementById('setupAge').value);
  const gender = document.getElementById('setupGender').value;
  if (!first || !last || !age) return showAlert('Ошибка', 'Заполните все данные профиля', 'error');

  try {
    const card = await generateUniqueCard();
    const profile = {
      uid: currentAuthUser.uid,
      email: currentAuthUser.email,
      first,
      last,
      age,
      gender,
      card,
      balance: 0,
      status: 'active',
      role: isAdminEmail(currentAuthUser.email) ? 'admin' : 'user',
      appeal: null
    };

    const updates = {};
    updates[`users/${currentAuthUser.uid}`] = profile;
    updates[`cards/${card}`] = currentAuthUser.uid;
    await update(ref(db), updates);
    shouldShowWelcome = true;
  } catch (e) {
    showAlert('Ошибка', e.message, 'error');
  }
};

window.handleLogout = async () => {
  await signOut(auth);
};

window.formatCardInput = (el) => {
  const digits = normalizeCardNumber(el.value).slice(0, 16);
  el.value = formatCardNumber(digits);
  calcCommission();
};

window.calcCommission = () => {
  const amt = parseFloat(document.getElementById('txAmount').value) || 0;
  const box = document.getElementById('commissionBox');
  if (amt <= 0) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'flex';
  const comm = Math.ceil(amt * 0.01);
  document.getElementById('commAmt').innerText = `${comm.toLocaleString()} UZS`;
  document.getElementById('totalAmt').innerText = `${(amt + comm).toLocaleString()} UZS`;
};

window.handleTransfer = async () => {
  if (!currentAuthUser || !currentProfile) return;
  const targetCard = normalizeCardNumber(document.getElementById('txCard').value);
  const amt = parseFloat(document.getElementById('txAmount').value);

  if (isUserBlocked()) return showAlert('Карта заблокирована', 'Переводы отключены, а деньги временно заморожены до решения по разблокировке.', 'error');
  if (targetCard.length !== 16) return showAlert('Ошибка', 'Введите корректный номер карты', 'error');
  if (!amt || amt < 100) return showAlert('Ошибка', 'Минимальная сумма перевода 100 UZS', 'error');

  const comm = Math.ceil(amt * 0.01);
  const total = amt + comm;
  if ((currentProfile.balance || 0) < total) return showAlert('Недостаточно средств', 'Ваш баланс меньше суммы списания с учетом комиссии', 'error');
  if (targetCard === normalizeCardNumber(currentProfile.card)) return showAlert('Ошибка', 'Нельзя переводить самому себе', 'error');

  const cardSnap = await get(ref(db, `cards/${targetCard}`));
  if (!cardSnap.exists()) return showAlert('Ошибка', 'Получатель с такой картой не найден', 'error');

  const targetUid = cardSnap.val();
  const targetUserSnap = await get(ref(db, `users/${targetUid}`));
  if (!targetUserSnap.exists()) return showAlert('Ошибка', 'Профиль получателя не найден', 'error');
  const targetUser = targetUserSnap.val();

  const overlay = document.getElementById('txOverlay');
  const subtitle = document.getElementById('txSubtitle');
  overlay.classList.add('active');
  ['step1', 'step2', 'step3'].forEach(id => document.getElementById(id).className = 'tx-step');
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    document.getElementById('step1').classList.add('active');
    subtitle.innerText = 'Установка защищенного соединения...';
    await wait(200);
    document.getElementById('step1').className = 'tx-step done';
    document.getElementById('step2').classList.add('active');
    subtitle.innerText = 'Проверка карты получателя...';
    await wait(200);
    document.getElementById('step2').className = 'tx-step done';
    document.getElementById('step3').classList.add('active');
    subtitle.innerText = 'Выполнение перевода...';
    await wait(200);

    const txId = `${Date.now()}`;
    const now = Date.now();
    const updates = {};
    updates[`users/${currentAuthUser.uid}/balance`] = Number(currentProfile.balance || 0) - total;
    updates[`users/${targetUid}/balance`] = Number(targetUser.balance || 0) + amt;
    updates[`histories/${currentAuthUser.uid}/${txId}`] = { type: 'out', amt: total, desc: `Перевод на карту ${formatCardNumber(targetCard)}`, date: now };
    updates[`histories/${targetUid}/${txId}`] = { type: 'in', amt, desc: `Пополнение от ${currentProfile.first}`, date: now };
    await update(ref(db), updates);

    document.getElementById('step3').className = 'tx-step done';
    document.getElementById('txCard').value = '';
    document.getElementById('txAmount').value = '';
    calcCommission();
    showAlert('Успешно', `Перевод на сумму ${amt} UZS выполнен.`, 'success');
  } catch (e) {
    showAlert('Сбой', e.message || 'Ошибка банковского шлюза. Попробуйте позже.', 'error');
  } finally {
    setTimeout(() => overlay.classList.remove('active'), 220);
  }
};
window.openSettings = () => {
  if (!currentProfile) return;
  document.getElementById('setFirst').value = currentProfile.first || '';
  document.getElementById('setLast').value = currentProfile.last || '';
  document.getElementById('settingsCardNum').innerText = formatCardNumber(currentProfile.card);
  updateSettingsState();
  document.getElementById('settingsOverlay').classList.add('active');
};

window.closeSettings = () => {
  document.getElementById('settingsOverlay').classList.remove('active');
};

window.saveProfileName = async () => {
  if (!currentAuthUser || !currentProfile) return;
  if (isUserBlocked()) return blockRestrictedAction();
  const first = document.getElementById('setFirst').value.trim();
  const last = document.getElementById('setLast').value.trim();
  if (!first || !last) return showAlert('Ошибка', 'Поля не могут быть пустыми', 'error');
  await update(ref(db, `users/${currentAuthUser.uid}`), { first, last });
  showAlert('Обновлено', 'Личные данные успешно сохранены', 'success');
};

window.handleReissueCard = async () => {
  if (!currentAuthUser || !currentProfile) return;
  if (isUserBlocked()) return blockRestrictedAction();
  if (!confirm('Вы уверены? Номер карты изменится.')) return;

  try {
    const newCard = await generateUniqueCard();
    const oldCard = normalizeCardNumber(currentProfile.card);
    const updates = {};
    updates[`users/${currentAuthUser.uid}/card`] = newCard;
    updates[`cards/${newCard}`] = currentAuthUser.uid;
    updates[`cards/${oldCard}`] = null;
    await update(ref(db), updates);
    showAlert('Готово', 'Карта перевыпущена', 'success');
  } catch (e) {
    showAlert('Ошибка', e.message, 'error');
  }
};

window.saveNewPassword = async () => {
  if (!currentAuthUser) return;
  if (isUserBlocked()) return blockRestrictedAction();
  const p1 = document.getElementById('setNewPass').value;
  const p2 = document.getElementById('setNewPassConfirm').value;
  if (!p1 || p1.length < 4) return showAlert('Ошибка', 'Пароль слишком короткий', 'error');
  if (p1 !== p2) return showAlert('Ошибка', 'Пароли не совпадают', 'error');

  try {
    await updatePassword(currentAuthUser, p1);
    document.getElementById('setNewPass').value = '';
    document.getElementById('setNewPassConfirm').value = '';
    showAlert('Успешно', 'Пароль изменен', 'success');
  } catch (e) {
    showAlert('Ошибка', e.message, 'error');
  }
};

window.copyCardNumber = async () => {
  if (!currentProfile?.card) return showAlert('Ошибка', 'Номер карты недоступен', 'error');
  const copyBtn = document.getElementById('copyCardBtn');

  try {
    await navigator.clipboard.writeText(normalizeCardNumber(currentProfile.card));
    if (copyBtn) {
      const prevText = copyBtn.innerText;
      copyBtn.innerText = 'Copied';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.innerText = prevText;
        copyBtn.classList.remove('copied');
      }, 1500);
    }
    showAlert('Успешно', 'Номер карты скопирован', 'success');
  } catch (e) {
    showAlert('Ошибка', 'Не удалось скопировать номер карты', 'error');
  }
};

window.submitAppeal = async () => {
  if (!currentAuthUser || !currentProfile) return;
  if (!isUserBlocked()) return showAlert('Апелляция не нужна', 'Карта уже активна, ограничений по операциям нет.', 'info');
  const reason = document.getElementById('appealReason').value.trim();
  if (!reason) return showAlert('Ошибка', 'Опишите причину апелляции', 'error');

  await update(ref(db, `users/${currentAuthUser.uid}/appeal`), {
    status: 'pending',
    message: reason,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    adminComment: null
  });
  document.getElementById('appealReason').value = '';
  showAlert('Апелляция отправлена', 'Запрос передан администратору на рассмотрение.', 'success');
};

window.openAdmin = () => {
  if (!currentAuthUser || !(currentProfile?.role === 'admin' || isAdminEmail(currentAuthUser.email))) {
    showAlert('Ошибка', 'Доступ только для администратора', 'error');
    return;
  }
  subscribeAdminUsers();
  renderAdminUsers();
  renderAppealRequests();
  updateAdminStats();
  document.getElementById('adminOverlay').classList.add('active');
};

window.closeAdmin = () => {
  document.getElementById('adminOverlay').classList.remove('active');
  unsubscribeAdminUsers();
};

window.switchAdminTab = (panel, index) => {
  document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', i === index));
  document.getElementById('panelUsers').classList.toggle('active', panel === 'users');
  document.getElementById('panelRequests').classList.toggle('active', panel === 'requests');
  document.getElementById('panelSystem').classList.toggle('active', panel === 'system');
  if (panel === 'requests') renderAppealRequests();
};

function renderAdminUsers() {
  const list = document.getElementById('adminUserList');
  const users = Object.values(adminUsersMap || {});
  list.innerHTML = users.map(u => `
    <tr>
      <td>${u.first || ''} ${u.last || ''}<br><small style="color:var(--muted)">${u.email || ''}</small></td>
      <td style="font-family:'Space Mono'">${formatCardNumber(u.card || '')}</td>
      <td>${Number(u.balance || 0).toLocaleString()}</td>
      <td><span class="badge ${u.status === 'active' ? 'badge-active' : 'badge-blocked'}">${u.status || 'active'}</span></td>
      <td>
        <div class="user-actions">
          <button class="btn btn-sm btn-success" onclick="openAddMoney('${u.uid}')" title="Пополнить">💰</button>
          <button class="btn btn-sm ${u.status === 'active' ? 'btn-danger' : 'btn-success'}" onclick="toggleUserStatus('${u.uid}')">${u.status === 'active' ? 'Ban' : 'Unban'}</button>
          ${!isAdminEmail(u.email) ? `<button class="btn btn-sm btn-ghost" onclick="deleteUser('${u.uid}')">DEL</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function updateAdminStats() {
  const users = Object.values(adminUsersMap || {});
  document.getElementById('statUsers').innerText = users.length;
  const total = users.reduce((sum, u) => sum + Number(u.balance || 0), 0);
  document.getElementById('statTotal').innerText = `${total.toLocaleString()} UZS`;
}

function renderAppealRequests() {
  const container = document.getElementById('appealRequestsList');
  const requests = Object.values(adminUsersMap || {}).filter(u => u.appeal && u.appeal.status === 'pending');
  if (!requests.length) {
    container.className = 'request-empty';
    container.innerHTML = 'Запросов на апелляцию пока нет.';
    return;
  }
  container.className = '';
  container.innerHTML = requests.map(u => `
    <div class="request-card">
      <div class="request-head">
        <div>
          <strong>${u.first || ''} ${u.last || ''}</strong>
          <span>${u.email || ''}</span>
        </div>
        <span>${u.appeal?.createdAt ? new Date(u.appeal.createdAt).toLocaleString() : ''}</span>
      </div>
      <div class="request-meta">Карта: ${formatCardNumber(u.card || '')} | Баланс заморожен: ${Number(u.balance || 0).toLocaleString()} UZS</div>
      <div class="request-message">${u.appeal?.message || ''}</div>
      <div class="request-actions">
        <button class="btn btn-success btn-sm" onclick="resolveAppeal('${u.uid}','approve')">Разблокировать</button>
        <button class="btn btn-danger btn-sm" onclick="resolveAppeal('${u.uid}','reject')">Отклонить</button>
      </div>
    </div>
  `).join('');
}

window.resolveAppeal = async (uid, action) => {
  const user = adminUsersMap[uid];
  if (!user?.appeal) return;

  const appeal = action === 'approve'
    ? { ...user.appeal, status: 'approved', updatedAt: Date.now(), adminComment: 'Карта разблокирована. Ограничения сняты.' }
    : { ...user.appeal, status: 'rejected', updatedAt: Date.now(), adminComment: 'Запрос отклонён. Для пересмотра обратитесь в поддержку.' };

  const updates = { [`users/${uid}/appeal`]: appeal };
  if (action === 'approve') updates[`users/${uid}/status`] = 'active';
  await update(ref(db), updates);
  showAlert('Запрос обработан', action === 'approve' ? 'Карта пользователя разблокирована.' : 'Апелляция отклонена.', 'success');
};

window.openAddMoney = (uid) => {
  const user = adminUsersMap[uid];
  if (!user) return;
  activeMoneyUid = uid;
  document.getElementById('addMoneyLabel').innerText = `Пользователь: ${user.first || ''} ${user.last || ''}`;
  document.getElementById('addMoneyModal').classList.add('active');
};

window.closeAddMoneyModal = () => {
  document.getElementById('addMoneyModal').classList.remove('active');
  document.getElementById('addMoneyAmt').value = '';
};

window.confirmAddMoney = async () => {
  if (!activeMoneyUid) return;
  const amt = parseFloat(document.getElementById('addMoneyAmt').value);
  if (!amt || amt <= 0) return;

  const user = adminUsersMap[activeMoneyUid];
  if (!user) return;

  const txId = `${Date.now()}`;
  const updates = {};
  updates[`users/${activeMoneyUid}/balance`] = Number(user.balance || 0) + amt;
  updates[`histories/${activeMoneyUid}/${txId}`] = {
    type: 'in',
    amt,
    desc: 'Зачисление от системы (Admin)',
    date: Date.now()
  };
  await update(ref(db), updates);
  closeAddMoneyModal();
  showAlert('Баланс пополнен', `Зачислено ${amt} UZS`, 'success');
};

window.toggleUserStatus = async (uid) => {
  const user = adminUsersMap[uid];
  if (!user || isAdminEmail(user.email)) return;

  const nextStatus = user.status === 'active' ? 'blocked' : 'active';
  const updates = { [`users/${uid}/status`]: nextStatus };
  if (nextStatus === 'active' && user.appeal?.status === 'pending') {
    updates[`users/${uid}/appeal`] = {
      ...user.appeal,
      status: 'approved',
      updatedAt: Date.now(),
      adminComment: 'Карта разблокирована администратором вручную.'
    };
  }
  await update(ref(db), updates);
};

window.deleteUser = async (uid) => {
  const user = adminUsersMap[uid];
  if (!user || isAdminEmail(user.email)) return;
  if (!confirm('Удалить пользователя безвозвратно?')) return;

  const updates = {};
  updates[`users/${uid}`] = null;
  updates[`histories/${uid}`] = null;
  updates[`cards/${normalizeCardNumber(user.card)}`] = null;
  await update(ref(db), updates);
};

onAuthStateChanged(auth, (user) => {
  currentAuthUser = user;
  currentProfile = null;
  currentHistory = [];
  adminUsersMap = {};

  if (profileStop) {
    profileStop();
    profileStop = null;
  }
  if (historyStop) {
    historyStop();
    historyStop = null;
  }
  unsubscribeAdminUsers();

  if (!user) {
    document.getElementById('authError').innerText = '';
    showScreen('authScreen');
    return;
  }

  attachProfileListener(user.uid);
});

const cardScene = document.getElementById('cardScene');
const card = document.getElementById('humoCard');
if (cardScene && card) {
  let animationId = null;

  const resetCardTransform = () => {
    card.style.transform = 'perspective(1400px) translate3d(0, 0, 0) rotateX(0deg) rotateY(0deg) scale(1)';
    card.style.boxShadow = '0 28px 70px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.09)';
  };

  cardScene.addEventListener('mousemove', (e) => {
    if (!document.getElementById('dashScreen').classList.contains('active')) return;
    if (animationId) cancelAnimationFrame(animationId);

    animationId = requestAnimationFrame(() => {
      const rect = cardScene.getBoundingClientRect();
      const relativeX = (e.clientX - rect.left) / rect.width;
      const relativeY = (e.clientY - rect.top) / rect.height;
      const rotateY = (relativeX - 0.5) * 22;
      const rotateX = (0.5 - relativeY) * 18;
      const shiftX = (relativeX - 0.5) * 12;
      const shiftY = (relativeY - 0.5) * 10;

      card.style.transform = `perspective(1400px) translate3d(${shiftX}px, ${shiftY}px, 0) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`;
      card.style.boxShadow = `${-rotateY * 1.2}px ${rotateX * 1.6 + 28}px 70px rgba(0,0,0,0.58), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.09)`;
    });
  });

  cardScene.addEventListener('mouseleave', () => {
    if (animationId) cancelAnimationFrame(animationId);
    resetCardTransform();
  });

  resetCardTransform();
}
