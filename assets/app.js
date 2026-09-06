// 拿到拍拍印提供的「新人專屬 LINE 加好友網址」後，只要修改這一行。
// 範例：https://lin.ee/AbCd123
const WEDDING_CONFIG = { lineFriendUrl: '' };

const weddingStart = new Date('2026-10-09T14:00:00+08:00');

function updateCountdown() {
  const diff = weddingStart.getTime() - Date.now();
  if (diff <= 0) {
    document.querySelector('.countdown').innerHTML = '<span><strong>幸福進行中</strong></span>';
    return;
  }
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  document.querySelector('#days').textContent = days;
  document.querySelector('#hours').textContent = String(hours).padStart(2, '0');
  document.querySelector('#minutes').textContent = String(minutes).padStart(2, '0');
}

updateCountdown();
setInterval(updateCountdown, 60000);

const header = document.querySelector('.topbar');
const floatingCta = document.querySelector('.floating-cta');
function updateChrome() {
  header.classList.toggle('scrolled', window.scrollY > 30);
  floatingCta.style.opacity = window.scrollY > window.innerHeight * .55 ? '1' : '0';
  floatingCta.style.pointerEvents = window.scrollY > window.innerHeight * .55 ? 'auto' : 'none';
}
window.addEventListener('scroll', updateChrome, { passive: true });
updateChrome();

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: .12 });
document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

const modal = document.querySelector('#demo-modal');
const modalTitle = document.querySelector('#modal-title');
const modalMessage = document.querySelector('#modal-message');
let lastFocus;

function openModal(title, message) {
  lastFocus = document.activeElement;
  modalTitle.textContent = title;
  modalMessage.textContent = message;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  modal.querySelector('.modal-close').focus();
}

function closeModal() {
  modal.hidden = true;
  document.body.style.overflow = '';
  if (lastFocus) lastFocus.focus();
}

document.querySelectorAll('[data-demo-line]').forEach((button) => {
  button.addEventListener('click', () => {
    if (WEDDING_CONFIG.lineFriendUrl) {
      window.location.href = WEDDING_CONFIG.lineFriendUrl;
      return;
    }
    openModal(
      '拍拍印串接位置',
      '正式版取得你們的專屬LINE加入好友連結後，這個按鈕會直接開啟加入好友與出席回覆。'
    );
  });
});

if (WEDDING_CONFIG.lineFriendUrl) {
  const status = document.querySelector('#line-status');
  if (status) status.hidden = true;
}

document.querySelectorAll('[data-feature]').forEach((button) => {
  button.addEventListener('click', () => openModal(
    button.dataset.feature,
    `這是「${button.dataset.feature}」的入口示意；正式版將由拍拍印LINE提供實際功能。`
  ));
});

document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.hidden) closeModal(); });

const events = {
  ceremony: {
    title: '書平＆秋華｜佛前結婚儀式',
    start: '20261009T060000Z',
    end: '20261009T073000Z',
    location: '創價學會三重會館，新北市三重區重新路五段609巷2號3樓之1',
    description: '13:30入場，14:00開始。'
  },
  banquet: {
    title: '書平＆秋華｜幸福晚宴',
    start: '20261009T100000Z',
    end: '20261009T133000Z',
    location: '彭園三重館國際宴會B廳，新北市三重區龍門路6號4樓',
    description: '17:30入席，18:00開始。'
  }
};

function escapeIcs(text) {
  return text.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}

function downloadCalendar(key) {
  const event = events[key];
  const content = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ShupingQiuhua//Wedding//ZH-TW',
    'BEGIN:VEVENT', `UID:${key}-20261009@shuping-qiuhua-wedding`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${event.start}`, `DTEND:${event.end}`,
    `SUMMARY:${escapeIcs(event.title)}`, `LOCATION:${escapeIcs(event.location)}`,
    `DESCRIPTION:${escapeIcs(event.description)}`, 'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${key}-2026-10-09.ics`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('已建立行事曆檔案');
}

document.querySelectorAll('[data-calendar]').forEach((button) => {
  button.addEventListener('click', () => downloadCalendar(button.dataset.calendar));
});

let toastTimer;
function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}
