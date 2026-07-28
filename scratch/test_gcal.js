const jsdom = require("jsdom");
const { JSDOM } = jsdom;

const dom = new JSDOM(`<!DOCTYPE html>
<html>
  <body>
    <div id="editContent"></div>
    <div id="editDetails"></div>
    <div id="menuTranscript"></div>
    <div id="expandedOverlay" class="expanded-overlay">
      <div id="expandedEditor"></div>
      <div id="expandedTags"></div>
    </div>
  </body>
</html>`);

global.document = dom.window.document;
global.window = dom.window;

const allCards = [
  {
    id: 'gcal_123',
    type: 'calendar',
    date: '2026-07-26',
    content: 'Meeting',
    eventTime: '14:00 – 15:00',
    tags: ['Google Calendar']
  }
];

function formatTime(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return '';
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

const OverlayManager = {
  requestOpen: async () => true,
  notifyClosed: () => console.log('notifyClosed called')
};

const ExpandedCardView = {
  overlay: document.getElementById('expandedOverlay'),
  editorBox: document.getElementById('expandedEditor'),
  tagsBox: document.getElementById('expandedTags'),
  menuTranscript: document.getElementById('menuTranscript'),
  currentCard: null,
  
  async open(cardId) {
    console.log("opening", cardId);
    const proceed = await OverlayManager.requestOpen(this);
    if (!proceed) return;
    this.currentCard = allCards.find(c => String(c.id) === String(cardId));
    if (!this.currentCard) {
      console.log("Card not found");
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

    this.renderEditor();
    
    if (this.tagsBox) {
      this.tagsBox.innerHTML = (this.currentCard.tags || []).map(t => `<span class="tag">${t}</span>`).join('');
    }

    if (this.overlay) {
      this.overlay.classList.add('is-active');
      console.log("is-active added successfully");
    }
  },

  renderEditor() {
    const c = this.currentCard;
    let html = '';

    if (c.type === 'calendar') {
      let dateStr = 'Anytime';
      if (c.date) {
        const dPart = c.date.split('-');
        const d = new Date(dPart[0], dPart[1] - 1, dPart[2]);
        dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      }
      const [startRaw = '', endRaw = ''] = (c.eventTime || '').split('–').map(value => value.trim());
      html = `
        <div class="exp-cal-view">
          <textarea class="exp-todo-title" id="editContent" rows="1">${c.content}</textarea>
          <span id="displayCalDate">${dateStr}</span>
          <span id="displayCalStartTime">${formatTime(startRaw) || 'Start time'}</span>
          <span id="displayCalEndTime">${formatTime(endRaw) || 'End time'}</span>
        </div>
      `;
    }

    this.editorBox.innerHTML = html;
    this._bindEditorEvents();
  },

  _bindEditorEvents() {
    console.log("bindEditorEvents ran");
  }
};

ExpandedCardView.open('gcal_123').catch(console.error);
