import './PlatformBridge.js';
// ============================================
// meye — Main Application Logic
// ============================================

// --- Deep Link Interceptor for Electron ---
(function() {
  const hash = window.location.hash;
  if (hash && hash.includes('access_token')) {
    const params = new URLSearchParams(hash.substring(1));
    if (params.get('state') === 'electron') {
      window.location.href = `meyeeapp://oauth${hash}`;
    }
  }

  if (navigator.userAgent.toLowerCase().includes('electron')) {
    document.body.classList.add('electron-desktop');
  }
})();

// --- Custom Dialog ---
const CustomDialog = {
  show(title, message, confirmBtnText = 'Discard', cancelBtnText = 'Cancel') {
    return new Promise((resolve) => {
      const overlay = document.getElementById('customDialogOverlay');
      const titleEl = document.getElementById('customDialogTitle');
      const msgEl = document.getElementById('customDialogMessage');
      const btnCancel = document.getElementById('customDialogCancel');
      const btnConfirm = document.getElementById('customDialogConfirm');

      titleEl.textContent = title;
      msgEl.textContent = message;
      btnConfirm.textContent = confirmBtnText;
      btnCancel.textContent = cancelBtnText;

      const cleanup = () => {
        btnCancel.removeEventListener('click', onCancel);
        btnConfirm.removeEventListener('click', onConfirm);
        overlay.classList.remove('is-active');
      };

      const onCancel = () => { cleanup(); resolve(false); };
      const onConfirm = () => { cleanup(); resolve(true); };

      btnCancel.addEventListener('click', onCancel);
      btnConfirm.addEventListener('click', onConfirm);

      overlay.classList.add('is-active');
    });
  }
};

// --- Overlay Manager ---

const OverlayManager = {
  stack: [],
  isPopping: false,
  ignorePopstate: 0,

  init() {
    window.addEventListener('popstate', (e) => {
      if (this.ignorePopstate > 0) {
        this.ignorePopstate--;
        return;
      }
      if (this.stack.length > 0) {
        this.isPopping = true;
        this.pop();
        this.isPopping = false;
      }
    });
  },
  
  async requestOpen(newObj) {
    if (this.stack.includes(newObj)) return true;
    
    // Check unsaved work on the current top overlay
    const current = this.stack[this.stack.length - 1];
    if (current && typeof current.hasUnsavedWork === 'function') {
      if (current.hasUnsavedWork()) {
        const proceed = await CustomDialog.show("Discard Changes?", "Current changes will be lost. Switch anyway?");
        if (!proceed) return false;
      }
    }
    
    this.stack.push(newObj);
    
    if (!this.isPopping) {
      history.pushState({ overlayOpen: true, index: this.stack.length }, '');
    }
    
    document.getElementById('appWrapper').classList.add('has-active-overlay');
    return true;
  },
  
  pop() {
    if (this.stack.length === 0) return;
    const closingObj = this.stack.pop();
    
    if (typeof closingObj.cancel === 'function') {
      closingObj.cancel();
    } else if (typeof closingObj.close === 'function') {
      closingObj.close();
    } else if (closingObj.page) {
      closingObj.page.classList.remove('is-active');
    } else if (closingObj.overlay) {
      closingObj.overlay.classList.remove('is-active');
    }
    
    if (this.stack.length === 0) {
      document.getElementById('appWrapper').classList.remove('has-active-overlay');
    }
    
    if (!this.isPopping) {
      this.ignorePopstate++;
      history.back();
    }
  },
  
  notifyClosed(obj) {
    const idx = this.stack.indexOf(obj);
    if (idx > -1) {
      const wasTop = (idx === this.stack.length - 1);
      this.stack.splice(idx, 1);
      
      if (this.stack.length === 0) {
        document.getElementById('appWrapper').classList.remove('has-active-overlay');
      }
      
      if (wasTop && !this.isPopping) {
        this.ignorePopstate++;
        history.back();
      }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  OverlayManager.init();
});

// --- Notification Manager ---
const NotificationManager = {
  activeBannerTimeout: null,
  notifiedSet: new Set(),
  
  async init() {
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        
        const showUpdateToast = () => {
          const toast = document.getElementById('updateToast');
          if (toast) {
            toast.classList.add('is-active');
            toast.onclick = () => {
              // Use reg.waiting at click-time — the worker has moved to waiting state
              const w = reg.waiting;
              if (w) w.postMessage({ type: 'SKIP_WAITING' });
            };
          }
          
          if (Notification.permission === 'granted') {
            new Notification('meyee Update Available', { 
              body: 'Tap to refresh and get the latest version.',
              tag: 'app-update'
            });
          }
        };
        
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateToast();
              }
            });
          }
        });
        
        // If a waiting worker already exists (e.g. after hard reload), show toast immediately
        if (reg.waiting && navigator.serviceWorker.controller) {
          showUpdateToast();
        }

        // A long-lived PWA needs to actively ask the browser for a newer
        // worker; otherwise an update can remain undiscovered for days.
        const checkForUpdate = () => reg.update().catch(() => {});
        window.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate();
        });
        setInterval(checkForUpdate, 60 * 60 * 1000);
        
        // Reload when the new worker takes over
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!refreshing) {
            refreshing = true;
            window.location.reload();
          }
        });
        
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'FORCE_RELOAD') {
            if (!refreshing) {
              refreshing = true;
              window.location.reload();
            }
          }
        });
        
      } catch(e) {
        console.warn('SW registration failed:', e);
      }
    }
    
    setInterval(() => this.check(), 10000);
    this.check();
    
    const closeBtn = document.getElementById('notifBannerClose');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hideBanner());
  },
  
  check() {
    // Only check if SettingsView is initialized and prefs are loaded
    if (!SettingsView || !SettingsView.prefs) return;
    
    const now = new Date();
    const todayStr = formatDateKey(now);
    const currentTimeMs = now.getTime();
    
    const offsetMins = SettingsView.prefs.defaultReminder === 'none' ? 0 : parseInt(SettingsView.prefs.defaultReminder) || 0;
    
    allCards.forEach(c => {
      if (c.checked) return;
      if (c.date !== todayStr && c.date !== 'daily') return;
      
      let targetH = null, targetM = null;
      if (c.reminderTime) {
        const parts = c.reminderTime.split(':');
        targetH = parseInt(parts[0]);
        targetM = parseInt(parts[1]);
      } else if (c.type === 'calendar' && c.eventTime) {
        const startRaw = c.eventTime.split('–')[0].trim();
        const parts = startRaw.split(':');
        targetH = parseInt(parts[0]);
        targetM = parseInt(parts[1]);
      }
      
      if (targetH !== null && targetM !== null) {
        const targetDate = new Date();
        targetDate.setHours(targetH, targetM, 0, 0);
        
        let notifTimeMs = targetDate.getTime() - (offsetMins * 60000);
        
        const diff = currentTimeMs - notifTimeMs;
        // Allow up to 5 minutes of latency for background throttling
        if (diff >= 0 && diff < 300000) {
          if (!this.notifiedSet.has(c.id)) {
            this.notifiedSet.add(c.id);
            this.trigger(c, offsetMins);
          }
        }
      }
    });
  },
  
  async scheduleAllNative() {
    try {
      const permission = await isPermissionGranted();
      if (!permission) {
        await requestPermission();
      }
      if (!(await isPermissionGranted())) return;
      
      await cancelAll(); // Clear existing
      
      if (!SettingsView || !SettingsView.prefs) return;
      
      const now = new Date();
      const todayStr = formatDateKey(now);
      const currentTimeMs = now.getTime();
      const offsetMins = SettingsView.prefs.defaultReminder === 'none' ? 0 : parseInt(SettingsView.prefs.defaultReminder) || 0;
      
      for (const c of allCards) {
        if (c.checked) continue;
        
        let targetH = null, targetM = null;
        if (c.reminderTime) {
          const parts = c.reminderTime.split(':');
          targetH = parseInt(parts[0]);
          targetM = parseInt(parts[1]);
        } else if (c.type === 'calendar' && c.eventTime) {
          const startRaw = c.eventTime.split('–')[0].trim();
          const parts = startRaw.split(':');
          targetH = parseInt(parts[0]);
          targetM = parseInt(parts[1]);
        }
        
        if (targetH !== null && targetM !== null) {
          const targetDate = new Date();
          // For future recurring cards, we might need to handle 'daily', but for MVP we schedule just today's
          if (c.date === todayStr || c.date === 'daily') {
            targetDate.setHours(targetH, targetM, 0, 0);
            const notifTimeMs = targetDate.getTime() - (offsetMins * 60000);
            
            // Only schedule if it's in the future
            if (notifTimeMs > currentTimeMs) {
              await sendNotification({
                title: c.text,
                body: c.type === 'calendar' ? 'Calendar Event starting soon' : 'Task Reminder',
                schedule: Schedule.at(new Date(notifTimeMs))
              });
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to schedule native notifications', e);
    }
  },

  trigger(card, offsetMins) {
    const title = card.content;
    let desc = '';
    
    if (card.type === 'calendar' && card.eventTime) desc = `${card.eventTime}`;
    else if (card.reminderTime) desc = `${card.reminderTime}`;
    
    if (offsetMins > 0) desc += ` (starts in ${offsetMins}m)`;
    
    this.playSound();
    
    if ('Notification' in window && Notification.permission === 'granted') {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title, { body: desc, tag: card.id });
        });
      } else {
        new Notification(title, { body: desc });
      }
    }
    
    this.showBanner(title, desc);
  },
  
  playSound() {
    const sound = SettingsView.prefs.notifSound || 'default';
    if (sound === 'none') return;
    
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    if (sound === 'synth') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.5);
    } else if (sound === 'chime') {
      [0, 0.2].forEach(delay => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1000, ctx.currentTime + delay);
        gain.gain.setValueAtTime(0, ctx.currentTime + delay);
        gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + delay + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + 0.3);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.3);
      });
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.5);
    }
  },
  
  showBanner(title, desc) {
    const banner = document.getElementById('notifBanner');
    if (!banner) return;
    document.getElementById('notifBannerTitle').textContent = title;
    const dEl = document.getElementById('notifBannerDesc');
    dEl.textContent = desc;
    
    const style = SettingsView.prefs.bannerStyle || 'minimal';
    dEl.style.display = style === 'full' ? 'block' : 'none';
    
    banner.classList.add('is-active');
    
    if (this.activeBannerTimeout) clearTimeout(this.activeBannerTimeout);
    this.activeBannerTimeout = setTimeout(() => {
      this.hideBanner();
    }, 6000);
  },
  
  hideBanner() {
    const banner = document.getElementById('notifBanner');
    if (banner) banner.classList.remove('is-active');
  }
};

// --- Date Utilities ---

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];
const WEEKDAYS_FULL = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
];

function formatDate(date) {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatGroupHeader(date, today) {
  const todayKey = formatDateKey(today);
  const dateKey = formatDateKey(date);
  if (todayKey === dateKey) return 'Today';

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (formatDateKey(yesterday) === dateKey) return 'Yesterday';

  return `${WEEKDAYS_FULL[date.getDay()]}, ${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

function getWeekDates(centerDate) {
  const dates = [];
  const day = centerDate.getDay(); // 0=Sun
  // Start from Monday
  const monday = new Date(centerDate);
  monday.setDate(centerDate.getDate() - ((day + 6) % 7));

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d);
  }
  return dates;
}

// ============================================
// Tour / Onboarding Manager
// ============================================
const TourManager = {
  currentSlide: 0,
  totalSlides: 9,
  touchStartX: 0,
  
  init() {
    const isComplete = localStorage.getItem('meyeTourComplete');
    const onboarding = document.getElementById('onboardingPage');
    
    if (isComplete === 'true') {
      onboarding.classList.remove('is-active');
      onboarding.style.display = 'none';
      NotificationManager.init();
      return;
    }
    
    onboarding.classList.add('is-active');
    
    document.getElementById('btnSkipTour').addEventListener('click', () => {
      this.finish();
      NotificationManager.init();
    });

    document.getElementById('btnTourNext').addEventListener('click', () => {
      this.next();
    });

    const btnGoogle = document.getElementById('btnTourGoogleSync');
    if (btnGoogle) {
      btnGoogle.addEventListener('click', () => {
        document.getElementById('settingsGoogleCalOverlay').style.display = 'flex';
      });
    }

    const btnGitHub = document.getElementById('btnTourGitHubSync');
    if (btnGitHub) {
      btnGitHub.addEventListener('click', () => {
        document.getElementById('settingsGitHubOverlay').style.display = 'flex';
      });
    }

    const btnFinish = document.getElementById('btnTourFinish');
    if (btnFinish) {
      btnFinish.addEventListener('click', () => {
        this.finish();
        NotificationManager.init();
      });
    }

    // Swipe gestures
    const slidesContainer = document.getElementById('tourSlides');
    slidesContainer.addEventListener('touchstart', (e) => {
      this.touchStartX = e.changedTouches[0].screenX;
    }, {passive: true});

    slidesContainer.addEventListener('touchend', (e) => {
      const touchEndX = e.changedTouches[0].screenX;
      const deltaX = this.touchStartX - touchEndX;
      
      if (deltaX > 50) {
        this.next(); // swipe left -> next
      } else if (deltaX < -50) {
        this.prev(); // swipe right -> prev
      }
    }, {passive: true});
  },
  
  prev() {
    if (this.currentSlide <= 0) return;
    
    // Hide current
    const currentEl = document.querySelector(`.tour-slide[data-slide="${this.currentSlide}"]`);
    if (currentEl) {
      currentEl.classList.remove('is-active');
      currentEl.style.opacity = '0';
      currentEl.style.transform = 'translateX(40px)';
    }
    
    this.currentSlide--;
    
    // Show prev
    const prevEl = document.querySelector(`.tour-slide[data-slide="${this.currentSlide}"]`);
    if (prevEl) {
      prevEl.classList.add('is-active');
      prevEl.style.opacity = '1';
      prevEl.style.transform = 'translateX(0)';
    }
    
    this.updateUI();
  },

  next() {
    if (this.currentSlide >= this.totalSlides - 1) {
      this.finish();
      return;
    }
    
    // Hide current
    const currentEl = document.querySelector(`.tour-slide[data-slide="${this.currentSlide}"]`);
    if (currentEl) {
      currentEl.classList.remove('is-active');
      currentEl.style.opacity = '0';
      currentEl.style.transform = 'translateX(-40px)';
    }
    
    this.currentSlide++;
    
    // Show next
    const nextEl = document.querySelector(`.tour-slide[data-slide="${this.currentSlide}"]`);
    if (nextEl) {
      nextEl.classList.add('is-active');
      nextEl.style.opacity = '1';
      nextEl.style.transform = 'translateX(0)';
    }
    
    this.updateUI();
  },

  updateUI() {
    // Update button text
    const btn = document.getElementById('btnTourNext');
    if (this.currentSlide === this.totalSlides - 1) {
      btn.textContent = 'Get Started';
    } else {
      btn.textContent = 'Next';
    }

    // Update dots
    const dots = document.querySelectorAll('.tour-dot');
    dots.forEach((dot, index) => {
      if (index === this.currentSlide) {
        dot.classList.add('is-active');
      } else {
        dot.classList.remove('is-active');
      }
    });
  },
  
  finish() {
    localStorage.setItem('meyeTourComplete', 'true');
    const onboarding = document.getElementById('onboardingPage');
    onboarding.style.opacity = '0';
    onboarding.style.pointerEvents = 'none';
    setTimeout(() => {
      onboarding.classList.remove('is-active');
      onboarding.style.display = 'none';
    }, 400);
  }
};

// --- Mock Data ---

// Mock cards removed
// --- Rendering ---

function renderDateStrip(weekDates, selectedDate, cardsData) {
  const track = document.getElementById('dateStripTrack');
  const selectedKey = formatDateKey(selectedDate);

  // Find which dates have cards
  const datesWithCards = new Set(cardsData.map(c => c.date));
  const hasDaily = datesWithCards.has('daily');

  track.innerHTML = weekDates.map(date => {
    const key = formatDateKey(date);
    const isSelected = key === selectedKey;
    const isToday = key === formatDateKey(new Date());
    const dayIndex = date.getDay();
    // Use Mon=M, Tue=T, Wed=W, Thu=T, Fri=F, Sat=S, Sun=S
    const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    return `
      <button type="button" class="date-cell ${isSelected ? 'date-cell--selected' : ''}"
           data-date="${key}" aria-pressed="${isSelected}">
        <span class="date-day">${dayLabels[dayIndex]}</span>
        <span class="date-num">${date.getDate()}</span>
        <span class="date-dot" style="opacity: ${isToday ? '1' : '0'}; background: var(--text-primary);"></span>
      </button>
    `;
  }).join('');
}

function renderCardFeed(cardsData, selectedDate, today) {
  const feed = document.getElementById('cardFeed');
  const selectedKey = formatDateKey(selectedDate);
  
  const filteredCards = cardsData.filter(c => c.date === selectedKey || c.date === 'daily');
  const allTimeCards = cardsData.filter(c => c.date === null && c.type === 'todo');

  if (filteredCards.length === 0 && allTimeCards.length === 0) {
    feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✦</div>
        <div class="empty-state-text">Nothing here yet.<br>Start by tapping below.</div>
      </div>
    `;
    return;
  }

  let html = '';
  filteredCards.forEach((card, idx) => {
    html += renderCard(card, idx);
  });

  if (allTimeCards.length > 0) {
    html += `<div style="font-size: 13px; font-weight: 600; color: var(--text-tertiary); padding: 16px 0 8px 0; letter-spacing: 0.2px;">Anytime</div>`;
    allTimeCards.forEach((card, idx) => {
      html += renderCard(card, filteredCards.length + idx);
    });
  }

  feed.innerHTML = html;
}

function renderCard(card, index) {
  const metaHtml = buildCardMeta(card);
  const contentHtml = buildCardContent(card);
  const tagsHtml = buildCardTags(card);

  return `
    <div class="card card--${card.type}" data-card-id="${card.id}" style="animation-delay: ${index * 0.06}s">
      ${metaHtml}
      ${contentHtml}
      ${tagsHtml}
    </div>
  `;
}

function buildCardMeta(card) {
  let timeStr = '';
  if (card.type === 'todo' && card.reminderTime) {
    timeStr = `<span class="card-time" style="display: flex; align-items: center; gap: 4px;"><iconify-icon icon="solar:bell-linear" width="16" height="16"></iconify-icon>${card.reminderTime}</span>`;
  } else if (card.type === 'calendar' && card.eventTime) {
    timeStr = `<span class="card-time" style="display: flex; align-items: center; gap: 4px;"><iconify-icon icon="solar:calendar-linear" width="16" height="16"></iconify-icon>${card.eventTime}</span>`;
  } else if (card.type === 'routine') {
    timeStr = `<span class="card-time" style="display: flex; align-items: center; gap: 4px;"><iconify-icon icon="solar:refresh-circle-linear" width="16" height="16"></iconify-icon>Daily</span>`;
  }

  if (!timeStr) return '';

  return `
    <div class="card-meta">
      ${timeStr}
    </div>
  `;
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag])
  );
}

function buildCardContent(card) {
  const safeContent = escapeHTML(card.content);
  if (card.type === 'todo' || card.type === 'routine') {
    const checkedClass = card.checked ? 'checkbox--checked' : '';
    const checkSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    return `
      <div class="card-checkbox">
        <div class="checkbox ${checkedClass}" data-checked="${card.checked}">${checkSvg}</div>
        <span class="card-content" style="${card.checked ? 'text-decoration: line-through; opacity: 0.5;' : ''}">${safeContent}</span>
      </div>
    `;
  }

  return `<div class="card-content">${safeContent}</div>`;
}

function buildCardTags(card) {
  if (!card.tags || card.tags.length === 0) return '';

  const chips = card.tags.map(tag =>
    `<span class="chip">${tag}</span>`
  ).join('');

  const more = card.extraTags > 0
    ? `<span class="chip chip--more">+${card.extraTags}</span>`
    : '';

  return `<div class="card-tags">${chips}${more}</div>`;
}

// --- State & Interactions ---

function loadCards() {
  const data = localStorage.getItem('meyeCards');
  if (data) {
    try { return JSON.parse(data); } catch(e) {}
  }
  return [];
}

function syncAndSave() {
  localStorage.setItem('meyeCards', JSON.stringify(allCards));
  if (typeof SyncManager !== 'undefined') {
    SyncManager.syncToGitHub();
  }
  if (typeof NotificationManager !== 'undefined' && window.__TAURI_INTERNALS__) {
    NotificationManager.scheduleAllNative().catch(console.error);
  }
}

function formatTime(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return '';
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

// Track dates
let currentDate = new Date();
let selectedDate = new Date();
let allCards = loadCards();

async function init() {
  // Set header date
  document.getElementById('headerDate').textContent = formatDate(currentDate);
  document.getElementById('headerDateWrapper').addEventListener('click', () => {
    ScheduleSheet.openForDateJump(formatDateKey(selectedDate), (res) => {
      if (res.date) {
        const parts = res.date.split('-');
        selectedDate = new Date(+parts[0], +parts[1] - 1, +parts[2]);
        document.getElementById('headerDate').textContent = formatDate(selectedDate);
        renderDateStrip(getWeekDates(selectedDate), selectedDate, allCards);
        renderCardFeed(allCards, selectedDate, currentDate);
        bindDateStripEvents();
      }
    });
  });

  // Render date strip
  const weekDates = getWeekDates(selectedDate);
  renderDateStrip(weekDates, selectedDate, allCards);

  // Render card feed
  renderCardFeed(allCards, selectedDate, currentDate);

  // Bind events
  bindDateStripEvents();
  bindCardEvents();
  bindInputBarEvents();

  // Initialize new components
  ScheduleSheet.init();
  NotificationEngine.init();
  StatsManager.init();
  HeatmapView.init();
  TourManager.init();
  SettingsView.init();
  await SyncManager.init();

  // Track active overlays for desktop split view
  const appSide = document.getElementById('appSide');
  const appWrapper = document.getElementById('appWrapper');
  if (appSide && appWrapper) {
    const observer = new MutationObserver(() => {
      const hasActive = appSide.querySelector('.full-page-view.is-active, .composer-overlay.is-open, .speaking-overlay.is-active, .review-overlay.is-active, .expanded-overlay.is-active') !== null;
      appWrapper.classList.toggle('has-active-overlay', hasActive);
    });
    observer.observe(appSide, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }
}

function bindDateStripEvents() {
  const track = document.getElementById('dateStripTrack');
  if (track.dataset.eventsBound === 'true') return;
  track.dataset.eventsBound = 'true';

  track.addEventListener('click', (e) => {
    const cell = e.target.closest('.date-cell');
    if (!cell) return;

    const dateKey = cell.dataset.date;
    const parts = dateKey.split('-');
    selectedDate = new Date(+parts[0], +parts[1] - 1, +parts[2]);

    // Update header date
    document.getElementById('headerDate').textContent = formatDate(selectedDate);

    // Re-render strip
    const weekDates = getWeekDates(selectedDate);
    renderDateStrip(weekDates, selectedDate, allCards);

    // Filter cards for selected date (show all cards from that date onward)
    renderCardFeed(allCards, selectedDate, currentDate);

  });

  // Keyboard navigation
  track.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.target.click();
    }
  });
}

function bindCardEvents() {
  const feed = document.getElementById('cardFeed');

  feed.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;

    // Check if clicking checkbox
    const checkbox = e.target.closest('.checkbox');
    if (checkbox) {
      const isChecked = checkbox.dataset.checked === 'true';
      checkbox.dataset.checked = !isChecked;
      checkbox.classList.toggle('checkbox--checked');
      
      const cardId = card.dataset.cardId;
      const cardData = allCards.find(c => String(c.id) === cardId);
      if (cardData) {
        cardData.checked = !isChecked;
        // Log to StatsManager if it's a daily task or routine
        if (cardData.date === 'daily' || cardData.type === 'routine') {
          StatsManager.logCompletion(cardData.content, !isChecked);
        }
        syncAndSave();
      }

      const content = card.querySelector('.card-content');
      
      if (!isChecked) {
        content.style.textDecoration = 'line-through';
        content.style.opacity = '0.5';
      } else {
        content.style.textDecoration = 'none';
        content.style.opacity = '1';
      }
      return;
    }

    // Card tap — open expanded view
    card.style.transition = 'transform 0.1s ease';
    card.style.transform = 'scale(0.97)';
    setTimeout(() => {
      card.style.transform = '';
      ExpandedCardView.open(card.dataset.cardId);
    }, 100);
  });
}

// ============================================
// Expanded Card View
// ============================================

const ExpandedCardView = {
  overlay: null,
  btnBack: null,
  editorBox: null,
  tagsBox: null,
  dateEl: null,
  currentCard: null,
  btnMenuCard: null,
  menuElement: null,
  menuCopy: null,
  menuDelete: null,
  menuEdit: null,
  menuTranscript: null,

  init() {
    this.overlay = document.getElementById('expandedOverlay');
    this.btnBack = document.getElementById('btnExpandedBack');
    this.editorBox = document.getElementById('expandedEditorBox');
    this.tagsBox = document.getElementById('expandedTags');
    this.dateEl = document.getElementById('expandedDate');

    this.btnMenuCard = document.getElementById('btnMenuCard');
    this.menuElement = document.getElementById('expandedMenu');
    this.menuCopy = document.getElementById('menuCopy');
    this.menuDelete = document.getElementById('menuDelete');
    this.menuEdit = document.getElementById('menuEdit');
    this.menuTranscript = document.getElementById('menuTranscript');

    this._bindEvents();
  },

  _bindEvents() {
    this.btnBack.addEventListener('click', () => this.close());
    
    // Toggle Menu
    this.btnMenuCard.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = this.menuElement.style.display === 'flex';
      this.menuElement.style.display = isVisible ? 'none' : 'flex';
    });

    // Close menu when clicking outside
    document.addEventListener('click', () => {
      if (this.menuElement.style.display === 'flex') {
        this.menuElement.style.display = 'none';
      }
    });
    this.menuElement.addEventListener('click', (e) => e.stopPropagation());

    this.menuDelete.addEventListener('click', () => {
      if (!this.currentCard) return;
      const idx = allCards.findIndex(c => c.id === this.currentCard.id);
      if (idx > -1) {
        if (allCards[idx].type === 'calendar') {
          SyncManager.deleteFromGoogleCalendar(allCards[idx].id);
        }
        allCards.splice(idx, 1);
        syncAndSave();
        renderCardFeed(allCards, selectedDate, currentDate);
        renderDateStrip(getWeekDates(selectedDate), selectedDate, allCards);
      }
      this.menuElement.style.display = 'none';
      this.close();
    });

    this.menuCopy.addEventListener('click', () => {
      if (!this.currentCard) return;
      navigator.clipboard.writeText(this.currentCard.content);
      const originalText = this.menuCopy.innerText;
      this.menuCopy.innerText = 'Copied!';
      setTimeout(() => { this.menuCopy.innerText = originalText; this.menuElement.style.display = 'none'; }, 1000);
    });

    this.menuEdit.addEventListener('click', () => {
      this.menuElement.style.display = 'none';
      const input = document.getElementById('editContent');
      if (input) input.focus();
    });

    this.menuTranscript.addEventListener('click', () => {
      this.menuElement.style.display = 'none';
      if (this.currentCard && this.currentCard.transcript) {
        // Just show an alert for now, or could open a custom modal
        alert("Transcript:\n\n" + this.currentCard.transcript);
      }
    });

    // Save changes when closing
    this.overlay.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'transform' && !this.overlay.classList.contains('is-active')) {
        this.saveChanges();
      }
    });
  },

  async open(cardId) {
    const proceed = await OverlayManager.requestOpen(this);
    if (!proceed) return;
    this.currentCard = allCards.find(c => String(c.id) === String(cardId));
    if (!this.currentCard) {
      OverlayManager.notifyClosed(this);
      return;
    }

    if (!this.currentCard.transcript) {
      this.menuTranscript.style.opacity = '0.3';
      this.menuTranscript.style.pointerEvents = 'none';
    } else {
      this.menuTranscript.style.opacity = '1';
      this.menuTranscript.style.pointerEvents = 'auto';
    }

    // Set Date
    if (this.currentCard.date && this.currentCard.date !== 'daily') {
      const dPart = this.currentCard.date.split('-');
      const d = new Date(dPart[0], dPart[1]-1, dPart[2]);
      const options = { month: 'long', day: 'numeric' };
      if (this.dateEl) {
        this.dateEl.textContent = d.toLocaleDateString('en-US', options);
        this.dateEl.style.display = 'block';
      }
    } else if (this.currentCard.date === 'daily') {
      if (this.dateEl) {
        this.dateEl.textContent = 'Daily';
        this.dateEl.style.display = 'block';
      }
    } else {
      if (this.dateEl) {
        this.dateEl.textContent = 'Anytime';
        this.dateEl.style.display = 'block';
      }
    }

    this.renderEditor();
    
    // Render Tags
    if (this.tagsBox) {
      this.tagsBox.innerHTML = (this.currentCard.tags || []).map(t => `<span class="tag">${t}</span>`).join('');
    }

    if (this.overlay) this.overlay.classList.add('is-active');
  },

  close() {
    this.saveChanges();
    this.overlay.classList.remove('is-active');
    OverlayManager.notifyClosed(this);
  },

  renderEditor() {
    const c = this.currentCard;
    let html = '';

    if (c.type === 'note') {
      this.dateEl.style.display = 'none';
      html = `
        <div class="expanded-card--note">
          <span class="expanded-date-note">${c.dateLabel || c.date}</span>
          <textarea class="note-title" id="editContent" rows="2" placeholder="Title..." oninput="this.style.height='';this.style.height=this.scrollHeight+'px'">${c.content}</textarea>
          <textarea class="note-body" id="editDetails" placeholder="Start typing..." oninput="this.style.height='';this.style.height=this.scrollHeight+'px'">${c.details || ''}</textarea>
        </div>
      `;
    }
    else if (c.type === 'todo') {
      this.dateEl.style.display = 'none';
      let dateStr = 'Anytime';
      if (c.date) {
        const dPart = c.date.split('-');
        const d = new Date(dPart[0], dPart[1]-1, dPart[2]);
        dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      }
      let timeDisplay = '+ Add time';
      if (c.reminderTime) {
        const [hh, mm] = c.reminderTime.split(':').map(Number);
        timeDisplay = `${hh % 12 || 12}:${String(mm).padStart(2,'0')} ${hh >= 12 ? 'PM' : 'AM'}`;
      }
      html = `
        <div class="exp-todo-view">
          <textarea class="exp-todo-title" id="editContent" rows="1" oninput="this.style.height='';this.style.height=this.scrollHeight+'px'" placeholder="Task...">${c.content}</textarea>
          <button type="button" class="exp-todo-field" id="todoDateBtn" aria-label="Edit task date">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span class="exp-todo-field-text" id="displayTodoDate">${dateStr}</span>
          </button>
          <button type="button" class="exp-todo-field" id="todoTimeBtn" aria-label="Edit task time">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span class="exp-todo-field-text ${c.reminderTime ? '' : 'exp-todo-field-empty'}" id="displayTodoTime">${timeDisplay}</span>
          </button>
          ${c.details ? `<p class="exp-todo-note">${c.details}</p>` : ''}
        </div>
      `;
    }
    else if (c.type === 'calendar') {
      let dateStr = 'Anytime';
      if (c.date) {
        const dPart = c.date.split('-');
        const d = new Date(dPart[0], dPart[1] - 1, dPart[2]);
        dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      }
      const [startRaw = '', endRaw = ''] = (c.eventTime || '').split('–').map(value => value.trim());
      html = `
        <div class="exp-cal-view">
          <textarea class="exp-todo-title" id="editContent" rows="1" oninput="this.style.height='';this.style.height=this.scrollHeight+'px'" placeholder="Event...">${c.content}</textarea>
          <button type="button" class="exp-todo-field" id="calDateBtn" aria-label="Edit event date">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span class="exp-todo-field-text" id="displayCalDate">${dateStr}</span>
          </button>
          <div style="display:flex; gap:16px;">
            <button type="button" class="exp-todo-field" id="calStartTimeBtn" style="flex:1;" aria-label="Edit event start time">
              <span class="exp-todo-field-text" id="displayCalStartTime" style="color: ${startRaw ? 'var(--text-primary)' : 'var(--text-tertiary)'}">${formatTime(startRaw) || 'Start time'}</span>
            </button>
            <button type="button" class="exp-todo-field" id="calEndTimeBtn" style="flex:1;" aria-label="Edit event end time">
              <span class="exp-todo-field-text" id="displayCalEndTime" style="color: ${endRaw ? 'var(--text-primary)' : 'var(--text-tertiary)'}">${formatTime(endRaw) || 'End time'}</span>
            </button>
          </div>
          <div class="exp-todo-field">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <input class="exp-todo-field-text" type="text" id="editLocation" placeholder="Add location" value="${c.location || ''}" style="background:transparent; border:none; outline:none; font-family:inherit;">
          </div>
          <div class="exp-todo-field">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <input class="exp-todo-field-text" type="url" id="editLink" placeholder="Add meeting link" value="${c.meetLink || ''}" style="background:transparent; border:none; outline:none; font-family:inherit;">
          </div>
        </div>
      `;
    }
    else if (c.type === 'routine') {
      this.dateEl.style.display = 'none';
      const items = c.subItems && c.subItems.length > 0 ? c.subItems : [];
      html = `
        <div class="exp-routine-view">
          <textarea class="exp-routine-title" id="editContent" rows="1" oninput="this.style.height='';this.style.height=this.scrollHeight+'px'" placeholder="Routine name...">${c.content}</textarea>
          <ul class="exp-routine-list" id="routineItems">
            ${items.map((item, i) => {
              const text = typeof item === 'object' ? item.text : item;
              const meta = typeof item === 'object' ? item.meta || '' : '';
              const done = typeof item === 'object' && item.done;
              return `<li class="exp-routine-item" data-index="${i}">
                <button class="exp-routine-check ${done ? 'is-done' : ''}" aria-label="Toggle">
                  ${done ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                </button>
                <div style="display:flex; flex:1; align-items:center; gap:8px;">
                  <input type="text" class="exp-routine-item-input" value="${text}" placeholder="Task...">
                  <input type="text" class="exp-routine-item-meta" value="${meta}" placeholder="e.g. 3x15" style="width: 60px; font-size: 13px; color: rgba(255,255,255,0.4); background: transparent; border: none; outline: none; text-align: right; flex-shrink: 0;">
                </div>
                <button class="exp-routine-delete" aria-label="Remove">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </li>`;
            }).join('')}
          </ul>
          <button class="exp-routine-add" id="btnAddRoutineItem">+ Add exercise</button>
        </div>
      `;
    }

    this.editorBox.innerHTML = html;
    this._bindEditorEvents();

    setTimeout(() => {
      ['editContent','editDetails'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.tagName === 'TEXTAREA') { el.style.height = ''; el.style.height = el.scrollHeight + 'px'; }
      });
    }, 0);
  },

  _bindEditorEvents() {
    const c = this.currentCard;
    if (c.type === 'todo' || c.type === 'calendar') {
      const onScheduleSave = (res) => {
        c.date = res.date;
        if (c.type === 'todo') {
          c.reminderTime = res.start;
          if (res.date && res.date !== 'daily') {
             const dt = new Date(res.date.split('-')[0], res.date.split('-')[1]-1, res.date.split('-')[2]);
             document.getElementById('displayTodoDate').textContent = dt.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
             document.getElementById('displayTodoDate').classList.remove('exp-todo-field-empty');
          } else {
             document.getElementById('displayTodoDate').textContent = 'Daily';
             document.getElementById('displayTodoDate').classList.remove('exp-todo-field-empty');
          }
          if (res.start) {
             const [hh, mm] = res.start.split(':').map(Number);
             document.getElementById('displayTodoTime').textContent = `${hh % 12 || 12}:${String(mm).padStart(2,'0')} ${hh >= 12 ? 'PM' : 'AM'}`;
             document.getElementById('displayTodoTime').classList.remove('exp-todo-field-empty');
          } else {
             document.getElementById('displayTodoTime').textContent = 'No reminder';
             document.getElementById('displayTodoTime').classList.add('exp-todo-field-empty');
          }
        } else if (c.type === 'calendar') {
          c.eventTime = `${res.start || ''} – ${res.end || ''}`;
          if (res.date) {
             const dt = new Date(res.date.split('-')[0], res.date.split('-')[1]-1, res.date.split('-')[2]);
             document.getElementById('displayCalDate').textContent = dt.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
          }
          if (res.start) {
             const [hh, mm] = res.start.split(':').map(Number);
             document.getElementById('displayCalStartTime').textContent = `${hh % 12 || 12}:${String(mm).padStart(2,'0')} ${hh >= 12 ? 'PM' : 'AM'}`;
             document.getElementById('displayCalStartTime').style.color = 'var(--text-primary)';
          }
          if (res.end) {
             const [hh, mm] = res.end.split(':').map(Number);
             document.getElementById('displayCalEndTime').textContent = `${hh % 12 || 12}:${String(mm).padStart(2,'0')} ${hh >= 12 ? 'PM' : 'AM'}`;
             document.getElementById('displayCalEndTime').style.color = 'var(--text-primary)';
          }
        }
      };

      if (c.type === 'todo') {
        document.getElementById('todoDateBtn')?.addEventListener('click', () => {
          ScheduleSheet.openForCard(c, onScheduleSave);
        });
        document.getElementById('todoTimeBtn')?.addEventListener('click', () => {
          ScheduleSheet.openForCard(c, onScheduleSave);
        });
      } else if (c.type === 'calendar') {
        document.getElementById('calDateBtn')?.addEventListener('click', () => {
          ScheduleSheet.openForCard(c, onScheduleSave);
        });
        document.getElementById('calStartTimeBtn')?.addEventListener('click', () => {
          ScheduleSheet.openForCard(c, onScheduleSave);
        });
        document.getElementById('calEndTimeBtn')?.addEventListener('click', () => {
          ScheduleSheet.openForCard(c, onScheduleSave);
        });
      }
    } else if (c.type === 'routine') {
      const list = document.getElementById('routineItems');
      const addBtn = document.getElementById('btnAddRoutineItem');

      list?.addEventListener('click', (e) => {
        const chk = e.target.closest('.exp-routine-check');
        if (chk) {
          const wasDone = chk.classList.contains('is-done');
          chk.classList.toggle('is-done');
          chk.innerHTML = !wasDone
            ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
            : '';
          
          // Actually, we should log the specific routine sub-task if they want granular tracking.
          // Or if they mean the whole routine, it's done via the feed. The user said "calisthenics" which is the parent routine title.
          // Let's log the parent card content if they check a sub-item, wait... no, if they check off the parent, we log it.
          // I will leave this sub-item logic alone and just rely on the main feed checkbox for tracking the whole routine.
        }
        const del = e.target.closest('.exp-routine-delete');
        if (del) del.closest('.exp-routine-item')?.remove();
      });

      addBtn?.addEventListener('click', () => {
        const li = document.createElement('li');
        li.className = 'exp-routine-item';
        li.innerHTML = `
          <button class="exp-routine-check" aria-label="Toggle"></button>
          <div style="display:flex; flex:1; align-items:center; gap:8px;">
            <input type="text" class="exp-routine-item-input" placeholder="Task...">
            <input type="text" class="exp-routine-item-meta" placeholder="e.g. 3x15" style="width: 60px; font-size: 13px; color: rgba(255,255,255,0.4); background: transparent; border: none; outline: none; text-align: right; flex-shrink: 0;">
          </div>
          <button class="exp-routine-delete" aria-label="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        `;
        list.appendChild(li);
        li.querySelector('.exp-routine-item-input').focus();
      });
    }
  },

  saveChanges() {
    if (!this.currentCard) return;
    const c = this.currentCard;

    const titleEl = document.getElementById('editContent');
    if (titleEl) c.content = (titleEl.value || titleEl.textContent || '').trim();

    if (c.type === 'note') {
      const body = document.getElementById('editDetails');
      if (body) c.details = body.value;
    }
    else if (c.type === 'todo') {
      // time/date are updated immediately in onPickerSave
    }
    else if (c.type === 'calendar') {
      const loc = document.getElementById('editLocation');
      const lnk = document.getElementById('editLink');
      if (loc) c.location = loc.value;
      if (lnk) c.meetLink = lnk.value;
      SyncManager.pushToGoogleCalendar(c);
    }
    else if (c.type === 'routine') {
      const items = document.querySelectorAll('.exp-routine-item');
      c.subItems = Array.from(items).map(li => ({
        text: li.querySelector('.exp-routine-item-input')?.value || '',
        meta: li.querySelector('.exp-routine-item-meta')?.value || '',
        done: li.querySelector('.exp-routine-check')?.classList.contains('is-done') || false
      })).filter(item => item.text.trim() !== '');
    }

    syncAndSave();
    renderCardFeed(allCards, selectedDate, currentDate);
    renderDateStrip(getWeekDates(selectedDate), selectedDate, allCards);
    this.currentCard = null;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  ExpandedCardView.init();
});

// ============================================
// Voice Recorder
// ============================================

class VoiceRecorder {
  constructor() {
    this.overlay     = document.getElementById('speakingOverlay');
    this.reviewOverlay = document.getElementById('reviewOverlay');
    this.canvas      = document.getElementById('waveCanvas');
    this.timerEl     = document.getElementById('timerText');
    this.finalEl     = document.getElementById('transcriptFinal');
    this.interimEl   = document.getElementById('transcriptInterim');
    this.hintEl      = document.getElementById('transcriptHint');
    this.transcriptBox = document.getElementById('transcriptBox');
    this.reviewBody  = document.getElementById('reviewBody');

    this.stream      = null;
    this.animFrame   = null;
    this.recognition = null;
    this.timerInterval = null;
    this.stalledTimeout = null;

    this.seconds     = 0;
    this.committedText = ''; // text saved from completed recognition sessions
    this.finalText   = '';
    this.interimText = '';
    this.paused      = false;

    // Synthetic waveform state — driven by speech events, not getUserMedia
    this.waveHistory    = [];   // array of amplitude values (0-1)
    this.MAX_BARS       = 80;
    this.targetAmplitude = 0.02; // resting level
    this.currentAmplitude = 0.02;

    this._bindButtons();
  }

  _bindButtons() {
    document.getElementById('btnPause').addEventListener('click', () => this.togglePause());
    document.getElementById('btnDone').addEventListener('click', () => this.finish());
    document.getElementById('btnCancel').addEventListener('click', () => this.reset());
    document.getElementById('btnCloseOverlay').addEventListener('click', () => this.cancel());
    document.getElementById('btnReviewBack').addEventListener('click', () => this._showSpeaking());
    document.getElementById('btnConfirmCard').addEventListener('click', () => this.confirmCard());
    document.getElementById('btnReviewCancel').addEventListener('click', () => this.cancel());
    document.getElementById('btnEditCard').addEventListener('click', () => {
      this.cancel();
      Composer.open(this.finalText);
    });
  }

  async open() {
    const proceed = await OverlayManager.requestOpen(this);
    if (!proceed) return;
    this.overlay.classList.add('is-active');
    this.reset();
  }

  reset() {
    this._stopAll();
    this.seconds = 0;
    this.paused = false;
    this.finalText = '';
    this.interimText = '';
    this.committedText = '';
    this.waveHistory = [];
    this.targetAmplitude = 0.02;
    this.currentAmplitude = 0.02;
    this.finalEl.textContent = '';
    this.interimEl.textContent = '';
    this.hintEl.style.display = '';
    this.hintEl.textContent = 'Start speaking...';
    this.timerEl.textContent = '0:00';

    // Size canvas
    const wrapper = this.canvas.parentElement;
    this.canvas.width  = wrapper.clientWidth;
    this.canvas.height = 70;

    // Start synthetic waveform animation (no getUserMedia needed)
    this._drawWave();
    // Start speech recognition — it gets exclusive mic access
    this._startSpeech();
    this._startTimer();
  }

  _drawWave() {
    const canvasCtx = this.canvas.getContext('2d');
    const W = this.canvas.width;
    const H = this.canvas.height;

    const draw = () => {
      this.animFrame = requestAnimationFrame(draw);

      // Smoothly interpolate currentAmplitude toward targetAmplitude
      this.currentAmplitude += (this.targetAmplitude - this.currentAmplitude) * 0.15;

      // Add natural jitter when sound is active
      let val = this.currentAmplitude;
      if (val > 0.05) {
        val = val + (Math.random() - 0.5) * val * 0.8;
        val = Math.max(0.02, Math.min(1.0, val));
      }

      this.waveHistory.push(val);
      if (this.waveHistory.length > this.MAX_BARS) {
        this.waveHistory.shift();
      }

      // Draw bars
      canvasCtx.clearRect(0, 0, W, H);
      const step = W / this.MAX_BARS;
      const barW = Math.max(2, step - 4);
      const cx    = H / 2;

      const isLight = document.body.classList.contains('light-theme');
      canvasCtx.fillStyle = isLight ? `rgba(0,0,0,1)` : `rgba(255,255,255,1)`;

      for (let i = 0; i < this.MAX_BARS; i++) {
        const v     = this.waveHistory[i] ?? 0.02;
        const barH  = Math.max(3, v * H * 0.9);
        const x     = i * step;
        const alpha = 0.3 + (i / this.MAX_BARS) * 0.7;

        canvasCtx.globalAlpha = alpha;
        canvasCtx.beginPath();
        if (canvasCtx.roundRect) {
          canvasCtx.roundRect(x, cx - barH / 2, barW, barH, 2);
        } else {
          canvasCtx.rect(x, cx - barH / 2, barW, barH);
        }
        canvasCtx.fill();
      }
      canvasCtx.globalAlpha = 1.0;
    };
    draw();
  }

  _startSpeech() {
    if (!Platform.Speech.isSupported()) {
      this.hintEl.style.display = '';
      this.hintEl.textContent = 'Speech recognition not supported in this environment.';
      return;
    }

    const startSession = async () => {
      if (this.paused || !this.overlay.classList.contains('is-active')) return;

      this.recognition = await Platform.Speech.start({
        onStart: () => {
          this.hintEl.style.display = '';
          this.hintEl.textContent = 'Listening...';
          this.targetAmplitude = 0.04;
        },
        onResult: (finalAddition, interimText) => {
          clearTimeout(this.stalledTimeout);
          this.hintEl.style.display = 'none';
          this.targetAmplitude = 0.7;

          if (finalAddition) {
            this.targetAmplitude = 0.3;
          }

          this.finalText = this.committedText + finalAddition;
          this.interimText = interimText;
          this.finalEl.textContent = this.finalText;
          this.interimEl.textContent = interimText;
          this.transcriptBox.scrollTop = this.transcriptBox.scrollHeight;
        },
        onError: (e) => {
          this.targetAmplitude = 0.02;
          if (e && e.error === 'no-speech') {
            setTimeout(startSession, 100);
            return;
          }
          this.hintEl.style.display = '';
          this.hintEl.textContent = 'Mic Error: ' + (e ? e.error : 'unknown') + '. Retrying...';
          setTimeout(startSession, 1000);
        },
        onEnd: () => {
          if (this.finalText.trim()) {
            this.committedText = this.finalText;
          }
          this.interimEl.textContent = '';
          this.targetAmplitude = 0.02;
          setTimeout(startSession, 150);
        }
      });
    };

    this.stalledTimeout = setTimeout(() => {
      if (!this.interimText && !this.finalText) {
        this.hintEl.style.display = '';
        this.hintEl.textContent = 'Check microphone permissions and try again.';
      }
    }, 10000);

    startSession();
  }

  _startTimer() {
    this.seconds = 0;
    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (!this.paused) {
        this.seconds++;
        const m = Math.floor(this.seconds / 60);
        const s = this.seconds % 60;
        this.timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
      }
    }, 1000);
  }

  togglePause() {
    this.paused = !this.paused;
    const btn = document.getElementById('btnPause');
    if (this.paused) {
      Platform.Speech.stop(this.recognition);
      btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
    } else {
      this._startSpeech();
      btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
    }
  }

  finish() {
    this._stopAll();
    const fullText = (this.finalText + ' ' + (this.interimText || '')).trim();
    this.finalText = fullText;
    
    try {
      const parsed = SmartParser.parse(this.finalText);
      this._showReview(parsed);
    } catch (err) {
      console.error("Parser failed:", err);
      // Fallback
      this._showReview({
        type: 'note',
        content: this.finalText || 'New entry',
        tags: []
      });
    }
  }

  cancel() {
    this._stopAll();
    this.overlay.classList.remove('is-active');
    this.reviewOverlay.classList.remove('is-active');
    OverlayManager.notifyClosed(this);
  }

  _stopAll() {
    cancelAnimationFrame(this.animFrame);
    clearInterval(this.timerInterval);
    clearTimeout(this.stalledTimeout);
    this.targetAmplitude = 0.02;
    if (this.recognition) {
      Platform.Speech.stop(this.recognition);
      this.recognition = null;
    }
  }

  _showReview(parsed) {
    this.parsedCard = parsed;
    this.overlay.classList.remove('is-active');
    this.reviewOverlay.classList.add('is-active');

    const mockCard = {
      id: 0,
      type: parsed.type,
      content: parsed.content,
      tags: parsed.tags,
      extraTags: 0,
      checked: false,
      reminderTime: parsed.reminderTime,
      eventTime: parsed.eventTime
    };

    const cardHtml = renderCard(mockCard, 0);

    this.reviewBody.innerHTML = `
      <div class="review-transcript">
        <div class="review-section-label">Transcript</div>
        <p class="review-transcript-text">${this.finalText || '(no speech detected)'}</p>
      </div>

      <div class="review-card-preview">
        ${cardHtml}
      </div>
    `;
  }

  _showSpeaking() {
    this.reviewOverlay.classList.remove('is-active');
    this.overlay.classList.add('is-active');
  }

  confirmCard() {
    if (!this.parsedCard) return;
    const today = new Date();

    const newCard = {
      id: Date.now(),
      type: this.parsedCard.type,
      date: this.parsedCard.date || formatDateKey(today),
      content: this.parsedCard.content,
      tags: this.parsedCard.tags,
      extraTags: 0,
      checked: false,
      reminderTime: this.parsedCard.reminderTime || null,
      eventTime:    this.parsedCard.eventTime    || null,
      transcript:   this.parsedCard.transcript   || '',
      subItems:     [],
      details:      this.parsedCard.type === 'note' ? (this.parsedCard.transcript || '') : '',
    };

    allCards.push(newCard);
    if (newCard.type === 'calendar') {
      SyncManager.pushToGoogleCalendar(newCard);
    }
    syncAndSave();
    this.reviewOverlay.classList.remove('is-active');
    OverlayManager.notifyClosed(this);
    renderCardFeed(allCards, selectedDate, today);
  }
}

// ============================================
// Smart Parser — pure regex, zero dependencies
// ============================================
const SmartParser = {

  // ── Patterns ──────────────────────────────────────────────────────
  FILLERS: /\b(uh+h*|um+|hmm+|mhm|ah+|oh|er|like,?|so,?|you know,?|i mean,?|basically|literally|right,?|okay|ok|well,?|actually|honestly|kind of|sort of|i guess|you see|i think)\b\s*/gi,

  INTENT_PREFIX: /^(hey[,\s]*|hi[,\s]*)?(please\s+)?(can you\s+)?(remind me (to|that|about)?|don'?t forget (to)?|note (that|to self[:\s]*)?|i('ve| have)?\s+(to|got to|gotta|need to|should)|we\s+(need|should|have) to|remember (to)?|make a note|add (an? )?(event|calendar event)( to my (google )?(calendar|cal))?( to)?|add (a )?(reminder|task|to[-\s]?do)[:\s]*|set (a )?reminder (to)?|i want to|i('?d| would) like to|let'?s|note[:\s]+)\s*/i,

  // Time patterns
  TIME_RE:       /(?:(around\s+|at\s+|by\s+)(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o'?clock)?|(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o'?clock))|\b(noon|midnight)\b/i,
  TIME_RANGE_RE: /from\s+(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o'?clock)?\s+to\s+(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o'?clock)?/i,

  // Date patterns
  DATE_RELATIVE: /\b(today|tonight|tomorrow|tmrw|tmr|day after tomorrow)\b/i,
  DATE_WEEKDAY:  /\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,

  // Routine schedule keywords
  SCHEDULE_RE:   /\b(every\s+(day|morning|evening|night|weekday|weekend|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|each\s+(day|morning|evening)|on\s+(mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)|weekdays|weekends)\b/i,
  REPEAT_COUNT:  /\b(for\s+)?(\d+)\s+(days?|weeks?|months?|times?)\b/i,

  // Type signals
  HABIT_KEYWORDS_RE: /\b(workout|exercise|gym|yoga|meditate|meditation|journaling?|stretch(ing)?|calisthenics|pull\s*day|push\s*day|leg\s*day|run(ning)?|jog(ging)?)\b/i,
  CALENDAR_RE: /\b(event|google cal(endar)?|gcal|meeting|standup|stand-?up|interview|appointment|sync|session|catch-?up|debrief|demo|presentation|call\s+with|chat\s+with|lunch\s+with|dinner\s+with|coffee\s+with|hangout|hang\s+out|zoom|teams\s+call)\b/i,
  TODO_RE:     /\b(buy|get|pick\s+up|grab|order|call|text|message|email|send|reply|respond|submit|upload|download|finish|complete|write|clean|fix|check|review|read|watch|book|reserve|pay|return|fill|sign|print|prepare|plan|organise|organize|remind|bring|drop|file|update|install|set\s+up|register|cancel|reschedule|renew|collect|go\s+to)\b/i,

  NOTE_SIGNAL_RE: /\b(trying to (understand|figure out|see|know|think|process|make sense)|not sure|i('?m| am) not|i wonder|wondering|let me (think|see|check)|i don'?t know|just thinking|was thinking|it seems|feels like|i noticed|interesting|what'?s happening|i'?m confused|seems like|today i|i went|i saw|i felt|i had|i was)\b/i,

  // Location extraction
  LOCATION_RE: /\bat\s+([A-Z][a-zA-Z''\s]{2,20})(?=\s|,|$)/,
  PLATFORM_RE: /\bon\s+(zoom|teams|meet|google meet|slack|discord|skype|facetime)\b/i,

  // Temporal phrases to strip COMPLETELY from content
  TEMPORAL_STRIP: [
    /(?:around\s+|at\s+|by\s+)(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o'?clock)?/gi,
    /(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o'?clock)/gi,
    /\b(noon|midnight)\b/gi,
    /from\s+(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o'?clock)?\s+to\s+(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o'?clock)?/gi,
    /\b(in the|this|every)\s+(morning|afternoon|evening|night)\b/gi,
    /\b(tomorrow|tmrw|tmr|today|tonight|yesterday|day after tomorrow)\b/gi,
    /\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    /\b(every\s+(day|morning|evening|night|weekday|weekend|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|each\s+(day|morning|evening)|on\s+(mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)|weekdays|weekends)\b/gi,
    /\b(for\s+)?\d+\s+(days?|weeks?|months?|times?)\b/gi,
    /\s+(at|by|on|in|before|after)\s*$/gi,
    /^(at|by|on|in)\s+/gi,
  ],

  // Routine item separator — commas, "and", "then", newlines
  ITEM_SPLIT_RE: /,\s*|\s+and\s+|\s+then\s+|\n/i,

  // Sets/reps pattern: "3x12", "3*12", "3 sets 12 reps", "3 sets of 12", "x12", "12 reps"
  SETS_REPS_RE: /(\d+)\s*[x*×]\s*(\d+)|(\d+)\s+sets?\s+(?:of\s+)?(\d+)\s*(?:reps?)?|(\d+)\s*reps?/i,

  STOPWORDS: new Set([
    'i','me','my','we','us','our','you','your','he','she','it','they','them','their',
    'a','an','the','is','are','was','be','been','being','have','has','had','do','did',
    'will','would','can','could','should','shall','may','might','must','need',
    'to','at','on','in','of','and','or','but','for','with','that','this','from',
    'up','about','into','then','than','so','if','as','by','not','no','nor',
    'am','pm','hi','hey','ok','okay','please','just','also','after','before',
    'get','got','go','going','want','let','make','take','give','use','put',
    'around','about','day','week','month','time','set','rep','sets','reps','every'
  ]),

  // ── Helpers ───────────────────────────────────────────────────────
  _parseTimeStr(h, m, ap) {
    h = parseInt(h); m = m ? parseInt(m) : 0;
    ap = (ap || '').toLowerCase().replace(/\./g, '');
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    // Assume PM for bare numbers "1" through "8" (e.g. "at 8" -> 8 PM). 
    // Usually 9, 10, 11 bare are assumed AM.
    if (!ap && h >= 1 && h <= 8) h += 12; 
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  },

  _fmtTime(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
  },

  // ── Routine item parser ────────────────────────────────────────────
  _parseRoutineItems(text) {
    // Find the list portion: everything after a colon, dash, or ":" 
    // e.g. "Leg day: lunges 3x12, squats 3x15" or "Leg day lunges 3x12, squats 3x15"
    let listPart = text;
    const colonIdx = text.search(/:\s*/);
    if (colonIdx > -1) listPart = text.slice(colonIdx + 1);

    const rawItems = listPart.split(this.ITEM_SPLIT_RE).map(s => s.trim()).filter(s => s.length > 1);

    return rawItems.map(raw => {
      const metaMatch = raw.match(this.SETS_REPS_RE);
      let meta = '';
      let itemText = raw;
      if (metaMatch) {
        meta = metaMatch[0]; // e.g. "3x12"
        itemText = raw.replace(this.SETS_REPS_RE, '').replace(/\s+/g, ' ').trim();
      }
      // Clean up punctuation from item text
      itemText = itemText.replace(/^[-–•·]\s*/, '').replace(/[,;.]+$/, '').trim();
      if (!itemText) return null;
      return { text: itemText.charAt(0).toUpperCase() + itemText.slice(1), meta, done: false };
    }).filter(Boolean);
  },

  // ── Main parse ────────────────────────────────────────────────────
  parse(rawText) {
    const today = new Date();

    // 1. Strip fillers
    let text = (rawText || '').replace(this.FILLERS, ' ').replace(/\s+/g, ' ').trim();

    // 2. Strip intent prefix
    text = text.replace(this.INTENT_PREFIX, '').replace(/^[,\s]+/, '').trim();

    const lower = text.toLowerCase();

    // 3. Extract schedule info (for routines) BEFORE stripping
    let schedule = 'daily'; // default
    let scheduleLabel = 'Daily';
    const schedMatch = text.match(this.SCHEDULE_RE);
    if (schedMatch) {
      schedule = schedMatch[0].toLowerCase();
      scheduleLabel = schedMatch[0].charAt(0).toUpperCase() + schedMatch[0].slice(1);
    }
    const repeatMatch = text.match(this.REPEAT_COUNT);
    const repeatCount = repeatMatch ? `${repeatMatch[2]} ${repeatMatch[3]}` : null;

    // 4. Extract TIME range (for calendar: "from 2 to 3pm")
    let reminderTime = null;
    let eventTime = null;
    const trm = text.match(this.TIME_RANGE_RE);
    if (trm) {
      const startT = this._parseTimeStr(trm[1], trm[2], trm[3] || trm[6]);
      const endT   = this._parseTimeStr(trm[4], trm[5], trm[6] || trm[3]);
      eventTime = `${startT} – ${endT}`;
    } else {
      const tm = text.match(this.TIME_RE);
      if (tm) {
        if (tm[8]) {
          reminderTime = tm[8].toLowerCase() === 'noon' ? '12:00' : '00:00';
        } else {
          const h = tm[2] || tm[5];
          const m = tm[3] || tm[6];
          const ap = tm[4] || tm[7];
          reminderTime = this._parseTimeStr(h, m, ap);
        }
      }
    }

    // 5. Extract DATE
    let date = null;
    let dateLabel = null;

    const relMatch = lower.match(this.DATE_RELATIVE);
    if (relMatch) {
      const rel = relMatch[1].toLowerCase();
      if (rel === 'today' || rel === 'tonight') {
        date = formatDateKey(today); dateLabel = 'Today';
      } else if (rel === 'tomorrow' || rel === 'tmrw' || rel === 'tmr') {
        const d = new Date(today); d.setDate(today.getDate() + 1);
        date = formatDateKey(d); dateLabel = 'Tomorrow';
      } else if (rel === 'day after tomorrow') {
        const d = new Date(today); d.setDate(today.getDate() + 2);
        date = formatDateKey(d); dateLabel = 'Day after tomorrow';
      }
    }

    if (!date) {
      const wdMatch = lower.match(this.DATE_WEEKDAY);
      if (wdMatch) {
        const WDAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
        const target = WDAYS.indexOf(wdMatch[2].toLowerCase());
        const curr = today.getDay();
        let diff = target - curr;
        if (diff <= 0 || wdMatch[1]) diff += 7; // if same day or "next X", go to next week
        const d = new Date(today); d.setDate(today.getDate() + diff);
        date = formatDateKey(d);
        dateLabel = wdMatch[0].replace(/\b\w/g, l => l.toUpperCase());
      }
    }

    // 6. Detect card type
    let type = 'note';
    const lowerRaw = (rawText || '').toLowerCase();
    
    const explicitRoutine = /\b(every\s+(day|morning|evening|night|week|weekday)|daily|each\s+(day|morning|evening)|routine|habit)\b/.test(lowerRaw);
    const explicitTodo = /\b(remind|forget|need to|have to|got to|gotta|task|to-do|reminder|remember to)\b/.test(lowerRaw);
    const explicitNote = /\b(note to self|make a note|note:|journal|just thinking|was thinking|i noticed|log)\b/.test(lowerRaw);
    const isHabitKeyword = this.HABIT_KEYWORDS_RE.test(text);

    if (explicitRoutine) {
      type = 'routine';
    } else if (this.CALENDAR_RE.test(text)) {
      type = 'calendar';
    } else if (explicitTodo) {
      type = 'todo';
    } else if (explicitNote || this.NOTE_SIGNAL_RE.test(lower)) {
      type = 'note';
    } else if (isHabitKeyword) {
      type = 'routine';
    } else if (this.TODO_RE.test(text)) {
      type = 'todo';
    }

    if (type === 'note' && reminderTime) type = 'todo';

    // Routines are always "daily" unless schedule says otherwise → no specific date
    if (type === 'routine') date = null;
    // Only set today's date for non-routine cards that have no explicit date
    if (!date && type !== 'routine') date = formatDateKey(today);

    // Calendar: convert single time to event range
    if (type === 'calendar' && reminderTime && !eventTime) {
      const [hh, mm] = reminderTime.split(':').map(Number);
      const endH = (hh + 1) % 24;
      eventTime = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')} – ${String(endH).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
      reminderTime = null;
    }

    // 7. Extract location / platform (for calendar)
    let location = null;
    const locMatch = text.match(this.LOCATION_RE);
    if (locMatch) location = locMatch[1].trim();
    const platformMatch = text.match(this.PLATFORM_RE);
    if (platformMatch) location = platformMatch[1].charAt(0).toUpperCase() + platformMatch[1].slice(1);

    // 8. Parse routine sub-items
    let subItems = [];
    if (type === 'routine') {
      subItems = this._parseRoutineItems(text);
    }

    // 9. Build clean content — strip ALL temporal/schedule/meta phrases
    let content = text;
    for (const pat of this.TEMPORAL_STRIP) {
      content = content.replace(pat, ' ');
    }
    // Also strip the routine list portion (everything after the first colon)
    if (type === 'routine' && content.includes(':')) {
      content = content.split(':')[0].trim();
    }
    // Strip leading comma/dash/space artifacts
    content = content.replace(/^\s*[,\-–]\s*/, '').replace(/\s+/g, ' ').trim();
    // Strip trailing punctuation
    content = content.replace(/[,.\\/\\;:]+$/, '').trim();

    // For notes: cap to first sentence, max 10 words
    if (type === 'note') {
      const first = content.split(/[.!?]/)[0].trim();
      if (first.length > 4) content = first;
      const words = content.split(/\s+/);
      if (words.length > 10) content = words.slice(0, 10).join(' ') + '…';
    }

    // Fallback
    if (!content || content.length < 2) {
      content = text.split(/\s+/).slice(0, 5).join(' ');
    }

    // Capitalise
    content = content.charAt(0).toUpperCase() + content.slice(1);

    // 10. Extract tags
    const tags = this._extractTags(content, dateLabel);

    return { type, content, date, dateLabel, reminderTime, eventTime, location, schedule, scheduleLabel, repeatCount, subItems, tags, transcript: rawText };
  },

  _extractTags(content, dateLabel) {
    const words = content.match(/\b[a-zA-Z]{3,}\b/g) || [];
    const seen = new Set();
    const tags = [];
    for (const word of words) {
      const lower = word.toLowerCase();
      if (this.STOPWORDS.has(lower)) continue;
      if (seen.has(lower)) continue;
      seen.add(lower);
      tags.push(lower.charAt(0).toUpperCase() + lower.slice(1));
      if (tags.length >= 3) break;
    }
    return tags;
  }
};


// ============================================
// Typed Composer
// ============================================

function createCardFromParsed(parsed) {
  const newCard = {
    id: Date.now(),
    type: parsed.type,
    date: parsed.date || null,
    dateLabel: parsed.dateLabel || null,
    content: parsed.content,
    details: parsed.details || '',
    tags: parsed.tags || [],
    extraTags: 0,
    checked: false,
    reminderTime: parsed.reminderTime || null,
    eventTime: parsed.eventTime || null,
    location: parsed.location || null,
    meetLink: parsed.meetLink || null,
    subItems: (parsed.subItems || []).map(s => typeof s === 'string' ? { text: s, meta: '', done: false } : s),
    transcript: parsed.transcript || null
  };

  allCards.unshift(newCard);
  syncAndSave();
  if (newCard.type === 'calendar' && typeof SyncManager !== 'undefined') {
    SyncManager.pushToGoogleCalendar(newCard);
  }
  renderCardFeed(allCards, selectedDate, currentDate);
  renderDateStrip(getWeekDates(selectedDate), selectedDate, allCards);
  return newCard;
}

const Composer = {
  overlay: null,
  sheet: null,
  backdrop: null,
  input: null,
  addBtn: null,
  cancelBtn: null,
  detected: null,
  typeRow: null,
  forcedType: 'auto',
  debounceTimer: null,
  lastParsed: null,

  init() {
    this.overlay  = document.getElementById('composerOverlay');
    this.sheet    = document.getElementById('composerSheet');
    this.backdrop = document.getElementById('composerBackdrop');
    this.input    = document.getElementById('composerInput');
    this.addBtn   = document.getElementById('composerAdd');
    this.cancelBtn = document.getElementById('composerCancel');
    this.detected = document.getElementById('composerDetected');
    this.typeRow  = document.getElementById('composerTypeRow');

    // Cancel / backdrop close
    this.cancelBtn.addEventListener('click', () => this.close());
    this.backdrop.addEventListener('click', () => this.close());

    // Live parsing on input
    this.input.addEventListener('input', () => {
      // Auto-grow textarea
      this.input.style.height = 'auto';
      this.input.style.height = this.input.scrollHeight + 'px';

      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this._updatePreview(), 250);
    });

    // Keyboard: Cmd/Ctrl+Enter submits
    this.input.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        this._submit();
      }
      if (e.key === 'Escape') this.close();
    });

    // Type chip override
    this.typeRow.querySelectorAll('.type-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        this.typeRow.querySelectorAll('.type-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.forcedType = btn.dataset.type;
        this._updatePreview();
      });
    });

    // Add button
    this.addBtn.addEventListener('click', () => this._submit());
  },

  async open(initialText = '') {
    const proceed = await OverlayManager.requestOpen(this);
    if (!proceed) return;
    this.input.value = initialText;
    this.detected.innerHTML = '';
    this.input.style.height = 'auto';
    this.lastParsed = null;
    this.forcedType = 'auto';
    this.typeRow.querySelectorAll('.type-chip').forEach(b => b.classList.remove('active'));
    this.typeRow.querySelector('[data-type="auto"]').classList.add('active');

    this.overlay.classList.add('is-open');
    if (initialText) {
      this._updatePreview();
    }
    // Focus after transition
    setTimeout(() => {
      this.input.focus();
      if (initialText) this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    }, 350);
  },

  close() {
    this.overlay.classList.remove('is-open');
    this.input.blur();
    OverlayManager.notifyClosed(this);
  },

  _updatePreview() {
    const text = this.input.value.trim();
    if (!text) {
      this.detected.innerHTML = '';
      // Show type-specific hint
      const type = this.forcedType !== 'auto' ? this.forcedType : null;
      if (type === 'routine') {
        this.detected.innerHTML = '<span style="color:rgba(255,255,255,0.3)">e.g. "Pull day: bent over row 3x12, inverted row 3x15, every day"</span>';
      }
      return;
    }

    const parsed = SmartParser.parse(text);
    if (this.forcedType !== 'auto') parsed.type = this.forcedType;
    this.lastParsed = parsed;

    // Sync type chip highlight to auto-detected type
    if (this.forcedType === 'auto') {
      this.typeRow.querySelectorAll('.type-chip').forEach(b => {
        b.classList.toggle('active', b.dataset.type === parsed.type);
      });
    }

    // Build info line
    const typeLabels = { note: 'Note', todo: 'To-do', calendar: 'Event', routine: 'Routine' };
    let info = `<span class="detected-type">${typeLabels[parsed.type] || 'Note'}</span>`;

    if (parsed.type === 'todo') {
      if (parsed.date && parsed.dateLabel) {
        info += `  ·  ${parsed.dateLabel}`;
      } else if (parsed.date) {
        // Format date nicely
        const parts = parsed.date.split('-');
        const d = new Date(parts[0], parts[1]-1, parts[2]);
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        info += `  ·  ${months[d.getMonth()]} ${d.getDate()}`;
      } else {
        info += `  ·  Anytime`;
      }
      if (parsed.reminderTime) {
        const [h, m] = parsed.reminderTime.split(':').map(Number);
        info += `  ·  ${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
      }
    } else if (parsed.type === 'calendar') {
      if (parsed.dateLabel) info += `  ·  ${parsed.dateLabel}`;
      else if (parsed.date) {
        const parts = parsed.date.split('-');
        const d = new Date(parts[0], parts[1]-1, parts[2]);
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        info += `  ·  ${months[d.getMonth()]} ${d.getDate()}`;
      }
      if (parsed.eventTime) info += `  ·  ${parsed.eventTime}`;
      if (parsed.location) info += `  ·  @ ${parsed.location}`;
    } else if (parsed.type === 'routine') {
      info += `  ·  ${parsed.scheduleLabel || 'Daily'}`;
      if (parsed.subItems && parsed.subItems.length > 0) {
        info += `  ·  ${parsed.subItems.length} exercise${parsed.subItems.length > 1 ? 's' : ''}`;
        const names = parsed.subItems.slice(0, 3).map(s => s.text).join(', ');
        info += `: <span style="color:rgba(255,255,255,0.5)">${names}${parsed.subItems.length > 3 ? '…' : ''}</span>`;
      } else {
        info += `  —  <span style="color:rgba(255,255,255,0.3)">add exercises after a colon, e.g. "Leg day: squats 3x12, lunges 3x15"</span>`;
      }
      if (parsed.repeatCount) info += `  ·  For ${parsed.repeatCount}`;
    }

    this.detected.innerHTML = info;
  },

  _submit() {
    const text = this.input.value.trim();
    if (!text) {
      // Subtle shake to indicate empty
      this.input.classList.add('shake');
      setTimeout(() => this.input.classList.remove('shake'), 400);
      return;
    }
    const parsed = SmartParser.parse(text);
    if (this.forcedType !== 'auto') parsed.type = this.forcedType;
    createCardFromParsed(parsed);
    this.close();
  }
};

// ============================================
// Custom Date & Time Picker Modal
// ============================================
const ScheduleSheet = {
  overlay: null, sheet: null, dateTab: null, timeTab: null,
  dateView: null, timeView: null, daysGrid: null, monthLabel: null,
  timeContext: null,
  wheelHour: null, wheelMinute: null, wheelAmPm: null,
  currentDate: new Date(),
  currentCard: null,
  
  // Working state
  workingDateStr: '', // 'YYYY-MM-DD' or 'daily'
  workingStartStr: '', // 'HH:MM'
  workingEndStr: '',   // 'HH:MM'
  
  editingTimeContext: 'start', // 'start' or 'end'
  
  onSaveCallback: null,

  init() {
    this.overlay = document.getElementById('scheduleOverlay');
    this.sheet = document.getElementById('scheduleSheet');
    this.dateTab = document.querySelector('.schedule-tab[data-tab="date"]');
    this.timeTab = document.querySelector('.schedule-tab[data-tab="time"]');
    this.dateView = document.getElementById('scheduleViewDate');
    this.timeView = document.getElementById('scheduleViewTime');
    this.daysGrid = document.getElementById('scheduleDaysGrid');
    this.monthLabel = document.getElementById('scheduleMonthLabel');
    this.timeContext = document.getElementById('scheduleTimeContext');
    this.wheelHour = document.getElementById('scheduleWheelHour');
    this.wheelMinute = document.getElementById('scheduleWheelMinute');
    this.wheelAmPm = document.getElementById('scheduleWheelAmPm');

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    document.getElementById('scheduleCancel').addEventListener('click', () => this.close());
    document.getElementById('scheduleDone').addEventListener('click', () => this.saveAndClose());

    this.dateTab.addEventListener('click', () => this.switchMode('date'));
    this.timeTab.addEventListener('click', () => this.switchMode('time'));

    document.getElementById('schedulePrevMonth').addEventListener('click', () => {
      this.currentDate.setMonth(this.currentDate.getMonth() - 1);
      this.renderCalendar();
    });
    document.getElementById('scheduleNextMonth').addEventListener('click', () => {
      this.currentDate.setMonth(this.currentDate.getMonth() + 1);
      this.renderCalendar();
    });

    this.daysGrid.addEventListener('click', (e) => {
      const dayEl = e.target.closest('.dt-day');
      if (!dayEl || dayEl.classList.contains('empty')) return;
      const d = parseInt(dayEl.textContent, 10);
      const m = this.currentDate.getMonth() + 1;
      const y = this.currentDate.getFullYear();
      this.workingDateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      this.renderCalendar();
      this.updateTimeContextUI();
    });

    // Build wheels
    this.wheelHour.innerHTML = Array.from({length: 12}, (_,i) => `<div class="dt-wheel-item" data-val="${i+1}">${i+1}</div>`).join('');
    this.wheelMinute.innerHTML = Array.from({length: 60}, (_,i) => {
      if (i % 5 !== 0) return ''; // Option: snap to 5 mins? Let's keep all 60 for precision.
      return `<div class="dt-wheel-item" data-val="${i}">${String(i).padStart(2,'0')}</div>`;
    }).join('');

    const updateTimeFromWheels = () => {
      if (this.workingDateStr === 'daily' || !this.workingDateStr) return; // Can't pick time for daily/no date

      const hEl = this._getCenterItem(this.wheelHour);
      const mEl = this._getCenterItem(this.wheelMinute);
      const ampmEl = this._getCenterItem(this.wheelAmPm);
      
      if (hEl) { Array.from(this.wheelHour.children).forEach(c => c.classList.remove('selected')); hEl.classList.add('selected'); }
      if (mEl) { Array.from(this.wheelMinute.children).forEach(c => c.classList.remove('selected')); mEl.classList.add('selected'); }
      if (ampmEl) { Array.from(this.wheelAmPm.children).forEach(c => c.classList.remove('selected')); ampmEl.classList.add('selected'); }

      const h = hEl ? hEl.dataset.val : '12';
      const m = mEl ? String(mEl.dataset.val).padStart(2,'0') : '00';
      const ampm = ampmEl ? ampmEl.dataset.val : 'AM';
      
      let hour24 = parseInt(h);
      if (ampm === 'PM' && hour24 < 12) hour24 += 12;
      if (ampm === 'AM' && hour24 === 12) hour24 = 0;
      
      const newTime = `${String(hour24).padStart(2,'0')}:${m}`;
      if (this.editingTimeContext === 'start') {
        this.workingStartStr = newTime;
      } else {
        this.workingEndStr = newTime;
      }
      this.updateTimeContextUI();
    };

    [this.wheelHour, this.wheelMinute, this.wheelAmPm].forEach(wheel => {
      wheel.addEventListener('scroll', updateTimeFromWheels);
      wheel.addEventListener('click', (event) => {
        const item = event.target.closest('.dt-wheel-item');
        if (!item) return;
        wheel.scrollTo({ top: item.offsetTop - wheel.clientHeight / 2 + item.offsetHeight / 2, behavior: 'smooth' });
        setTimeout(updateTimeFromWheels, 180);
      });
    });
  },

  _getCenterItem(wheel) {
    const items = Array.from(wheel.children).filter(el => el.dataset.val !== undefined);
    const center = wheel.scrollTop + (wheel.clientHeight / 2);
    let minDiff = Infinity;
    let closest = null;
    items.forEach(item => {
      const diff = Math.abs((item.offsetTop + item.offsetHeight / 2) - center);
      if (diff < minDiff) { minDiff = diff; closest = item; }
    });
    return closest;
  },

  switchMode(mode) {
    if (mode === 'date') {
      this.dateTab.classList.add('active'); this.timeTab.classList.remove('active');
      this.dateView.style.display = 'block'; setTimeout(()=>this.dateView.classList.add('active'),10);
      this.timeView.classList.remove('active'); setTimeout(()=>this.timeView.style.display = 'none',200);
      this.renderCalendar();
    } else {
      this.timeTab.classList.add('active'); this.dateTab.classList.remove('active');
      this.timeView.style.display = 'flex'; setTimeout(()=>this.timeView.classList.add('active'),10);
      this.dateView.classList.remove('active'); setTimeout(()=>this.dateView.style.display = 'none',200);
      this.updateTimeContextUI();
      // Scroll to current selected time
      const timeStr = this.editingTimeContext === 'start' ? this.workingStartStr : this.workingEndStr;
      this.scrollToTime(timeStr);
    }
  },

  scrollToTime(timeStr) {
    if (!timeStr) return;
    let [h, m] = timeStr.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    setTimeout(() => {
      const itemH = this.wheelHour.querySelector(`[data-val="${h}"]`);
      const itemM = this.wheelMinute.querySelector(`[data-val="${m}"]`);
      const itemA = this.wheelAmPm.querySelector(`[data-val="${ampm}"]`);
      
      if (itemH) this.wheelHour.scrollTo({ top: itemH.offsetTop - this.wheelHour.clientHeight/2 + itemH.offsetHeight/2, behavior: 'instant' });
      if (itemM) this.wheelMinute.scrollTo({ top: itemM.offsetTop - this.wheelMinute.clientHeight/2 + itemM.offsetHeight/2, behavior: 'instant' });
      if (itemA) this.wheelAmPm.scrollTo({ top: itemA.offsetTop - this.wheelAmPm.clientHeight/2 + itemA.offsetHeight/2, behavior: 'instant' });
    }, 10);
  },

  formatTimeDisp(timeStr) {
    if (!timeStr) return '--:--';
    let [h, m] = timeStr.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2,'0')} ${ampm}`;
  },

  updateTimeContextUI() {
    if (!this.currentCard) {
       this.timeContext.innerHTML = `<div class="schedule-time-row"><span>Select a card first</span></div>`;
       return;
    }
    
    if (!this.workingDateStr || this.workingDateStr === 'daily') {
       this.timeContext.innerHTML = `<div class="schedule-time-row"><span>No date selected</span></div>`;
       this.wheelHour.style.opacity = '0.3';
       this.wheelHour.style.pointerEvents = 'none';
       this.wheelMinute.style.opacity = '0.3';
       this.wheelMinute.style.pointerEvents = 'none';
       this.wheelAmPm.style.opacity = '0.3';
       this.wheelAmPm.style.pointerEvents = 'none';
       return;
    }
    
    this.wheelHour.style.opacity = '1';
    this.wheelHour.style.pointerEvents = 'auto';
    this.wheelMinute.style.opacity = '1';
    this.wheelMinute.style.pointerEvents = 'auto';
    this.wheelAmPm.style.opacity = '1';
    this.wheelAmPm.style.pointerEvents = 'auto';

    if (this.currentCard.type === 'calendar') {
      this.timeContext.innerHTML = `
        <div class="schedule-time-row">
          <span>Start Time</span>
          <button class="schedule-time-btn ${this.editingTimeContext === 'start' ? 'active' : ''}" id="btnEditStart">${this.formatTimeDisp(this.workingStartStr)}</button>
        </div>
        <div class="schedule-time-row">
          <span>End Time</span>
          <button class="schedule-time-btn ${this.editingTimeContext === 'end' ? 'active' : ''}" id="btnEditEnd">${this.formatTimeDisp(this.workingEndStr)}</button>
        </div>
      `;
      document.getElementById('btnEditStart').addEventListener('click', () => {
        this.editingTimeContext = 'start';
        this.updateTimeContextUI();
        this.scrollToTime(this.workingStartStr);
      });
      document.getElementById('btnEditEnd').addEventListener('click', () => {
        this.editingTimeContext = 'end';
        if (!this.workingEndStr && this.workingStartStr) {
          // Default end time to start + 1 hour
          let [h, m] = this.workingStartStr.split(':').map(Number);
          h = (h + 1) % 24;
          this.workingEndStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        }
        this.updateTimeContextUI();
        this.scrollToTime(this.workingEndStr);
      });
    } else {
      // Todo or Note
      this.timeContext.innerHTML = `
        <div class="schedule-time-row">
          <span>Reminder Time</span>
          <div>
             <button class="schedule-time-btn active" id="btnEditStart" style="margin-right:8px;">${this.workingStartStr ? this.formatTimeDisp(this.workingStartStr) : 'Set Time'}</button>
             <button class="schedule-cancel" id="btnClearTime" style="min-width:auto; min-height:auto; padding:8px 12px; font-size:14px; background:rgba(255,255,255,0.1); border-radius:12px; color:var(--text-secondary);">Clear</button>
          </div>
        </div>
      `;
      document.getElementById('btnEditStart').addEventListener('click', () => {
        if (!this.workingStartStr) {
           this.workingStartStr = '12:00';
           this.updateTimeContextUI();
           this.scrollToTime(this.workingStartStr);
        }
      });
      document.getElementById('btnClearTime').addEventListener('click', () => {
        this.workingStartStr = '';
        this.updateTimeContextUI();
      });
    }
  },

  openForCard(card, onSaveCallback) {
    this.currentCard = card;
    this.onSaveCallback = onSaveCallback;
    this.workingDateStr = card.date || '';
    
    if (card.type === 'calendar') {
      if (card.eventTime) {
        const parts = card.eventTime.split('–').map(s => s.trim());
        this.workingStartStr = parts[0] || '09:00';
        this.workingEndStr = parts[1] || '10:00';
      } else {
        this.workingStartStr = '09:00';
        this.workingEndStr = '10:00';
      }
    } else {
      this.workingStartStr = card.reminderTime || '';
      this.workingEndStr = '';
    }
    
    this.editingTimeContext = 'start';
    
    if (this.workingDateStr && this.workingDateStr !== 'daily') {
      const parts = this.workingDateStr.split('-');
      if (parts.length === 3) this.currentDate = new Date(parts[0], parts[1]-1, parts[2]);
    } else {
      this.currentDate = new Date();
    }
    
    this.switchMode('date');
    OverlayManager.requestOpen(this);
    this.overlay.classList.add('is-active');
  },
  
  openForDateJump(initialDateStr, onSaveCallback) {
    this.currentCard = null; // null context means Date tab only
    this.onSaveCallback = onSaveCallback;
    this.workingDateStr = initialDateStr;
    
    if (this.workingDateStr && this.workingDateStr !== 'daily') {
      const parts = this.workingDateStr.split('-');
      if (parts.length === 3) this.currentDate = new Date(parts[0], parts[1]-1, parts[2]);
    } else {
      this.currentDate = new Date();
    }
    
    this.timeTab.style.display = 'none'; // hide time tab for pure date jump
    this.switchMode('date');
    OverlayManager.requestOpen(this);
    this.overlay.classList.add('is-active');
  },

  saveAndClose() {
    if (this.onSaveCallback) {
       this.onSaveCallback({
         date: this.workingDateStr,
         start: this.workingStartStr,
         end: this.workingEndStr
       });
    }
    this.close();
  },

  close() {
    this.overlay.classList.remove('is-active');
    // reset tab visibility in case it was hidden by openForDateJump
    this.timeTab.style.display = 'block';
    OverlayManager.notifyClosed(this);
  },

  renderCalendar() {
    const y = this.currentDate.getFullYear();
    const m = this.currentDate.getMonth();
    this.monthLabel.textContent = `${MONTHS[m]} ${y}`;
    
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    
    let html = '';
    for (let i = 0; i < firstDay; i++) {
      html += `<div class="dt-day empty"></div>`;
    }
    const todayStr = formatDateKey(new Date());
    
    for (let i = 1; i <= daysInMonth; i++) {
      const cellDateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
      let cls = 'dt-day';
      if (cellDateStr === todayStr) cls += ' today';
      if (cellDateStr === this.workingDateStr) cls += ' selected';
      html += `<button type="button" class="${cls}" aria-label="${MONTHS[m]} ${i}, ${y}" aria-pressed="${cellDateStr === this.workingDateStr}">${i}</button>`;
    }
    this.daysGrid.innerHTML = html;
  }
};


// ============================================
// Notification Engine
// ============================================
const NotificationEngine = {
  audioCtx: null,
  soundEnabled: true,
  
  init() {
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
    setInterval(() => this.tick(), 30000); // Check every 30s
  },

  playChime() {
    if (!this.soundEnabled) return;
    if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
    
    const playNote = (freq, time, dur) => {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.5, time + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, time + dur);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(time);
      osc.stop(time + dur);
    };

    const now = this.audioCtx.currentTime;
    playNote(880, now, 0.5); // A5
    playNote(1108.73, now + 0.15, 0.6); // C#6
  },

  tick() {
    const now = new Date();
    const todayStr = formatDateKey(now);
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    
    allCards.forEach(c => {
      if (c.notified) return;
      
      let shouldNotify = false;
      if (c.type === 'todo' && c.date === todayStr && c.reminderTime === timeStr) {
        shouldNotify = true;
      } else if (c.type === 'calendar' && c.date === todayStr && c.eventTime) {
        const startRaw = c.eventTime.split('–')[0].trim();
        if (startRaw === timeStr) shouldNotify = true;
      }

      if (shouldNotify) {
        c.notified = true;
        this.playChime();
        if (Notification.permission === 'granted') {
          new Notification('Meye Reminder', {
            body: c.content,
            icon: '/favicon.ico'
          });
        }
      }
    });
  }
};

// ============================================
// Settings View
// ============================================// ============================================
// Sync Manager (BYOC Architecture)
// ============================================
const SyncManager = {
  gistId: null,
  pat: null,
  pollInterval: null,

  // ⚠️ IMPORTANT: Replace this with your GitHub OAuth App Client ID!
  // To get one: GitHub Settings -> Developer Settings -> OAuth Apps -> New OAuth App
  // Enable "Device Flow" in the OAuth App settings!
  CLIENT_ID: 'Ov23li20E2Iu1hJubM3e', 

  async init() {
    const stateStr = await Platform.Storage.getSecure('meyeSyncState');
    const savedState = stateStr ? JSON.parse(stateStr) : {};
    this.gistId = savedState.gistId || null;
    this.pat = savedState.pat || null;
    this.githubUsername = savedState.githubUsername || null;

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code) {
      window.history.replaceState({}, document.title, window.location.pathname);
      this.exchangeCodeForToken(code);
    }
    
    if (window.location.hash) {
      try {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        if (accessToken) {
          await Platform.Storage.setSecure('meyeGCalToken', accessToken);
          if (typeof SettingsView !== 'undefined') {
            SettingsView.prefs.calSync = 'google';
            SettingsView.save();
            SettingsView.applyAll();
          }
          this.fetchGoogleEvents();
          window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
        }
      } catch (e) {
        console.error('Failed to parse web hash token', e);
      }
    }

    this.updateStatusUI();

    if (typeof SettingsView !== 'undefined' && SettingsView.prefs.calSync === 'google') {
      this.fetchGoogleEvents();
    }
    if (this.pat) {
      this.pullFromGitHub();
    }

    // Auto-sync when the app comes back into focus
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (typeof SettingsView !== 'undefined' && SettingsView.prefs.calSync === 'google') {
          this.fetchGoogleEvents();
        }
        if (this.pat) {
          this.pullFromGitHub();
        }
      }
    });
  },

  async updateStatusUI() {
    const statusEl = document.getElementById('labelGitHubSyncStatus');
    const svStatusEl = document.getElementById('sv-githubSyncStatus');
    
    if (this.pat && !this.githubUsername) {
      try {
        const res = await fetch('https://api.github.com/user', {
          headers: { 'Authorization': `Bearer ${this.pat}` }
        });
        if (res.ok) {
          const data = await res.json();
          this.githubUsername = data.login;
          localStorage.setItem('meyeSyncState', JSON.stringify({ pat: this.pat, gistId: this.gistId, githubUsername: this.githubUsername }));
        }
      } catch(e) {}
    }

    const displayStatus = this.pat ? (this.githubUsername || 'Connected') : 'Not Connected';
    
    if (statusEl) {
      statusEl.textContent = displayStatus;
    }
    if (svStatusEl) {
      svStatusEl.textContent = this.pat ? displayStatus : '';
    }
    
    const syncNowBtn = document.getElementById('btnGitHubSyncNow');
    if (syncNowBtn) syncNowBtn.style.display = this.pat ? 'block' : 'none';
  },

  async exchangeCodeForToken(code) {
    try {
      const res = await fetch('https://meyee.vercel.app/api/github-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      
      if (data.access_token) {
        this.pat = data.access_token;
        await Platform.Storage.setSecure('meyeSyncState', JSON.parse(await Platform.Storage.getSecure('meyeSyncState') || '{}') ? JSON.stringify({ ...JSON.parse(await Platform.Storage.getSecure('meyeSyncState') || '{}'), pat: this.pat, gistId: this.gistId }) : JSON.stringify({ pat: this.pat, gistId: this.gistId }));
        await this.updateStatusUI();
        if (typeof SettingsView !== 'undefined') {
          SettingsView.prefs.ghToken = true;
          SettingsView.save();
        }
        await this.syncToGitHub();
        alert('GitHub successfully connected!');
      } else {
        alert('Failed to connect to GitHub: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      console.error(e);
      alert('Network error while connecting to GitHub.');
    }
  },


  async syncToGitHub() {
    if (!this.pat) return;
    
    const payload = {
      allCards: JSON.parse(localStorage.getItem('meyeCards') || '[]'),
      stats: JSON.parse(localStorage.getItem('meyeStatsNew') || '{}'),
      prefs: JSON.parse(localStorage.getItem('meyePrefsV2') || '{}')
    };
    
    try {
      const btn = document.getElementById('btnGitHubSyncNow');
      if(btn) btn.textContent = "Syncing...";

      const headers = {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${this.pat}`,
        'X-GitHub-Api-Version': '2022-11-28'
      };

      if (!this.gistId) {
        const res = await fetch('https://api.github.com/gists', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            description: "meye backup",
            public: false,
            files: { "meye_backup.json": { content: JSON.stringify(payload, null, 2) } }
          })
        });
        const data = await res.json();
        if (res.ok && data.id) {
          this.gistId = data.id;
          await Platform.Storage.setSecure('meyeSyncState', JSON.parse(await Platform.Storage.getSecure('meyeSyncState') || '{}') ? JSON.stringify({ ...JSON.parse(await Platform.Storage.getSecure('meyeSyncState') || '{}'), pat: this.pat, gistId: this.gistId }) : JSON.stringify({ pat: this.pat, gistId: this.gistId }));
        } else {
          throw new Error('Failed to create Gist');
        }
      } else {
        const res = await fetch(`https://api.github.com/gists/${this.gistId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            files: { "meye_backup.json": { content: JSON.stringify(payload, null, 2) } }
          })
        });
        if (!res.ok) throw new Error(`Failed to update Gist (${res.status})`);
      }
      
      if(btn) btn.textContent = "Synced!";
      setTimeout(() => { if(btn) btn.textContent = "Sync Now"; }, 2000);
      this.updateStatusUI();
    } catch (err) {
      console.error('GitHub Sync Error:', err);
      const btn = document.getElementById('btnGitHubSyncNow');
      if(btn) btn.textContent = "Failed!";
      setTimeout(() => { if(btn) btn.textContent = "Sync Now"; }, 2000);
    }
  },

  async pullFromGitHub() {
    if (!this.pat || !this.gistId) return;
    try {
      const res = await fetch(`https://api.github.com/gists/${this.gistId}`, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${this.pat}`
        }
      });
      if (!res.ok) throw new Error(`Failed to load Gist (${res.status})`);
      const data = await res.json();
      if (data.files && data.files['meye_backup.json']) {
        const content = JSON.parse(data.files['meye_backup.json'].content);
        const newCardsStr = JSON.stringify(content.allCards || []);
        const currentCardsStr = localStorage.getItem('meyeCards') || '[]';
        
        if (newCardsStr !== currentCardsStr) {
          if (content.allCards) localStorage.setItem('meyeCards', newCardsStr);
          if (content.stats) localStorage.setItem('meyeStatsNew', JSON.stringify(content.stats));
          if (content.prefs) localStorage.setItem('meyePrefsV2', JSON.stringify(content.prefs));
          location.reload();
        }
      }
    } catch (e) {
      console.error("Pull failed", e);
    }
  },

  exportJSON() {
    const payload = {
      allCards: JSON.parse(localStorage.getItem('meyeCards') || '[]'),
      stats: JSON.parse(localStorage.getItem('meyeStatsNew') || '{}'),
      prefs: JSON.parse(localStorage.getItem('meyePrefsV2') || '{}')
    };
    const str = JSON.stringify(payload, null, 2);
    const blob = new Blob([str], { type: 'application/json' });
    const filename = `meye_backup_${new Date().toISOString().split('T')[0]}.json`;
    
    // Try Web Share API for mobile devices first
    if (navigator.canShare) {
      const file = new File([blob], filename, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({
          title: 'Meye Backup',
          files: [file]
        }).catch(err => {
          console.error('Share failed', err);
          this._fallbackDownload(blob, filename);
        });
        return;
      }
    }
    
    this._fallbackDownload(blob, filename);
  },

  _fallbackDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  },

  importJSON(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const payload = JSON.parse(e.target.result);
        if (payload.allCards) localStorage.setItem('meyeCards', JSON.stringify(payload.allCards));
        if (payload.stats) localStorage.setItem('meyeStatsNew', JSON.stringify(payload.stats));
        if (payload.prefs) localStorage.setItem('meyePrefsV2', JSON.stringify(payload.prefs));
        alert('Backup imported successfully!');
        location.reload();
      } catch (err) {
        alert('Invalid backup file');
      }
    };
    reader.readAsText(file);
  },

  async fetchGoogleEvents() {
    const token = await Platform.Storage.getSecure('meyeGCalToken');
    if (!token) return;
    try {
      const startOfDay = new Date();
      startOfDay.setDate(startOfDay.getDate() - 7);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date();
      endOfDay.setDate(endOfDay.getDate() + 30);
      endOfDay.setHours(23, 59, 59, 999);
      
      const startKey = formatDateKey(startOfDay);
      const endKey = formatDateKey(endOfDay);
      
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${startOfDay.toISOString()}&timeMax=${endOfDay.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=500`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.error) {
        if (data.error.code === 401) {
          await Platform.Storage.removeSecure('meyeGCalToken');
          if (typeof SettingsView !== 'undefined' && SettingsView.prefs.calSync === 'google') {
            SettingsView.prefs.calSync = 'none';
            SettingsView.save();
            SettingsView.applyAll();
          }
        }
        console.error("GCal fetch error", data.error);
        return;
      }
      
      allCards = allCards.filter(c => !(c.type === 'calendar' && c.source === 'google' && c.date >= startKey && c.date <= endKey));
      
      if (data.items) {
        data.items.forEach(ev => {
          if (ev.status === 'cancelled') return;
          const summary = ev.summary || 'Busy';
          let timeStr = '';
          let evDateStr = ev.start.dateTime || ev.start.date;
          if (!evDateStr) return;
          
          let evDate = new Date(evDateStr);
          
          if (ev.start && ev.start.dateTime) {
            const endDate = new Date(ev.end.dateTime);
            const formatGoogleTime = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            timeStr = `${formatGoogleTime(evDate)} – ${formatGoogleTime(endDate)}`;
          } else {
            timeStr = 'All Day';
          }
          
          allCards.push({
            id: 'gcal_' + ev.id,
            type: 'calendar',
            date: formatDateKey(evDate),
            content: summary,
            eventTime: timeStr,
            tags: ['Google Calendar'],
            extraTags: 0,
            source: 'google',
            created: Date.now()
          });
        });
      }
      
      syncAndSave();
      if (typeof renderCardFeed !== 'undefined' && typeof selectedDate !== 'undefined') {
        renderCardFeed(allCards, selectedDate, currentDate);
      }
    } catch (e) {
      console.error("Failed to fetch Google Calendar events", e);
    }
  },

  parseGoogleDateTime(dateStr, timeStr) {
    if (!timeStr) {
      return { start: { date: dateStr }, end: { date: dateStr } };
    }
    const times = timeStr.match(/(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/gi) || [];
    const parseTime = (t) => {
      let [time, modifier] = t.split(/\s*(a\.?m\.?|p\.?m\.?)/i);
      let [hours, minutes] = time.split(':');
      hours = parseInt(hours, 10);
      if (modifier) {
        modifier = modifier.toLowerCase().replace(/\./g, '');
        if (hours === 12 && modifier !== 'pm') hours = 0;
        if (modifier === 'pm' && hours < 12) hours += 12;
      }
      return { h: hours, m: parseInt(minutes, 10) };
    };

    if (times.length === 0) {
      return { start: { date: dateStr }, end: { date: dateStr } };
    }

    const startT = parseTime(times[0]);
    const startD = new Date(`${dateStr}T00:00:00`);
    startD.setHours(startT.h, startT.m, 0, 0);

    let endD = new Date(startD);
    if (times.length > 1) {
      const endT = parseTime(times[1]);
      endD.setHours(endT.h, endT.m, 0, 0);
    } else {
      endD.setHours(startD.getHours() + 1);
    }

    const pad = (n) => String(n).padStart(2, '0');
    const tzOffset = -startD.getTimezoneOffset();
    const sign = tzOffset >= 0 ? '+' : '-';
    const tz = `${sign}${pad(Math.floor(Math.abs(tzOffset) / 60))}:${pad(Math.abs(tzOffset) % 60)}`;

    const startStr = `${startD.getFullYear()}-${pad(startD.getMonth()+1)}-${pad(startD.getDate())}T${pad(startD.getHours())}:${pad(startD.getMinutes())}:00${tz}`;
    const endStr = `${endD.getFullYear()}-${pad(endD.getMonth()+1)}-${pad(endD.getDate())}T${pad(endD.getHours())}:${pad(endD.getMinutes())}:00${tz}`;

    return {
      start: { dateTime: startStr },
      end: { dateTime: endStr }
    };
  },

  async pushToGoogleCalendar(card) {
    const token = await Platform.Storage.getSecure('meyeGCalToken');
    if (!token || card.type !== 'calendar') return;
    
    const payload = {
      summary: card.content,
      location: card.location || '',
      description: card.meetLink ? `Meeting Link: ${card.meetLink}\n${card.details || ''}` : (card.details || ''),
      ...this.parseGoogleDateTime(card.date, card.eventTime)
    };

    const isEdit = String(card.id).startsWith('gcal_');
    const endpoint = isEdit 
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${String(card.id).replace('gcal_', '')}`
      : 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

    try {
      const res = await fetch(endpoint, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.id) {
        card.id = 'gcal_' + data.id;
        card.source = 'google';
        syncAndSave();
      }
    } catch (e) {
      console.error("GCal Push Exception", e);
    }
  },

  async deleteFromGoogleCalendar(id) {
    if (!id || !id.startsWith('gcal_')) return;
    const token = await Platform.Storage.getSecure('meyeGCalToken');
    if (!token || !String(id).startsWith('gcal_')) return;
    
    try {
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${String(id).replace('gcal_', '')}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch(e) {
      console.error("GCal Delete Exception", e);
    }
  }
};

const SettingsView = {
  page: null, dropdown: null, mediaQuery: null,
  activeRowEl: null, activeSetting: null,
  prefs: {},

  DEFAULTS: {
    appearance: 'system', accentColor: '#FF453A',
    calSync: 'none', defaultReminder: 'none',
    notifSound: 'default', bannerStyle: 'minimal',
    autoBackup: false
  },

  init() {
    this.page = document.getElementById('settingsPage');
    this.dropdown = document.getElementById('settingsDropdown');
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.mediaQuery.addEventListener('change', () => this.applyAppearance());

    // Load prefs
    this.prefs = { ...this.DEFAULTS, ...JSON.parse(localStorage.getItem('meyePrefsV2') || '{}') };
    this.applyAll();

    document.getElementById('btnSettings').addEventListener('click', () => this.open());
    document.getElementById('settingsBack').addEventListener('click', (e) => {
      if (this.dropdown.style.display === 'block') {
        e.stopPropagation();
        this.closeDropdown();
      } else {
        this.close();
      }
    });

    // Delegated click for all rows
    this.page.addEventListener('click', (e) => {
      // Close dropdown if clicking outside it
      if (!e.target.closest('.settings-dropdown') && !e.target.closest('.settings-row')) {
        this.closeDropdown();
      }

      const row = e.target.closest('.settings-row[data-setting]');
      if (row) { this.openDropdown(row); return; }

      // Auto Backup toggle
      if (e.target.closest('#settingsAutoBackup')) {
        this.prefs.autoBackup = !this.prefs.autoBackup;
        const tog = document.getElementById('toggleAutoBackup');
        tog.classList.toggle('is-on', this.prefs.autoBackup);
        this.save();
        return;
      }

      if (e.target.closest('#settingsGoogleCalSync')) {
        const btnLogin = document.getElementById('btnStartGoogleCalLogin');
        const btnSync = document.getElementById('btnGoogleSyncNow');
        if (this.prefs.calSync === 'google') {
          btnLogin.textContent = 'Disconnect Google Calendar';
          btnLogin.style.background = '#FF453A';
          btnLogin.style.color = '#FFF';
        } else {
          btnLogin.textContent = 'Link Google Calendar';
          btnLogin.style.background = 'var(--text-primary)';
          btnLogin.style.color = 'var(--bg-primary)';
        }
        btnSync.style.display = 'none';
        document.getElementById('settingsGoogleCalOverlay').style.display = 'flex';
        return;
      }

      if (e.target.closest('#settingsGitHubSync')) {
        const btnLogin = document.getElementById('btnStartGitHubLogin');
        const btnSync = document.getElementById('btnGitHubSyncNow');
        if (SyncManager.pat) {
          btnLogin.textContent = 'Disconnect GitHub';
          btnLogin.style.background = '#FF453A';
          btnLogin.style.color = '#FFF';
        } else {
          btnLogin.textContent = 'Link GitHub Account';
          btnLogin.style.background = 'var(--text-primary)';
          btnLogin.style.color = 'var(--bg-primary)';
        }
        btnSync.style.display = 'none';
        document.getElementById('settingsGitHubOverlay').style.display = 'flex';
        return;
      }
      if (e.target.closest('#settingsExportBackup')) {
        SyncManager.exportJSON();
        return;
      }
      if (e.target.closest('#settingsImportBackup')) {
        document.getElementById('importBackupFile').click();
        return;
      }
      if (e.target.closest('#settingsPrivacyPolicy')) {
        window.open('/privacy.html', '_blank');
        return;
      }
      if (e.target.closest('#settingsTermsOfService')) {
        window.open('/terms.html', '_blank');
        return;
      }

      // Reset All Data
      if (e.target.closest('#settingsResetAll')) {
        document.getElementById('settingsResetConfirm').style.display = 'flex';
        return;
      }
    });

    // Dropdown item click handled separately since dropdown is outside page
    this.dropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.settings-dropdown-item');
      if (item) {
        this.selectOption(item.dataset.val, item.dataset.label);
      }
    });

    // GitHub Device Flow Overlay

    document.getElementById('btnCancelGitHubPat').addEventListener('click', () => {
      document.getElementById('settingsGitHubOverlay').style.display = 'none';
    });
    document.getElementById('btnStartGitHubLogin').addEventListener('click', () => {
      if (SyncManager.pat) {
        // Disconnect
        SyncManager.pat = null;
        SyncManager.githubUsername = null;
        (async () => await Platform.Storage.setSecure('meyeSyncState', JSON.stringify({ pat: null, gistId: null })))();
        document.getElementById('settingsGitHubOverlay').style.display = 'none';
        return;
      }
      Platform.Auth.authorizeGitHub();
    });
    document.getElementById('btnGitHubSyncNow').addEventListener('click', () => {
      SyncManager.syncToGitHub();
      document.getElementById('settingsGitHubOverlay').style.display = 'none';
    });

    // Google Calendar Overlay
    document.getElementById('btnStartGoogleCalLogin').addEventListener('click', async () => {
      if (this.prefs.calSync === 'google') {
        // Disconnect
        this.prefs.calSync = 'none';
        await Platform.Storage.removeSecure('meyeGCalToken');
        this.save();
        this.applyAll();
        document.getElementById('settingsGoogleCalOverlay').style.display = 'none';
        return;
      }
      
      const clientId = '231629020948-p2pspiejpqv582bm3pok4uhq4lodduvj.apps.googleusercontent.com';
      const scope = 'https://www.googleapis.com/auth/calendar.events';
      
      Platform.Auth.authorizeGoogleCalendar(clientId, scope);
      
      document.getElementById('settingsGoogleCalOverlay').style.display = 'none';
    });
    
    document.getElementById('btnGoogleSyncNow').addEventListener('click', () => {
      SyncManager.fetchGoogleEvents();
      document.getElementById('settingsGoogleCalOverlay').style.display = 'none';
    });
    
    document.getElementById('btnCancelGoogleCal').addEventListener('click', () => {
      document.getElementById('settingsGoogleCalOverlay').style.display = 'none';
    });

    // File Import
    document.getElementById('importBackupFile').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        SyncManager.importJSON(e.target.files[0]);
      }
    });

    // Reset confirm buttons
    document.getElementById('settingsResetConfirmBtn').addEventListener('click', () => {
      localStorage.clear();
      location.reload();
    });
    document.getElementById('settingsResetCancelBtn').addEventListener('click', () => {
      document.getElementById('settingsResetConfirm').style.display = 'none';
    });

    // Close dropdown on scroll
    document.getElementById('settingsPage').querySelector('.fp-content').addEventListener('scroll', () => this.closeDropdown());
  },

  applyAll() {
    this.applyAppearance();
    this.applyAccentColor(this.prefs.accentColor);

    NotificationEngine.soundEnabled = this.prefs.notifSound !== 'none';

    // Update all value labels
    const svMap = {
      appearance: { system: 'System', light: 'Light', dark: 'Dark' },
      accentColor: { '#FF453A': 'Red', '#5E9CFF': 'Blue', '#BF5AF2': 'Violet', '#FF9F43': 'Amber', '#34C759': 'Green', '#FF375F': 'Pink' },
      fontSize: { small: 'Small', default: 'Default', large: 'Large' },
      defaultReminder: { none: 'None', '0': 'At time', '5': '5 min', '15': '15 min', '30': '30 min', '60': '1 hour' },
      notifSound: { none: 'None', default: 'Default', chime: 'Double Chime', synth: 'Synth Bell' },
      bannerStyle: { minimal: 'Minimal', full: 'Full' }
    };
    for (const [key, labelMap] of Object.entries(svMap)) {
      const el = document.getElementById(`sv-${key}`);
      if (el) el.textContent = labelMap[this.prefs[key]] || this.prefs[key];
    }
    
    const calSv = document.getElementById('sv-calSyncStatus');
    if (calSv) calSv.textContent = this.prefs.calSync === 'google' ? 'Active' : '';

    // Auto backup toggle
    const tog = document.getElementById('toggleAutoBackup');
    if (tog) tog.classList.toggle('is-on', this.prefs.autoBackup);
  },

  applyAppearance() {
    const val = this.prefs.appearance;
    let isDark = val === 'dark' || (val === 'system' && this.mediaQuery.matches);
    document.body.classList.toggle('light-theme', !isDark);
  },

  applyAccentColor(color) {
    document.documentElement.style.setProperty('--accent-primary', color);
  },
  openDropdown(rowEl) {
    const setting = rowEl.dataset.setting;
    const options = JSON.parse(rowEl.dataset.options || '[]');
    const currentVal = this.prefs[setting];

    this.activeSetting = setting;
    this.activeRowEl = rowEl;

    // Build items
    let html = '';
    const isColor = setting === 'accentColor';
    for (const opt of options) {
      const selected = opt.val === currentVal ? 'is-selected' : '';
      const swatch = isColor ? `<span class="settings-dropdown-swatch" style="background:${opt.val};"></span>` : '';
      html += `
        <button class="settings-dropdown-item ${selected}" data-val="${opt.val}" data-label="${opt.label}">
          <span style="display:flex;align-items:center;gap:8px;">${swatch}${opt.label}</span>
          <iconify-icon icon="solar:check-linear" width="18" height="18" class="sdi-check"></iconify-icon>
        </button>`;
    }
    this.dropdown.innerHTML = html;

    // Position below the row, aligned to the right (near the arrow)
    const rect = rowEl.getBoundingClientRect();
    const pageRect = this.page.getBoundingClientRect();
    const top = rect.bottom - pageRect.top + 8;
    const rightEdge = pageRect.right - rect.right;
    this.dropdown.style.top = `${top}px`;
    this.dropdown.style.right = `${rightEdge}px`;
    this.dropdown.style.left = 'auto';
    this.dropdown.style.display = 'block';
  },

  closeDropdown() {
    this.dropdown.style.display = 'none';
    this.activeSetting = null;
    this.activeRowEl = null;
  },

  selectOption(val, label) {
    if (!this.activeSetting) return;
    const key = this.activeSetting;
    this.prefs[key] = val;

    // Update value label on row
    const svEl = document.getElementById(`sv-${key}`);
    if (svEl) svEl.textContent = label;

    // Apply immediate effects
    if (key === 'appearance') this.applyAppearance();
    if (key === 'accentColor') this.applyAccentColor(val);
    if (key === 'fontSize') this.applyFontSize(val);
    if (key === 'notifSound') NotificationEngine.soundEnabled = val !== 'none';

    if ((key === 'notifSound' || key === 'defaultReminder') && val !== 'none') {
      if ('Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission();
      }
    }

    this.save();
    this.closeDropdown();
  },


  save() {
    localStorage.setItem('meyePrefsV2', JSON.stringify(this.prefs));
  },

  async open() { 
    const proceed = await OverlayManager.requestOpen(this);
    if (!proceed) return;
    this.page.classList.add('is-active'); 
  },
  close() { 
    this.closeDropdown(); 
    this.page.classList.remove('is-active'); 
    OverlayManager.notifyClosed(this);
  }
};

// ============================================
// Stats & Heatmap Manager
// ============================================
const StatsManager = {
  data: {}, // { 'Calisthenics': { '2026-07-24': true, '2026-07-25': false } }
  
  extractActivityName(taskName) {
    if (!taskName) return '';
    // Look for a separator (-, —, or :) and take the first part
    const match = taskName.match(/^([^\-—:]+)/);
    return match ? match[1].trim() : taskName.trim();
  },

  init() {
    const rawData = JSON.parse(localStorage.getItem('meyeStatsNew') || '{}');
    
    // Migrate old keys to new base keys
    let migrated = false;
    this.data = {};
    for (const [oldKey, dates] of Object.entries(rawData)) {
      const baseKey = this.extractActivityName(oldKey);
      if (baseKey !== oldKey) migrated = true;
      
      if (!this.data[baseKey]) this.data[baseKey] = {};
      Object.assign(this.data[baseKey], dates);
    }
    
    if (migrated) {
      localStorage.setItem('meyeStatsNew', JSON.stringify(this.data));
    }

    // Clear old dummy data for existing users once
    if (!localStorage.getItem('meyeDummyCleared2')) {
      const dummyKeys = ['Calisthenics', 'Deep Work', 'Read', 'Meditation'];
      let clearedAny = false;
      dummyKeys.forEach(k => {
        if (this.data[k]) {
          delete this.data[k];
          clearedAny = true;
        }
      });
      if (clearedAny) {
        localStorage.setItem('meyeStatsNew', JSON.stringify(this.data));
      }
      localStorage.setItem('meyeDummyCleared2', 'true');
    }
  },

  logCompletion(taskName, isDone) {
    const today = formatDateKey(new Date());
    const baseName = this.extractActivityName(taskName);
    if (!this.data[baseName]) this.data[baseName] = {};
    this.data[baseName][today] = isDone;
    localStorage.setItem('meyeStatsNew', JSON.stringify(this.data));
  },

  getStats(taskName) {
    return this.data[this.extractActivityName(taskName)] || {};
  }
};

const HeatmapView = {
  page: null, btnOpen: null, btnBack: null,
  content: null,

  init() {
    this.page = document.getElementById('heatmapPage');
    this.btnOpen = document.getElementById('btnClipboard');
    this.btnBack = document.getElementById('heatmapBack');
    this.content = document.getElementById('heatmapContent');

    this.btnOpen.addEventListener('click', async () => {
      const proceed = await OverlayManager.requestOpen(this);
      if (!proceed) return;
      this.render();
      this.page.classList.add('is-active');
    });
    this.btnBack.addEventListener('click', () => {
      this.page.classList.remove('is-active');
      OverlayManager.notifyClosed(this);
    });
  },

  render() {
    // Collect all base activity names
    const activeTasks = new Set();
    allCards.forEach(c => {
      if (c.date === 'daily' || c.type === 'routine') {
        activeTasks.add(StatsManager.extractActivityName(c.content));
      }
    });
    Object.keys(StatsManager.data).forEach(k => activeTasks.add(k));

    let html = '';
    const today = new Date();

    activeTasks.forEach(task => {
      html += `<div class="hm-section">
        <div class="hm-task-title">${task}</div>
        <div class="hm-grid">`;

      // Render 365 days leading up to today
      const startDate = new Date();
      startDate.setDate(today.getDate() - 364);
      let currDate = new Date(startDate);
      
      for (let day = 0; day < 365; day++) {
        const dateStr = formatDateKey(currDate);
        const isDone = StatsManager.getStats(task)[dateStr] ? 'done' : '';
        html += `<div class="hm-dot ${isDone}" title="${dateStr}"></div>`;
        currDate.setDate(currDate.getDate() + 1);
      }

      html += `</div></div>`; // close grid, section
    });

    if (activeTasks.size === 0) {
      html = `<div style="text-align: center; margin-top: 60px; color: var(--text-tertiary); font-size: 15px;">No activity data yet.<br>Start recording tasks to see your heatmap.</div>`;
    }

    this.content.innerHTML = html;
  }
};

function bindInputBarEvents() {
  const recorder = new VoiceRecorder();
  Composer.init();

  document.getElementById('inputPill').addEventListener('click', (e) => {
    if (e.target.closest('.mic-btn')) {
      recorder.open();
      return;
    }
    Composer.open();
  });
}

// --- Boot ---
document.addEventListener('DOMContentLoaded', init);
