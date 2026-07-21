"use strict";

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

const state = {
  me: null,            // { displayName, mail }
  cfgTypes: {},        // Schwellen-Zeilen je Empfängertyp: { "Nicht-Amtsträger": {...}, "Amtsträger": {...} }
  cfgGlobal: {},       // globale Rollen/Genehmiger (aus Zeile "Allgemein")
  cfgRowIds: {},       // Title -> Listen-Item-ID (zum Speichern der Einstellungen)
  items: [],           // alle für mich sichtbaren ZAPP-Einträge (Berechtigungen filtert SharePoint)
  isCO: false,         // Compliance Officer oder Vertreter?
  isAdmin: false       // darf Einstellungen ändern?
};

const EUR = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const $ = id => document.getElementById(id);

// ---------------------------------------------------------------------------
// Initialisierung
// ---------------------------------------------------------------------------

async function init() {
  try {
    const account = await ensureLogin();
    if (!account) return; // Redirect zum Login läuft

    $("loadingText").textContent = "Daten werden geladen …";
    const me = await getMe();
    state.me = { displayName: me.displayName, mail: (me.mail || me.userPrincipalName || "").toLowerCase() };
    $("userName").textContent = me.displayName;
    $("userChip").hidden = false;

    await Promise.all([loadConfig(), loadItems()]);
    ermittleRollen();

    bindUi();
    renderAll();

    $("loadingScreen").hidden = true;
    $("mainNav").hidden = false;
    $("mainContent").hidden = false;

    // Deep-Link aus Benachrichtigungs-Mail: ?vorgang=<id>
    const vorgangId = new URLSearchParams(location.search).get("vorgang");
    if (vorgangId) {
      const item = state.items.find(i => String(i.id) === vorgangId);
      if (item) { switchView("genehmigungen"); openDetail(item); }
    }
  } catch (e) {
    $("loadingText").textContent = "Fehler beim Start: " + e.message;
    console.error(e);
  }
}

async function loadConfig() {
  const rows = await getAllItems(ZAPP_CONFIG.configListName);
  state.cfgTypes = {};
  state.cfgRowIds = {};
  let allgemein = null;
  for (const r of rows) {
    state.cfgRowIds[r.fields.Title] = r.id;
    if (r.fields.Title === "Allgemein") allgemein = r.fields;
    else state.cfgTypes[r.fields.Title] = r.fields;
  }
  if (!state.cfgTypes["Nicht-Amtsträger"] || !state.cfgTypes["Amtsträger"]) {
    throw new Error("ZAPP_Konfiguration unvollständig: Zeilen 'Nicht-Amtsträger' und 'Amtsträger' werden benötigt.");
  }
  // Globale Rollen bevorzugt aus der Zeile "Allgemein"; sonst Fallback auf die
  // (älteren) CO-/Vertreter-Felder der Nicht-Amtsträger-Zeile.
  const g = allgemein || {};
  const fb = state.cfgTypes["Nicht-Amtsträger"];
  const co = normMail(g.ComplianceOfficerEmail || fb.ComplianceOfficerEmail);
  const vertreter = normMail(g.VertreterEmail || fb.VertreterEmail);
  let admins = (g.AdminEmails || "").split(/[;,]/).map(normMail).filter(Boolean);
  if (admins.length === 0) admins = [co, vertreter].filter(Boolean);
  state.cfgGlobal = {
    ComplianceOfficerEmail: co,
    VertreterEmail: vertreter,
    AdminEmails: admins,
    Genehmiger1Modus: g.Genehmiger1Modus === "Fest" ? "Fest" : "Fuehrungskraft",
    Genehmiger1Email: normMail(g.Genehmiger1Email)
  };
}

function ermittleRollen() {
  const g = state.cfgGlobal;
  state.isCO = [g.ComplianceOfficerEmail, g.VertreterEmail].filter(Boolean).includes(state.me.mail);
  state.isAdmin = state.isCO || g.AdminEmails.includes(state.me.mail);
  $("navAuswertung").hidden = !state.isCO;
  $("navEinstellungen").hidden = !state.isAdmin;
}

async function loadItems() {
  state.items = await getAllItems(ZAPP_CONFIG.listName);
  state.items.sort((a, b) => new Date(b.createdDateTime) - new Date(a.createdDateTime));
}

function normMail(m) { return (m || "").toLowerCase().trim(); }

// ---------------------------------------------------------------------------
// Bewertungslogik (Schwellen + Kumulierung + Red Flag)
// ---------------------------------------------------------------------------

function cfgFor(empfaengerTyp) {
  return state.cfgTypes[empfaengerTyp === "Ja" || empfaengerTyp === "Amtsträger" ? "Amtsträger" : "Nicht-Amtsträger"];
}

// Genehmiger für Stufe 1: fester Genehmiger oder Führungskraft (Fallback Compliance Officer)
async function ermittleGenehmigerStufe1() {
  const co = state.cfgGlobal.ComplianceOfficerEmail;
  if (state.cfgGlobal.Genehmiger1Modus === "Fest") {
    return state.cfgGlobal.Genehmiger1Email || co;
  }
  const manager = await getManager(state.me.mail);
  let m = normMail(manager ? (manager.mail || manager.userPrincipalName) : "");
  if (!m || m === state.me.mail) m = co; // kein/eigener Manager -> CO
  return m;
}

// Jahressumme des Antragstellers beim selben Partner (ohne den aktuellen Antrag)
function jahressummePartner(partner, antragstellerMail, jahr) {
  const p = (partner || "").toLowerCase().trim();
  if (!p) return 0;
  return state.items
    .filter(i => {
      const f = i.fields;
      return normMail(f.AntragstellerEmail) === normMail(antragstellerMail)
        && (f.Geschaeftspartner || "").toLowerCase().trim() === p
        && f.DatumZuwendung && new Date(f.DatumZuwendung).getFullYear() === jahr
        && f.Status !== "Abgelehnt" && f.Status !== "Archiviert";
    })
    .reduce((sum, i) => sum + (parseFloat(i.fields.Betrag) || 0), 0);
}

// Ergebnis: { stufe: "keine" | "doku" | "genehmigung", gruende: [...] }
function bewerte(betrag, summeVorher, cfg, redFlag) {
  const gesamt = betrag + summeVorher;
  const gruende = [];
  if (redFlag) gruende.push("Laufende Ausschreibung/Vertragsverhandlung mit diesem Partner (Red Flag)");
  if (betrag >= cfg.GenehmigungsSchwelle) gruende.push(`Betrag ${EUR.format(betrag)} ≥ Genehmigungsschwelle ${EUR.format(cfg.GenehmigungsSchwelle)}`);
  if (gesamt >= cfg.KumulierungsSchwelleJahr) gruende.push(`Jahressumme bei diesem Partner ${EUR.format(gesamt)} ≥ Kumulierungsschwelle ${EUR.format(cfg.KumulierungsSchwelleJahr)}`);
  if (gruende.length) return { stufe: "genehmigung", gruende, gesamt };
  if (betrag >= cfg.DokuSchwelle) return { stufe: "doku", gruende: [`Betrag ≥ Dokumentationsschwelle ${EUR.format(cfg.DokuSchwelle)}`], gesamt };
  return { stufe: "keine", gruende: [], gesamt };
}

function liveBewertung() {
  const betrag = parseFloat($("fBetrag").value);
  const partner = $("fPartner").value;
  const amtstraeger = $("fAmtstraeger").value;
  const ausschreibung = $("fAusschreibung").value;
  const banner = $("bewertung");

  if (isNaN(betrag) || !amtstraeger) { banner.hidden = true; return; }

  const cfg = cfgFor(amtstraeger);
  const jahr = $("fDatum").value ? new Date($("fDatum").value).getFullYear() : new Date().getFullYear();
  const summeVorher = jahressummePartner(partner, state.me.mail, jahr);
  const redFlag = ausschreibung !== "" && ausschreibung !== "Nein";
  const erg = bewerte(betrag, summeVorher, cfg, redFlag);

  banner.hidden = false;
  banner.className = "banner " + { keine: "banner-green", doku: "banner-yellow", genehmigung: "banner-red" }[erg.stufe];
  const kopf = {
    keine: "Keine Dokumentation oder Genehmigung erforderlich – die Meldung wird lediglich gespeichert.",
    doku: "Dokumentationspflichtig – keine Genehmigung erforderlich.",
    genehmigung: "Genehmigungspflichtig – der Vorgang wird zur Genehmigung weitergeleitet."
  }[erg.stufe];
  let html = `<strong>${kopf}</strong>`;
  if (erg.gruende.length) html += "<ul>" + erg.gruende.map(g => `<li>${escapeHtml(g)}</li>`).join("") + "</ul>";
  if (summeVorher > 0) html += `<div class="banner-note">Bereits gemeldet bei diesem Partner in ${jahr}: ${EUR.format(summeVorher)}</div>`;
  banner.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Einreichen
// ---------------------------------------------------------------------------

async function submitZuwendung(ev) {
  ev.preventDefault();
  const btn = $("btnAbsenden");
  btn.disabled = true;
  btn.textContent = "Wird gespeichert …";

  try {
    const betrag = parseFloat($("fBetrag").value);
    const amtstraeger = $("fAmtstraeger").value;
    const ausschreibung = $("fAusschreibung").value;
    const cfg = cfgFor(amtstraeger);
    const jahr = new Date($("fDatum").value).getFullYear();
    const summeVorher = jahressummePartner($("fPartner").value, state.me.mail, jahr);
    const redFlag = ausschreibung !== "Nein";
    const erg = bewerte(betrag, summeVorher, cfg, redFlag);

    let anmerkungen = $("fAnmerkungen").value.trim();
    anmerkungen = `Bereits gewährt/angenommen: ${$("fGewaehrt").value} · Häufigkeit: ${$("fWiederkehrend").value}`
      + (anmerkungen ? "\n\n" + anmerkungen : "");

    const fields = {
      Richtung: $("fRichtung").value,
      ArtZuwendung: $("fArt").value,
      Beschreibung: $("fBeschreibung").value.trim(),
      Betrag: betrag,
      DatumZuwendung: $("fDatum").value,
      Anlass: $("fAnlass").value.trim(),
      Geschaeftspartner: $("fPartner").value.trim(),
      PartnerPerson: $("fPartnerPerson").value.trim(),
      EmpfaengerTyp: amtstraeger === "Ja" ? "Amtsträger" : "Nicht-Amtsträger",
      RedFlag: redFlag,
      KumulierteSummeJahr: erg.gesamt,
      AntragstellerEmail: state.me.mail,
      Anmerkungen: anmerkungen
    };

    let genehmigerMail = null;
    if (erg.stufe === "genehmigung") {
      genehmigerMail = await ermittleGenehmigerStufe1();
      fields.Status = "In Genehmigung Stufe 1";
      fields.GenehmigungGestartet = new Date().toISOString();
      fields.AktuellerGenehmigerEmail = genehmigerMail;
      fields.ErinnerungGesendet = false;
      fields.EskalationGesendet = false;
    } else {
      fields.Status = erg.stufe === "doku" ? "Dokumentiert" : "Kein Handlungsbedarf";
    }

    const created = await createItem(ZAPP_CONFIG.listName, fields);
    const vorgangsNr = `ZW-${jahr}-${String(created.id).padStart(4, "0")}`;
    await updateItemFields(ZAPP_CONFIG.listName, created.id, { Title: vorgangsNr });

    // Anlagen hochladen
    const files = Array.from($("fAnlagen").files || []);
    for (const file of files) {
      if (file.size > ZAPP_CONFIG.maxAttachmentBytes) {
        showToast(`"${file.name}" übersprungen – größer als 4 MB.`);
        continue;
      }
      await uploadAnlage(vorgangsNr, file);
    }

    // Benachrichtigung an Genehmiger
    if (genehmigerMail) {
      await sendMail(
        genehmigerMail,
        `ZAPP: Genehmigung erforderlich – ${vorgangsNr} (${fields.Geschaeftspartner}, ${EUR.format(betrag)})`,
        mailHtml(created.id, vorgangsNr, fields, erg)
      ).catch(e => showToast("Vorgang gespeichert, aber Mail fehlgeschlagen: " + e.message));
    }

    await loadItems();
    renderAll();
    $("formZuwendung").reset();
    $("bewertung").hidden = true;

    const meldung = {
      keine: `${vorgangsNr} gespeichert. Keine Dokumentation und Genehmigung erforderlich.`,
      doku: `${vorgangsNr} gespeichert. Die Zuwendung wurde dokumentiert, eine Genehmigung ist nicht erforderlich.`,
      genehmigung: `${vorgangsNr} eingereicht. Der Vorgang wurde zur Genehmigung an ${genehmigerMail} weitergeleitet.`
    }[erg.stufe];
    showToast(meldung, 6000);
    switchView("meine");
  } catch (e) {
    console.error(e);
    showToast("Fehler beim Speichern: " + e.message, 8000);
  } finally {
    btn.disabled = false;
    btn.textContent = "Zuwendung melden";
  }
}

function mailHtml(itemId, vorgangsNr, f, erg) {
  const link = `${location.origin}${location.pathname}?vorgang=${itemId}`;
  const zeile = (k, v) => `<tr><td style="padding:2px 12px 2px 0;color:#666">${k}</td><td style="padding:2px 0"><strong>${escapeHtml(String(v ?? ""))}</strong></td></tr>`;
  return `
    <p>Eine Zuwendungsmeldung wartet auf Ihre Entscheidung:</p>
    <table style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:14px">
      ${zeile("Vorgang", vorgangsNr)}
      ${zeile("Antragsteller", state.me.displayName)}
      ${zeile("Richtung", f.Richtung)}
      ${zeile("Art", f.ArtZuwendung)}
      ${zeile("Geschäftspartner", f.Geschaeftspartner)}
      ${zeile("Betrag", EUR.format(f.Betrag))}
      ${zeile("Jahressumme bei diesem Partner", EUR.format(erg.gesamt))}
      ${zeile("Anlass", f.Anlass)}
      ${zeile("Empfängertyp", f.EmpfaengerTyp)}
      ${f.RedFlag ? zeile("⚠ Red Flag", "Laufende Ausschreibung/Verhandlung mit dem Partner") : ""}
    </table>
    <p><a href="${link}">Vorgang in ZAPP öffnen und entscheiden</a></p>
    <p style="color:#888;font-size:12px">Diese Nachricht wurde automatisch von der ZAPP (Zuwendungs-App) erstellt.</p>`;
}

// ---------------------------------------------------------------------------
// Genehmigung
// ---------------------------------------------------------------------------

function offeneGenehmigungen() {
  return state.items.filter(i => {
    const f = i.fields;
    if (!(f.Status || "").startsWith("In Genehmigung")) return false;
    return state.isCO || normMail(f.AktuellerGenehmigerEmail) === state.me.mail;
  });
}

function darfEntscheiden(item) {
  const f = item.fields;
  if (!(f.Status || "").startsWith("In Genehmigung")) return false;
  if (normMail(f.AktuellerGenehmigerEmail) === state.me.mail) return true;
  // CO/Vertreter dürfen immer entscheiden (Vertretungsfall)
  return state.isCO;
}

async function entscheiden(item, genehmigt) {
  const f = item.fields;
  const stufe = (f.Status || "").includes("Stufe 2") ? 2 : 1;
  const cfg = cfgFor(f.EmpfaengerTyp);
  const kommentarText = $("modalKommentar").value.trim();
  const stempel = `[${genehmigt ? "Genehmigt" : "Abgelehnt"} durch ${state.me.displayName} am ${new Date().toLocaleDateString("de-DE")}]`
    + (kommentarText ? " " + kommentarText : "");

  const update = {};
  update[`Entscheidung${stufe}`] = genehmigt ? "Genehmigt" : "Abgelehnt";
  update[`Kommentar${stufe}`] = stempel;

  let mailTo, mailSubject, mailBody;
  const link = `${location.origin}${location.pathname}?vorgang=${item.id}`;

  if (!genehmigt) {
    update.Status = "Abgelehnt";
    mailTo = f.AntragstellerEmail;
    mailSubject = `ZAPP: ${f.Title} wurde abgelehnt`;
    mailBody = `<p>Ihre Zuwendungsmeldung <strong>${escapeHtml(f.Title)}</strong> (${escapeHtml(f.Geschaeftspartner)}, ${EUR.format(f.Betrag)}) wurde <strong>abgelehnt</strong>.</p>
      <p>${escapeHtml(stempel)}</p><p><a href="${link}">Vorgang öffnen</a></p>`;
  } else if (stufe === 1 && cfg.ZweistufigAktiv) {
    update.Status = "In Genehmigung Stufe 2";
    update.AktuellerGenehmigerEmail = state.cfgGlobal.ComplianceOfficerEmail;
    update.ErinnerungGesendet = false;
    update.EskalationGesendet = false;
    mailTo = state.cfgGlobal.ComplianceOfficerEmail;
    mailSubject = `ZAPP: Genehmigung Stufe 2 erforderlich – ${f.Title} (${f.Geschaeftspartner}, ${EUR.format(f.Betrag)})`;
    mailBody = `<p>Der Vorgang <strong>${escapeHtml(f.Title)}</strong> wurde in Stufe 1 genehmigt und wartet nun auf Ihre Entscheidung (Stufe 2).</p>
      <p>${escapeHtml(stempel)}</p><p><a href="${link}">Vorgang in ZAPP öffnen und entscheiden</a></p>`;
  } else {
    update.Status = "Genehmigt";
    mailTo = f.AntragstellerEmail;
    mailSubject = `ZAPP: ${f.Title} wurde genehmigt`;
    mailBody = `<p>Ihre Zuwendungsmeldung <strong>${escapeHtml(f.Title)}</strong> (${escapeHtml(f.Geschaeftspartner)}, ${EUR.format(f.Betrag)}) wurde <strong>genehmigt</strong>.</p>
      <p>${escapeHtml(stempel)}</p><p><a href="${link}">Vorgang öffnen</a></p>`;
  }

  await updateItemFields(ZAPP_CONFIG.listName, item.id, update);
  if (mailTo) {
    await sendMail(mailTo, mailSubject, mailBody)
      .catch(e => showToast("Entscheidung gespeichert, aber Mail fehlgeschlagen: " + e.message));
  }
  closeModal();
  await loadItems();
  renderAll();
  showToast(`${f.Title}: Entscheidung gespeichert.`);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderAll() {
  renderPartnerListe();
  renderMeine();
  renderGenehmigungen();
  if (state.isCO) renderAuswertung();
  if (state.isAdmin) renderEinstellungen();
}

function renderPartnerListe() {
  const partner = [...new Set(state.items.map(i => (i.fields.Geschaeftspartner || "").trim()).filter(Boolean))].sort();
  $("partnerListe").innerHTML = partner.map(p => `<option value="${escapeHtml(p)}">`).join("");
}

const STATUS_CLASS = {
  "Kein Handlungsbedarf": "st-green", "Dokumentiert": "st-green", "Genehmigt": "st-green",
  "In Genehmigung Stufe 1": "st-yellow", "In Genehmigung Stufe 2": "st-yellow", "In Genehmigung": "st-yellow",
  "Eingereicht": "st-yellow", "Abgelehnt": "st-red", "Archiviert": "st-gray"
};

function itemCard(item, aktionen = "") {
  const f = item.fields;
  const cls = STATUS_CLASS[f.Status] || "st-gray";
  return `
    <div class="item-card" data-id="${item.id}">
      <div class="item-head">
        <strong>${escapeHtml(f.Title || "–")}</strong>
        <span class="status ${cls}">${escapeHtml(f.Status || "–")}</span>
      </div>
      <div class="item-line">${escapeHtml(f.Richtung || "")} · ${escapeHtml(f.ArtZuwendung || "")} · <strong>${EUR.format(f.Betrag || 0)}</strong></div>
      <div class="item-line">${escapeHtml(f.Geschaeftspartner || "")}${f.RedFlag ? ' <span class="redflag">⚠ Red Flag</span>' : ""}</div>
      <div class="item-line muted">${f.DatumZuwendung ? new Date(f.DatumZuwendung).toLocaleDateString("de-DE") : ""} · ${escapeHtml(f.Anlass || "")}</div>
      ${aktionen}
    </div>`;
}

function renderMeine() {
  const meine = state.items.filter(i => normMail(i.fields.AntragstellerEmail) === state.me.mail);
  $("meineListe").innerHTML = meine.length
    ? meine.map(i => itemCard(i)).join("")
    : '<p class="hint">Noch keine Vorgänge vorhanden.</p>';
  $("meineListe").querySelectorAll(".item-card").forEach(el =>
    el.addEventListener("click", () => openDetail(state.items.find(i => String(i.id) === el.dataset.id))));
}

function renderGenehmigungen() {
  const offen = offeneGenehmigungen();
  $("badgeGenehmigungen").hidden = offen.length === 0;
  $("badgeGenehmigungen").textContent = offen.length;
  $("genehmigungenListe").innerHTML = offen.length
    ? offen.map(i => itemCard(i, '<button class="btn-primary btn-small">Prüfen &amp; entscheiden</button>')).join("")
    : '<p class="hint">Keine offenen Genehmigungen.</p>';
  $("genehmigungenListe").querySelectorAll(".item-card").forEach(el =>
    el.addEventListener("click", () => openDetail(state.items.find(i => String(i.id) === el.dataset.id))));
}

function renderAuswertung() {
  const jahr = new Date().getFullYear();
  const aktiv = state.items.filter(i => i.fields.Status !== "Archiviert");

  // Summen je Partner (Gesamt + laufendes Jahr)
  const partner = {};
  for (const i of aktiv) {
    const f = i.fields;
    if (f.Status === "Abgelehnt") continue;
    const p = (f.Geschaeftspartner || "unbekannt").trim();
    partner[p] = partner[p] || { gesamt: 0, jahr: 0, anzahl: 0 };
    partner[p].gesamt += parseFloat(f.Betrag) || 0;
    partner[p].anzahl++;
    if (f.DatumZuwendung && new Date(f.DatumZuwendung).getFullYear() === jahr) partner[p].jahr += parseFloat(f.Betrag) || 0;
  }
  const top = Object.entries(partner).sort((a, b) => b[1].jahr - a[1].jahr).slice(0, 10);

  const statusCounts = {};
  for (const i of aktiv) statusCounts[i.fields.Status] = (statusCounts[i.fields.Status] || 0) + 1;

  const redFlags = aktiv.filter(i => i.fields.RedFlag);

  $("auswertungContent").innerHTML = `
    <div class="stat-row">
      ${Object.entries(statusCounts).map(([s, n]) =>
        `<div class="stat-tile"><div class="stat-num">${n}</div><div class="stat-label">${escapeHtml(s)}</div></div>`).join("")}
    </div>
    <h3>Top-Partner nach Jahressumme ${jahr}</h3>
    <table class="report-table">
      <tr><th>Geschäftspartner</th><th>Summe ${jahr}</th><th>Summe gesamt</th><th>Vorgänge</th></tr>
      ${top.map(([p, v]) => `<tr><td>${escapeHtml(p)}</td><td>${EUR.format(v.jahr)}</td><td>${EUR.format(v.gesamt)}</td><td>${v.anzahl}</td></tr>`).join("")}
    </table>
    <h3>Red-Flag-Vorgänge (${redFlags.length})</h3>
    <div class="item-list">${redFlags.map(i => itemCard(i)).join("") || '<p class="hint">Keine.</p>'}</div>`;
  $("auswertungContent").querySelectorAll(".item-card").forEach(el =>
    el.addEventListener("click", () => openDetail(state.items.find(i => String(i.id) === el.dataset.id))));
}

// ---------------------------------------------------------------------------
// Einstellungen (nur Administratoren): Rollen, Genehmiger, Schwellenwerte
// ---------------------------------------------------------------------------

function renderEinstellungen() {
  const g = state.cfgGlobal;
  const num = v => (v == null ? "" : v);

  const typBlock = (name, key) => {
    const c = state.cfgTypes[name] || {};
    return `
      <fieldset class="settings-fs">
        <legend>${escapeHtml(name)}</legend>
        <label class="checkline"><input type="checkbox" id="set_${key}_zwei" ${c.ZweistufigAktiv ? "checked" : ""}> Zweistufige Genehmigung (Stufe 2 = Compliance Officer)</label>
        <div class="settings-grid">
          <label>Doku-Schwelle (€)<input type="number" step="0.01" id="set_${key}_doku" value="${num(c.DokuSchwelle)}"></label>
          <label>Genehmigungs-Schwelle (€)<input type="number" step="0.01" id="set_${key}_gen" value="${num(c.GenehmigungsSchwelle)}"></label>
          <label>Kumulierungs-Schwelle/Jahr (€)<input type="number" step="0.01" id="set_${key}_kum" value="${num(c.KumulierungsSchwelleJahr)}"></label>
          <label>Erinnerung nach (Tagen)<input type="number" id="set_${key}_erin" value="${num(c.ErinnerungNachTagen)}"></label>
          <label>Eskalation nach (Tagen)<input type="number" id="set_${key}_eska" value="${num(c.EskalationNachTagen)}"></label>
          <label>Aufbewahrung (Jahre)<input type="number" id="set_${key}_aufb" value="${num(c.AufbewahrungJahre)}"></label>
        </div>
      </fieldset>`;
  };

  const gen1txt = g.Genehmiger1Modus === "Fest"
    ? (g.Genehmiger1Email || "– (fester Genehmiger nicht gesetzt)")
    : "Führungskraft des Antragstellers (automatisch, Fallback: Compliance Officer)";

  $("einstellungenContent").innerHTML = `
    <p class="hint">Änderungen wirken sofort für alle Nutzer. Diese Seite sehen nur Administratoren.</p>

    <h3>Berechtigungen – wer darf was</h3>
    <table class="rollen-table">
      <tr><th>Rolle</th><th>Wer</th><th>Rechte</th></tr>
      <tr><td>Antragsteller</td><td>alle angemeldeten Mitarbeiter</td><td>Zuwendung melden, eigene Vorgänge sehen</td></tr>
      <tr><td>Genehmiger Stufe 1</td><td>${escapeHtml(gen1txt)}</td><td>erste Genehmigung genehmigungspflichtiger Vorgänge</td></tr>
      <tr><td>Compliance Officer</td><td>${escapeHtml(g.ComplianceOfficerEmail || "–")}</td><td>finale Genehmigung (Stufe 2), sieht alle Vorgänge + Auswertung</td></tr>
      <tr><td>Vertreter</td><td>${escapeHtml(g.VertreterEmail || "–")}</td><td>übernimmt für den Compliance Officer</td></tr>
      <tr><td>Administrator</td><td>${g.AdminEmails.map(escapeHtml).join("; ") || "–"}</td><td>pflegt diese Einstellungen</td></tr>
    </table>

    <h3>Rollen zuweisen</h3>
    <div class="settings-grid">
      <label>Compliance Officer (E-Mail) *<input type="email" id="set_co" value="${escapeHtml(g.ComplianceOfficerEmail)}"></label>
      <label>Vertreter (E-Mail)<input type="email" id="set_vertreter" value="${escapeHtml(g.VertreterEmail)}"></label>
      <label class="span2">Administratoren (E-Mails, mit Semikolon getrennt)<input type="text" id="set_admins" value="${escapeHtml(g.AdminEmails.join("; "))}"></label>
    </div>

    <h3>Genehmiger-Workflow</h3>
    <div class="settings-grid">
      <label>Genehmigung Stufe 1
        <select id="set_gen1modus">
          <option value="Fuehrungskraft" ${g.Genehmiger1Modus !== "Fest" ? "selected" : ""}>Führungskraft des Antragstellers (automatisch)</option>
          <option value="Fest" ${g.Genehmiger1Modus === "Fest" ? "selected" : ""}>Fester Genehmiger</option>
        </select>
      </label>
      <label id="set_gen1email_wrap" ${g.Genehmiger1Modus === "Fest" ? "" : "hidden"}>Fester Genehmiger (E-Mail)<input type="email" id="set_gen1email" value="${escapeHtml(g.Genehmiger1Email)}"></label>
    </div>
    <p class="hint">Bei Amtsträgern sind die Schwellen üblicherweise 0 € – dann ist jede Zuwendung genehmigungspflichtig.</p>

    <h3>Schwellenwerte &amp; Fristen</h3>
    ${typBlock("Nicht-Amtsträger", "nat")}
    ${typBlock("Amtsträger", "at")}

    <button class="btn-primary" id="btnSaveSettings">Einstellungen speichern</button>`;

  $("set_gen1modus").addEventListener("change", e => {
    $("set_gen1email_wrap").hidden = e.target.value !== "Fest";
  });
  $("btnSaveSettings").addEventListener("click", saveEinstellungen);
}

async function saveEinstellungen() {
  const btn = $("btnSaveSettings");
  btn.disabled = true;
  btn.textContent = "Wird gespeichert …";
  try {
    const co = normMail($("set_co").value);
    if (!co) throw new Error("Compliance Officer (E-Mail) ist erforderlich.");
    const gen1modus = $("set_gen1modus").value;
    const gen1email = normMail($("set_gen1email").value);
    if (gen1modus === "Fest" && !gen1email) throw new Error("Bitte die E-Mail des festen Genehmigers angeben.");
    const admins = $("set_admins").value.split(/[;,]/).map(s => s.trim()).filter(Boolean).join("; ");

    // Neue Konfig-Spalten bei Bedarf anlegen (idempotent). Schlägt fehl, wenn dem
    // angemeldeten Nutzer das Recht „Listen verwalten" fehlt – dann muss setup-zapp.ps1
    // einmalig als Administrator laufen.
    const fehlend = await ensureTextColumns(ZAPP_CONFIG.configListName, ["AdminEmails", "Genehmiger1Modus", "Genehmiger1Email"]);
    if (fehlend.length) {
      throw new Error(`Spalten ${fehlend.join(", ")} fehlen in ZAPP_Konfiguration und konnten nicht angelegt werden `
        + `(vermutlich fehlt das Recht „Listen verwalten"). Bitte setup-zapp.ps1 einmalig als Administrator ausführen, dann erneut speichern.`);
    }

    const globalFields = {
      Title: "Allgemein",
      ComplianceOfficerEmail: co,
      VertreterEmail: normMail($("set_vertreter").value),
      AdminEmails: admins,
      Genehmiger1Modus: gen1modus,
      Genehmiger1Email: gen1email
    };
    if (state.cfgRowIds["Allgemein"]) {
      await updateItemFields(ZAPP_CONFIG.configListName, state.cfgRowIds["Allgemein"], globalFields);
    } else {
      await createItem(ZAPP_CONFIG.configListName, globalFields);
    }

    for (const [name, key] of [["Nicht-Amtsträger", "nat"], ["Amtsträger", "at"]]) {
      const id = state.cfgRowIds[name];
      if (!id) continue;
      await updateItemFields(ZAPP_CONFIG.configListName, id, {
        ZweistufigAktiv: $(`set_${key}_zwei`).checked,
        DokuSchwelle: parseFloat($(`set_${key}_doku`).value) || 0,
        GenehmigungsSchwelle: parseFloat($(`set_${key}_gen`).value) || 0,
        KumulierungsSchwelleJahr: parseFloat($(`set_${key}_kum`).value) || 0,
        ErinnerungNachTagen: parseInt($(`set_${key}_erin`).value, 10) || 0,
        EskalationNachTagen: parseInt($(`set_${key}_eska`).value, 10) || 0,
        AufbewahrungJahre: parseInt($(`set_${key}_aufb`).value, 10) || 0
      });
    }

    await loadConfig();
    ermittleRollen();
    renderEinstellungen();
    showToast("Einstellungen gespeichert.");
  } catch (e) {
    console.error(e);
    showToast("Fehler beim Speichern: " + e.message, 8000);
  } finally {
    btn.disabled = false;
    btn.textContent = "Einstellungen speichern";
  }
}

// ---------------------------------------------------------------------------
// Detail-Modal
// ---------------------------------------------------------------------------

let _modalItem = null;

function openDetail(item) {
  if (!item) return;
  _modalItem = item;
  const f = item.fields;
  $("modalTitle").textContent = `${f.Title || "Vorgang"} – ${f.Status || ""}`;
  const zeile = (k, v) => v ? `<tr><td class="dt">${k}</td><td>${escapeHtml(String(v))}</td></tr>` : "";
  $("modalBody").innerHTML = `
    <table class="detail-table">
      ${zeile("Antragsteller", f.AntragstellerEmail)}
      ${zeile("Richtung", f.Richtung)}
      ${zeile("Art", f.ArtZuwendung)}
      ${zeile("Beschreibung", f.Beschreibung)}
      ${zeile("Betrag", EUR.format(f.Betrag || 0))}
      ${zeile("Jahressumme Partner (bei Einreichung)", f.KumulierteSummeJahr != null ? EUR.format(f.KumulierteSummeJahr) : "")}
      ${zeile("Datum", f.DatumZuwendung ? new Date(f.DatumZuwendung).toLocaleDateString("de-DE") : "")}
      ${zeile("Anlass", f.Anlass)}
      ${zeile("Geschäftspartner", f.Geschaeftspartner)}
      ${zeile("Person beim Partner", f.PartnerPerson)}
      ${zeile("Empfängertyp", f.EmpfaengerTyp)}
      ${f.RedFlag ? zeile("⚠ Red Flag", "Laufende Ausschreibung/Verhandlung") : ""}
      ${zeile("Entscheidung Stufe 1", f.Kommentar1)}
      ${zeile("Entscheidung Stufe 2", f.Kommentar2)}
      ${zeile("Anmerkungen", f.Anmerkungen)}
    </table>
    <p class="hint">Anlagen: Ordner „${escapeHtml(f.Title || "")}" in der Bibliothek ${escapeHtml(ZAPP_CONFIG.attachmentsLibrary)}.</p>`;
  $("modalKommentar").value = "";
  $("modalActions").hidden = !darfEntscheiden(item);
  $("detailModal").hidden = false;
}

function closeModal() {
  $("detailModal").hidden = true;
  _modalItem = null;
}

// ---------------------------------------------------------------------------
// UI-Verdrahtung
// ---------------------------------------------------------------------------

function switchView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  $("view-" + name).classList.add("active");
  document.querySelector(`.nav-btn[data-view="${name}"]`).classList.add("active");
}

function bindUi() {
  document.querySelectorAll(".nav-btn").forEach(b =>
    b.addEventListener("click", () => switchView(b.dataset.view)));
  $("btnLogout").addEventListener("click", logout);
  $("formZuwendung").addEventListener("submit", submitZuwendung);
  ["fBetrag", "fPartner", "fAmtstraeger", "fAusschreibung", "fDatum"].forEach(id =>
    $(id).addEventListener("input", liveBewertung));
  $("btnModalClose").addEventListener("click", closeModal);
  $("detailModal").addEventListener("click", e => { if (e.target === $("detailModal")) closeModal(); });
  $("btnGenehmigen").addEventListener("click", () => _modalItem && entscheiden(_modalItem, true));
  $("btnAblehnen").addEventListener("click", () => _modalItem && entscheiden(_modalItem, false));
}

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let _toastTimer = null;
function showToast(msg, ms = 4000) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

init();
