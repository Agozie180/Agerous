/**
 * AGEROUS — UI Controller
 *
 * Manages all DOM panels: history, active events bar,
 * HUD clock, institution status, time-speed control.
 * Reads world state — never writes to it directly.
 */

import { WEATHER } from '../simulation/worldState.js';
import { activityLabel } from '../simulation/npcSystem.js';

const WEATHER_ICONS = {
  [WEATHER.CLEAR]:      { icon: '☀',  label: 'Clear'      },
  [WEATHER.CLOUDY]:     { icon: '⛅', label: 'Cloudy'     },
  [WEATHER.RAIN]:       { icon: '🌧', label: 'Rain'       },
  [WEATHER.HEAVY_RAIN]: { icon: '⛈', label: 'Heavy Rain' },
  [WEATHER.FLOOD]:      { icon: '🌊', label: 'Flood'      },
};

export class UIController {
  constructor() {
    this._dayLabel     = document.getElementById('day-label');
    this._timeLabel    = document.getElementById('time-label');
    this._weatherIcon  = document.getElementById('weather-icon');
    this._weatherLabel = document.getElementById('weather-label');
    this._activeBar    = document.getElementById('active-events-bar');
    this._activeText   = document.getElementById('active-events-text');
    this._historyList  = document.getElementById('history-list');
    this._simStatus    = document.getElementById('sim-status');
    this._simulateBtn  = document.getElementById('simulate-btn');
    this._eventInput   = document.getElementById('event-input');
    this._statusPanel  = document.getElementById('status-panel');
    this._speedSlider  = document.getElementById('speed-slider');
    this._speedLabel   = document.getElementById('speed-label');

    this._lastHistoryLen = 0;
  }

  // ─── Clock ───────────────────────────────────────────────────

  updateClock(state) {
    const h = String(Math.floor(state.hour)).padStart(2, '0');
    const m = String(Math.floor(state.minute)).padStart(2, '0');
    this._dayLabel.textContent  = `DAY ${state.day}`;
    this._timeLabel.textContent = `${h}:${m}`;
  }

  // ─── Weather ─────────────────────────────────────────────────

  updateWeather(state) {
    const w = WEATHER_ICONS[state.weather] || WEATHER_ICONS[WEATHER.CLEAR];
    this._weatherIcon.textContent  = w.icon;
    this._weatherLabel.textContent = w.label;
  }

  // ─── Active Events Bar ───────────────────────────────────────

  updateActiveEvents(state) {
    const events    = state.activeEvents;
    const isWarning = state.flood.active || events.some(e =>
      e.type === 'flood' || e.type === 'market_disruption'
    );

    if (events.length === 0) {
      this._activeText.textContent = 'Normal day';
      this._activeBar.classList.remove('warning');
    } else {
      this._activeText.textContent = events.map(e => e.label || e.type).join(' · ');
      if (isWarning) this._activeBar.classList.add('warning');
      else           this._activeBar.classList.remove('warning');
    }
  }

  // ─── Institution Status Panel ────────────────────────────────

  updateStatusPanel(state) {
    if (!this._statusPanel) return;

    const { institutions, flags, flood } = state;
    const s = institutions.school;
    const m = institutions.market;
    const c = institutions.church;
    const e = institutions.election;

    const rows = [
      {
        label: '🏫 School',
        value: flags.schoolClosed ? 'CLOSED' :
               flags.schoolExam   ? 'Exams'  :
               `${s.studentCount} students · ${s.teacherCount} teachers`,
        warn:  flags.schoolClosed,
      },
      {
        label: '🛒 Market',
        value: flags.marketFlooded ? 'FLOODED' :
               m.disrupted         ? `Disrupted · flow ${(m.customerFlow * 100).toFixed(0)}%` :
               m.shipmentBonus     ? `Busy · ${m.vendorCount} vendors (shipment)` :
               `${m.vendorCount} vendors · flow ${(m.customerFlow * 100).toFixed(0)}%`,
        warn:  flags.marketFlooded || m.disrupted,
      },
      {
        label: '⛪ Church',
        value: c.isShelter        ? `Shelter · ${c.congregationCount} inside` :
               c.serviceActive    ? `Service · ${c.congregationCount} inside` :
               'Closed',
        good:  c.isShelter || c.serviceActive,
      },
      {
        label: '🗳 Election',
        value: e.completed         ? `✓ ${e.winner?.name} won (${e.totalVotes} votes)` :
               flags.electionDay   ? `Voting · ${e.candidates.map(c => `${c.name} ${c.votes}`).join(' vs ')}` :
               e.campaignActive    ? `Campaign · Day ${e.electionDay}` :
               e.announced         ? `Announced · Day ${e.electionDay}` :
               'No election',
        good:  e.completed,
      },
      {
        label: '🌊 Flood',
        value: flood.active ? `${flood.recovering ? 'Receding' : 'Active'} · water ${state.waterLevel.toFixed(0)}%` :
               state.waterLevel > 0 ? `Receding · ${state.waterLevel.toFixed(0)}%` :
               'None',
        warn:  flood.active,
      },
    ];

    this._statusPanel.innerHTML = rows.map(r => {
      const cls = r.warn ? 'status-warn' : r.good ? 'status-good' : '';
      return `<div class="status-row ${cls}">
        <span class="status-label">${r.label}</span>
        <span class="status-value">${r.value}</span>
      </div>`;
    }).join('');
  }

  // ─── History Panel ───────────────────────────────────────────

  updateHistory(state) {
    if (state.history.length === this._lastHistoryLen) return;

    const newEntries = state.history.slice(this._lastHistoryLen);
    this._lastHistoryLen = state.history.length;

    for (const entry of newEntries) {
      if (entry.text.startsWith('--- Day')) {
        const header = document.createElement('div');
        header.className   = 'history-day-header';
        header.textContent = `Day ${entry.day}`;
        this._historyList.appendChild(header);
      } else {
        const el = document.createElement('div');
        el.className   = `history-entry${entry.importance !== 'normal' ? ' event-' + entry.importance : ''}`;
        el.textContent = entry.text;
        this._historyList.appendChild(el);
      }
    }

    // Scroll to bottom
    this._historyList.scrollTop = this._historyList.scrollHeight;
  }

  /** Clear the DOM history list (called on world reset). */
  resetHistory() {
    this._historyList.innerHTML = '';
    this._lastHistoryLen = 0;
  }

  // ─── Simulate Button State ───────────────────────────────────

  setSimulating(loading, msg = '') {
    this._simulateBtn.disabled  = loading;
    this._simStatus.textContent = msg;
  }

  getInputText() {
    return this._eventInput.value.trim();
  }

  clearInput() {
    this._eventInput.value = '';
  }

  showStatus(msg, color = '#94a3b8') {
    this._simStatus.textContent = msg;
    this._simStatus.style.color = color;
  }

  // ─── Time speed slider ───────────────────────────────────────

  setupSpeedControl(state) {
    if (!this._speedSlider) return;

    if (this._speedControlHandler) {
      this._speedSlider.removeEventListener('input', this._speedControlHandler);
    }

    this._speedSlider.value = state.timeSpeed;
    this._updateSpeedLabel(state.timeSpeed);

    this._speedControlHandler = () => {
      const v = Number(this._speedSlider.value);
      state.timeSpeed = v;
      this._updateSpeedLabel(v);
    };

    this._speedSlider.addEventListener('input', this._speedControlHandler);
  }

  _updateSpeedLabel(v) {
    if (!this._speedLabel) return;
    const label = v <= 6 ? 'Slow' : v <= 20 ? 'Normal' : 'Fast';
    this._speedLabel.textContent = `${label} (${v}×)`;
  }

  // ─── Full update tick ────────────────────────────────────────

  update(state) {
    this.updateClock(state);
    this.updateWeather(state);
    this.updateActiveEvents(state);
    this.updateHistory(state);
    this.updateStatusPanel(state);
  }
}
