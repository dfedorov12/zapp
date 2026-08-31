# ZAPP – Zuwendungsprozess (BPMN 2.0)

Vollständige BPMN-Beschreibung des ZAPP-Tools zur Hinterlegung im
Richtlinienmanagement (rms.dihag.de) unter **Prozesse**.

Zwei Diagramme:
- **ZAPP-Zuwendungsprozess.bpmn** – der fachliche Ablauf (Erfassung → Bewertung → Genehmigung).
- **ZAPP-Cron-Ueberwachung.bpmn** – die tägliche, zeitgesteuerte Überwachung.

Beide sind valides BPMN 2.0 und im bpmn-js-Modeler des RMS geprüft (fehlerfrei geladen).

## Import ins RMS

1. RMS öffnen → Reiter **Prozesse**.
2. **⬆ Importieren** → `ZAPP-Zuwendungsprozess.bpmn` wählen.
3. Prozessnamen bestätigen (z. B. „ZAPP – Zuwendungsprozess"), optional die
   **Anti-Korruptions-/Zuwendungsrichtlinie** als verknüpfte Richtlinie ankreuzen.
4. **💾 Speichern** (legt die `.bpmn` im Ordner „Prozesse" der ISMS-Bibliothek ab).
5. Schritte 2–4 für `ZAPP-Cron-Ueberwachung.bpmn` wiederholen.

---

## 1. Hauptprozess

**Auslöser (Start):** Zuwendung angefallen (Geschenk/Einladung/Bewirtung angenommen oder gewährt).

**Aktivitäten & Verzweigungen:**

1. **Antragsteller:** Zuwendung erfassen und Belege anhängen (Formular in der SPA).
2. **ZAPP:** Bewertung – Betrag, Empfängertyp (Amtsträger), Jahressumme je Partner
   (Kumulierung), Red Flag (laufende Ausschreibung).
3. **Gateway „genehmigungspflichtig?"**
   - **ja** → Genehmigungszweig (Schritt 4).
   - **nein** → Gateway **„dokumentationspflichtig?"**
     - **ja** → ZAPP: dokumentieren und Antragsteller informieren → Ende **„dokumentiert"**.
     - **nein** → ZAPP: speichern und Antragsteller informieren → Ende **„kein Handlungsbedarf"**.
4. **ZAPP:** an Genehmiger **Stufe 1** senden (Führungskraft des Antragstellers bzw.
   fester Genehmiger; Fallback Compliance Officer).
5. **Gateway „Stufe 1 genehmigt?"**
   - **nein** → ZAPP: Antragsteller – abgelehnt informieren → Ende **„Zuwendung abgelehnt"**.
   - **ja** → Gateway **„zweistufig?"**
     - **nein** → direkt zur Genehmigungsmeldung (Schritt 7).
     - **ja** → Schritt 6.
6. **ZAPP:** an **Compliance Officer** (Stufe 2) senden → **Gateway „Stufe 2 genehmigt?"**
   - **nein** → ZAPP: Antragsteller – abgelehnt informieren → Ende **„Zuwendung abgelehnt"**.
   - **ja** → Schritt 7.
7. **ZAPP:** Antragsteller – genehmigt informieren → Ende **„Zuwendung genehmigt"**.

**Rollen:** Antragsteller (alle Mitarbeiter), ZAPP-System (automatisiert), Genehmiger
Stufe 1 (Führungskraft/fester Genehmiger), Compliance Officer (Stufe 2). Die Rollen sind
zur besseren Lesbarkeit als Präfix in den Aufgaben benannt.

**Schwellen/Regeln** (aus `ZAPP_Konfiguration`, je Empfängertyp): Dokumentations-,
Genehmigungs- und Kumulierungsschwelle, Zweistufigkeit. Amtsträger üblicherweise mit
Schwelle 0 € (immer genehmigungspflichtig). Red Flag erzwingt Genehmigungspflicht.

## 2. Cron-Überwachung (täglich)

**Auslöser:** Zeit-Ereignis „täglich 05:00 Uhr" (App-only-Job via GitHub Actions).

1. ZAPP-Cron: alle Vorgänge laden.
2. Erinnerungen und Eskalationen für überfällige Genehmigungen senden.
3. Kumulierung je Partner prüfen (Summe über **alle** Antragsteller) und ggf. bislang nur
   dokumentierte Vorgänge nachträglich zur Genehmigung vorlegen.
4. Fällige Vorgänge anonymisieren, Anlagen löschen, archivieren (DSGVO-Aufbewahrungsfrist).

Ende: Überwachung abgeschlossen. Versand aller Mails als administrator@dihag.com.

---

## Pflege / Neu-Erzeugung

Die `.bpmn`-Dateien werden von [build_zapp_bpmn.js](build_zapp_bpmn.js) erzeugt
(`node build_zapp_bpmn.js`). Layout-Koordinaten und Schritte stehen dort explizit; nach
Änderungen neu generieren und erneut ins RMS importieren (bzw. im RMS-Modeler direkt anpassen).
