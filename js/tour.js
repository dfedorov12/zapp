'use strict';

/**
 * Kurz-Tutorial für neue Nutzer (anklickbar) – führt durch das Anlegen einer
 * Zuwendung und verweist am Ende auf den Hilfe-Reiter. Eigenständig, ohne
 * Fremdbibliothek. Startet automatisch beim ersten Besuch (localStorage) und
 * jederzeit manuell über den Button „Kurz-Tutorial".
 */

const TOUR_KEY = 'zapp_tour_v1_done';

const TOUR_STEPS = [
  { center: true, title: 'Willkommen bei ZAPP 👋',
    text: 'In wenigen Klicks melden Sie eine Zuwendung (ein erhaltenes oder gegebenes Geschenk, eine Einladung, eine Bewirtung …). Dieses kurze Tutorial zeigt Ihnen, wie – in unter einer Minute.' },
  { sel: '#fRichtung', title: '1) Richtung & Art',
    text: 'Zuerst: Haben Sie die Zuwendung <b>erhalten</b> oder <b>gegeben</b>? Und um welche <b>Art</b> handelt es sich (Geschenk, Bewirtung, Einladung …)?' },
  { sel: '#fBetrag', title: '2) Wert & Datum',
    text: 'Tragen Sie den <b>Wert in Euro</b> ein (ruhig geschätzt) und das <b>Datum</b> der Zuwendung.' },
  { sel: '#fPartner', title: '3) Geschäftspartner',
    text: 'Wer ist der Geschäftspartner? Bereits erfasste Partner werden vorgeschlagen – verwenden Sie bitte denselben Namen. Das ist wichtig für die Jahressumme (<b>Kumulierung</b>).' },
  { sel: '#fAmtstraeger', title: 'Amtsträger & Ausschreibung',
    text: 'Ist der Empfänger ein <b>Amtsträger</b>? Läuft mit dem Partner gerade eine <b>Ausschreibung/Vergabe</b>? Beides verschärft die Prüfung.' },
  { sel: '#bewertung', title: 'Sofort-Bewertung (Ampel)', onEnter: _tourDemoBanner,
    text: 'Während Sie ausfüllen, erscheint hier eine Ampel: <b>grün</b> = wird nur gespeichert, <b>gelb</b> = dokumentieren, <b>rot</b> = Genehmigung nötig. Sie sehen also sofort, was passiert.' },
  { sel: '#fAnlagen', title: 'Belege anhängen',
    text: 'Fügen Sie Belege bei (Rechnung, Beleg, Mailverkehr). Bei einer Genehmigung werden sie automatisch mitgeschickt.' },
  { sel: '#btnAbsenden', title: 'Melden – fertig',
    text: 'Mit <b>„Zuwendung melden"</b> absenden. Sie bekommen sofort eine Rückmeldung und – falls nötig – eine E-Mail zum Genehmigungsstatus.' },
  { sel: '.nav-btn[data-view="meine"]', title: 'Status verfolgen',
    text: 'Unter <b>„Meine Vorgänge"</b> sehen Sie jederzeit den Stand Ihrer Meldungen.' },
  { center: true, title: 'Das war’s! 🎉', hilfe: true,
    text: 'Sie können jetzt loslegen. Eine ausführliche Erklärung – Bewertung, Ablauf, Datenschutz – finden Sie jederzeit im Reiter <b>Hilfe</b>.' },
];

let _tourIdx = -1;
let _tourTarget = null;
let _demoSnapshot = null;

function tourSeen() { try { return localStorage.getItem(TOUR_KEY) === '1'; } catch (e) { return false; } }
function _tourMarkSeen() { try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) { /* egal */ } }

/** Beim ersten Besuch automatisch starten (nur wenn die Maske vorhanden ist). */
function maybeAutoStartTour() {
  if (tourSeen()) return;
  if (!document.getElementById('fRichtung')) return;
  setTimeout(() => { if (!tourSeen()) startTour(false); }, 600);
}

function startTour(force) {
  if (!document.getElementById('fRichtung')) return;
  if (typeof switchView === 'function') switchView('neu');   // Formular sichtbar machen
  _ensureTourDom();
  _tourIdx = 0;
  _showTourStep(0);
  window.addEventListener('resize', _positionTour);
  window.addEventListener('scroll', _positionTour, true);
}

function tourNext() { if (_tourIdx < TOUR_STEPS.length - 1) _showTourStep(++_tourIdx); else tourEnd(); }
function tourPrev() { if (_tourIdx > 0) _showTourStep(--_tourIdx); }
function tourToHilfe() { tourEnd(); if (typeof switchView === 'function') switchView('hilfe'); }

function tourEnd() {
  _tourClearDemo();
  _tourMarkSeen();
  window.removeEventListener('resize', _positionTour);
  window.removeEventListener('scroll', _positionTour, true);
  const dim = document.getElementById('tour-spot'), tip = document.getElementById('tour-tip');
  if (dim) dim.remove();
  if (tip) tip.remove();
  _tourIdx = -1; _tourTarget = null;
}

function _ensureTourDom() {
  if (!document.getElementById('tour-spot')) {
    const s = document.createElement('div'); s.id = 'tour-spot'; document.body.appendChild(s);
  }
  if (!document.getElementById('tour-tip')) {
    const t = document.createElement('div'); t.id = 'tour-tip'; document.body.appendChild(t);
  }
}

function _showTourStep(i) {
  _tourClearDemo();
  const step = TOUR_STEPS[i];
  if (!step) { tourEnd(); return; }
  if (typeof step.onEnter === 'function') step.onEnter();

  _tourTarget = step.center ? null : document.querySelector(step.sel);
  if (!step.center && _tourTarget && _tourTarget.scrollIntoView) {
    _tourTarget.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  const tip = document.getElementById('tour-tip');
  const last = i === TOUR_STEPS.length - 1;
  tip.innerHTML = `
    <div class="tour-count">Schritt ${i + 1} / ${TOUR_STEPS.length}</div>
    <h4>${step.title}</h4>
    <p>${step.text}</p>
    <div class="tour-btns">
      <button class="tour-skip" onclick="tourEnd()">Überspringen</button>
      <div class="tour-spacer"></div>
      ${i > 0 ? '<button class="tour-back" onclick="tourPrev()">Zurück</button>' : ''}
      ${step.hilfe ? '<button class="tour-hilfe" onclick="tourToHilfe()">Zur Hilfe</button>' : ''}
      <button class="tour-next" onclick="tourNext()">${last ? 'Fertig' : 'Weiter'}</button>
    </div>`;
  _positionTour();               // synchron (unabhängig von requestAnimationFrame/Tab-Sichtbarkeit)
}

function _positionTour() {
  const spot = document.getElementById('tour-spot');
  const tip = document.getElementById('tour-tip');
  if (!spot || !tip) return;
  const vw = window.innerWidth, vh = window.innerHeight;

  if (!_tourTarget) {              // zentrierter Schritt (Intro/Ende)
    spot.className = 'tour-spot-full';
    spot.style.cssText = '';
    tip.style.left = Math.max(12, (vw - tip.offsetWidth) / 2) + 'px';
    tip.style.top = Math.max(12, (vh - tip.offsetHeight) / 2) + 'px';
    return;
  }

  const r = _tourTarget.getBoundingClientRect();
  const pad = 6;
  spot.className = '';
  spot.style.cssText =
    `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + 2 * pad}px;height:${r.height + 2 * pad}px;`;

  const th = tip.offsetHeight, tw = tip.offsetWidth;
  let top = r.bottom + 12;
  if (top + th > vh - 12) top = Math.max(12, r.top - th - 12);   // sonst darüber
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.min(Math.max(12, left), vw - tw - 12);
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

/* Beispiel-Ampel für den Bewertungs-Schritt einblenden und später zurücksetzen. */
function _tourDemoBanner() {
  const b = document.getElementById('bewertung');
  if (!b) return;
  _demoSnapshot = { hidden: b.hidden, html: b.innerHTML, cls: b.className };
  b.hidden = false;
  b.className = 'banner banner-red';
  b.innerHTML = '<strong>Beispiel: Genehmigungspflichtig</strong><ul><li>Betrag über der Genehmigungsschwelle</li></ul>';
}
function _tourClearDemo() {
  if (!_demoSnapshot) return;
  const b = document.getElementById('bewertung');
  if (b) { b.hidden = _demoSnapshot.hidden; b.innerHTML = _demoSnapshot.html; b.className = _demoSnapshot.cls; }
  _demoSnapshot = null;
}
