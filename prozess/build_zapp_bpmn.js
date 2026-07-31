'use strict';
/* Erzeugt valide BPMN-2.0-Dateien fuer den ZAPP-Prozess (Import ins RMS "Prozesse").
   Layout mit expliziten Koordinaten/Waypoints -> rendert sauber in bpmn-js. */
const fs = require('fs');
const path = require('path');

function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* shapes: {id,type,name,x,y,w,h,inner?}  flows: {id,src,tgt,name?,waypoints:[[x,y]...]} */
function buildBpmn(shapes, flows, docText) {
  const inc = {}, out = {};
  flows.forEach(f => { (out[f.src] = out[f.src] || []).push(f.id); (inc[f.tgt] = inc[f.tgt] || []).push(f.id); });

  const children = [];
  if (docText) children.push(`    <bpmn:documentation>${xmlEsc(docText)}</bpmn:documentation>`);
  shapes.forEach(sh => {
    const i = (inc[sh.id] || []).map(f => `<bpmn:incoming>${f}</bpmn:incoming>`).join('');
    const o = (out[sh.id] || []).map(f => `<bpmn:outgoing>${f}</bpmn:outgoing>`).join('');
    children.push(`    <bpmn:${sh.type} id="${sh.id}" name="${xmlEsc(sh.name)}">${i}${o}${sh.inner || ''}</bpmn:${sh.type}>`);
  });
  flows.forEach(f => children.push(
    `    <bpmn:sequenceFlow id="${f.id}"${f.name ? ` name="${xmlEsc(f.name)}"` : ''} sourceRef="${f.src}" targetRef="${f.tgt}" />`));

  const di = [];
  shapes.forEach(sh => {
    const marker = sh.type === 'exclusiveGateway' ? ' isMarkerVisible="true"' : '';
    const label = sh.type !== 'task'
      ? `<bpmndi:BPMNLabel><dc:Bounds x="${sh.x - 20}" y="${sh.y + sh.h + 4}" width="${sh.w + 80}" height="27" /></bpmndi:BPMNLabel>` : '';
    di.push(`      <bpmndi:BPMNShape id="${sh.id}_di" bpmnElement="${sh.id}"${marker}><dc:Bounds x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${sh.h}" />${label}</bpmndi:BPMNShape>`);
  });
  flows.forEach(f => {
    const wps = f.waypoints.map(w => `<di:waypoint x="${Math.round(w[0])}" y="${Math.round(w[1])}" />`).join('');
    di.push(`      <bpmndi:BPMNEdge id="${f.id}_di" bpmnElement="${f.id}">${wps}</bpmndi:BPMNEdge>`);
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_ZAPP" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_ZAPP" isExecutable="false">
${children.join('\n')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Dia_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_ZAPP">
${di.join('\n')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

/* ===================== 1) Hauptprozess ZAPP ===================== */
const S = [
  { id: 'Start',   type: 'startEvent', name: 'Zuwendung angefallen',           x: 120,  y: 142, w: 36,  h: 36 },
  { id: 'T1',      type: 'task', name: 'Antragsteller: Zuwendung erfassen und Belege anhängen', x: 200, y: 120, w: 160, h: 80 },
  { id: 'T2',      type: 'task', name: 'ZAPP: Bewertung – Betrag, Amtsträger, Kumulierung, Red Flag', x: 420, y: 120, w: 170, h: 80 },
  { id: 'GwGen',   type: 'exclusiveGateway', name: 'genehmigungs-pflichtig?',  x: 650,  y: 135, w: 50,  h: 50 },
  { id: 'T3',      type: 'task', name: 'ZAPP: an Genehmiger Stufe 1 (Führungskraft / fester Genehmiger) senden', x: 760, y: 120, w: 170, h: 80 },
  { id: 'GwS1',    type: 'exclusiveGateway', name: 'Stufe 1 genehmigt?',       x: 990,  y: 135, w: 50,  h: 50 },
  { id: 'GwZwei',  type: 'exclusiveGateway', name: 'zweistufig?',              x: 1100, y: 135, w: 50,  h: 50 },
  { id: 'T4',      type: 'task', name: 'ZAPP: an Compliance Officer (Stufe 2) senden', x: 1210, y: 120, w: 170, h: 80 },
  { id: 'GwS2',    type: 'exclusiveGateway', name: 'Stufe 2 genehmigt?',       x: 1440, y: 135, w: 50,  h: 50 },
  { id: 'TGen',    type: 'task', name: 'ZAPP: Antragsteller – genehmigt informieren', x: 1550, y: 120, w: 170, h: 80 },
  { id: 'EndGen',  type: 'endEvent', name: 'Zuwendung genehmigt',             x: 1770, y: 142, w: 36,  h: 36 },
  // Ablehnung
  { id: 'TRej',    type: 'task', name: 'ZAPP: Antragsteller – abgelehnt informieren', x: 1210, y: 320, w: 170, h: 80 },
  { id: 'EndAbg',  type: 'endEvent', name: 'Zuwendung abgelehnt',             x: 1440, y: 342, w: 36,  h: 36 },
  // Bewertung: keine / Dokumentation
  { id: 'GwDok',   type: 'exclusiveGateway', name: 'dokumentations-pflichtig?', x: 650, y: 320, w: 50,  h: 50 },
  { id: 'TDoku',   type: 'task', name: 'ZAPP: dokumentieren und Antragsteller informieren', x: 760, y: 300, w: 170, h: 80 },
  { id: 'EndDok',  type: 'endEvent', name: 'dokumentiert',                    x: 980,  y: 322, w: 36,  h: 36 },
  { id: 'TKeine',  type: 'task', name: 'ZAPP: speichern und Antragsteller informieren', x: 760, y: 440, w: 170, h: 80 },
  { id: 'EndKeine', type: 'endEvent', name: 'kein Handlungsbedarf',           x: 980,  y: 462, w: 36,  h: 36 },
];
const F = [
  { id: 'f1',  src: 'Start', tgt: 'T1',   waypoints: [[156, 160], [200, 160]] },
  { id: 'f2',  src: 'T1',    tgt: 'T2',    waypoints: [[360, 160], [420, 160]] },
  { id: 'f3',  src: 'T2',    tgt: 'GwGen', waypoints: [[590, 160], [650, 160]] },
  { id: 'f4',  src: 'GwGen', tgt: 'T3',    name: 'ja', waypoints: [[700, 160], [760, 160]] },
  { id: 'f5',  src: 'T3',    tgt: 'GwS1',  waypoints: [[930, 160], [990, 160]] },
  { id: 'f6',  src: 'GwS1',  tgt: 'GwZwei', name: 'ja', waypoints: [[1040, 160], [1100, 160]] },
  { id: 'f7',  src: 'GwZwei', tgt: 'T4',   name: 'ja', waypoints: [[1150, 160], [1210, 160]] },
  { id: 'f8',  src: 'T4',    tgt: 'GwS2',  waypoints: [[1380, 160], [1440, 160]] },
  { id: 'f9',  src: 'GwS2',  tgt: 'TGen',  name: 'ja', waypoints: [[1490, 160], [1550, 160]] },
  { id: 'f10', src: 'TGen',  tgt: 'EndGen', waypoints: [[1720, 160], [1770, 160]] },
  { id: 'f11', src: 'GwZwei', tgt: 'TGen', name: 'nein', waypoints: [[1125, 135], [1125, 90], [1635, 90], [1635, 120]] },
  { id: 'f12', src: 'GwS1',  tgt: 'TRej',  name: 'nein', waypoints: [[1015, 185], [1015, 360], [1210, 360]] },
  { id: 'f13', src: 'GwS2',  tgt: 'TRej',  name: 'nein', waypoints: [[1465, 185], [1465, 360], [1380, 360]] },
  { id: 'f14', src: 'TRej',  tgt: 'EndAbg', waypoints: [[1380, 360], [1440, 360]] },
  { id: 'f15', src: 'GwGen', tgt: 'GwDok', name: 'nein', waypoints: [[675, 185], [675, 320]] },
  { id: 'f16', src: 'GwDok', tgt: 'TDoku', name: 'ja', waypoints: [[700, 345], [760, 345]] },
  { id: 'f17', src: 'TDoku', tgt: 'EndDok', waypoints: [[930, 340], [980, 340]] },
  { id: 'f18', src: 'GwDok', tgt: 'TKeine', name: 'nein', waypoints: [[675, 370], [675, 480], [760, 480]] },
  { id: 'f19', src: 'TKeine', tgt: 'EndKeine', waypoints: [[930, 480], [980, 480]] },
];
const DOC_MAIN = 'ZAPP – Zuwendungs-App. Erfassung, Bewertung und Genehmigung angenommener und '
  + 'gewährter Zuwendungen/Geschenke (Anti-Korruption, FCPA, UK Bribery Act). Die Bewertung ergibt '
  + 'sich aus Betrag, Empfängertyp (Amtsträger), Jahressumme je Geschäftspartner (Kumulierung) und '
  + 'Red Flag (laufende Ausschreibung). Genehmigung zweistufig: Stufe 1 Führungskraft bzw. fester '
  + 'Genehmiger, Stufe 2 Compliance Officer. Umsetzung als SPA (zapp.dihag.de) mit MS Graph/SharePoint. '
  + 'Im Einklang mit der Anti-Korruptions-/Zuwendungsrichtlinie.';

/* ===================== 2) Cron-Überwachung ===================== */
const SC = [
  { id: 'CStart', type: 'startEvent', name: 'täglich 05:00 Uhr', x: 120, y: 122, w: 36, h: 36,
    inner: '<bpmn:timerEventDefinition />' },
  { id: 'CT1', type: 'task', name: 'ZAPP-Cron: alle Vorgänge laden', x: 200, y: 100, w: 160, h: 80 },
  { id: 'CT2', type: 'task', name: 'Erinnerungen und Eskalationen für überfällige Genehmigungen senden', x: 420, y: 100, w: 180, h: 80 },
  { id: 'CT3', type: 'task', name: 'Kumulierung je Partner prüfen und ggf. nachträglich zur Genehmigung vorlegen', x: 660, y: 100, w: 190, h: 80 },
  { id: 'CT4', type: 'task', name: 'Fällige Vorgänge anonymisieren, Anlagen löschen, archivieren (DSGVO)', x: 910, y: 100, w: 190, h: 80 },
  { id: 'CEnd', type: 'endEvent', name: 'Überwachung abgeschlossen', x: 1160, y: 122, w: 36, h: 36 },
];
const FC = [
  { id: 'c1', src: 'CStart', tgt: 'CT1', waypoints: [[156, 140], [200, 140]] },
  { id: 'c2', src: 'CT1', tgt: 'CT2', waypoints: [[360, 140], [420, 140]] },
  { id: 'c3', src: 'CT2', tgt: 'CT3', waypoints: [[600, 140], [660, 140]] },
  { id: 'c4', src: 'CT3', tgt: 'CT4', waypoints: [[850, 140], [910, 140]] },
  { id: 'c5', src: 'CT4', tgt: 'CEnd', waypoints: [[1100, 140], [1160, 140]] },
];
const DOC_CRON = 'ZAPP – Tägliche Überwachung (App-only-Cron via GitHub Actions). Läuft täglich und '
  + 'ergänzt die App um zeitgesteuerte Aufgaben: Erinnerung/Eskalation offener Genehmigungen, '
  + 'tenant-weite Kumulierungsprüfung (Summe je Partner über alle Antragsteller) und DSGVO-Archivierung '
  + 'nach Ablauf der Aufbewahrungsfrist. Versand als administrator@dihag.com.';

const outDir = __dirname;
fs.writeFileSync(path.join(outDir, 'ZAPP-Zuwendungsprozess.bpmn'), buildBpmn(S, F, DOC_MAIN), 'utf8');
fs.writeFileSync(path.join(outDir, 'ZAPP-Cron-Ueberwachung.bpmn'), buildBpmn(SC, FC, DOC_CRON), 'utf8');
console.log('BPMN geschrieben: ZAPP-Zuwendungsprozess.bpmn (' + S.length + ' Knoten, ' + F.length + ' Flüsse), ZAPP-Cron-Ueberwachung.bpmn (' + SC.length + ' Knoten, ' + FC.length + ' Flüsse)');
