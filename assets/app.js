const WEDDING_CONFIG = { lineFriendUrl: 'https://lin.ee/Stg17uT' };

const weddingStart = new Date('2026-10-09T14:00:00+08:00');
const opening = document.querySelector('.opening');
const content = document.querySelector('#invitation-content');
const openButton = document.querySelector('#open-invitation');
const floatingLine = document.querySelector('.floating-line');

function openInvitation() {
  openButton.setAttribute('aria-expanded', 'true');
  opening.classList.add('opened');
  document.body.classList.remove('locked');
  content.hidden = false;
  window.setTimeout(() => content.scrollIntoView({ behavior: 'smooth' }), 420);
  window.setTimeout(() => floatingLine.hidden = false, 900);
}

openButton.addEventListener('click', openInvitation);

function updateCountdown() {
  const diff = weddingStart.getTime() - Date.now();
  if (diff <= 0) {
    document.querySelector('.countdown').innerHTML = '<p>幸福進行中</p>';
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

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('visible');
    observer.unobserve(entry.target);
  });
}, { threshold: .12 });
document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));

floatingLine.addEventListener('click', () => window.open(WEDDING_CONFIG.lineFriendUrl, '_blank', 'noopener'));

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
  const calendar = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ShupingQiuhua//Wedding//ZH-TW',
    'BEGIN:VEVENT', `UID:${key}-20261009@shuping-qiuhua-wedding`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${event.start}`, `DTEND:${event.end}`,
    `SUMMARY:${escapeIcs(event.title)}`, `LOCATION:${escapeIcs(event.location)}`,
    `DESCRIPTION:${escapeIcs(event.description)}`, 'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  const blob = new Blob([calendar], { type: 'text/calendar;charset=utf-8' });
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
