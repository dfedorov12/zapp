# Session-Log ZAPP

## 2026-07-20 – Initialer Aufbau der SPA

- Entscheidung: Eigenbau als SPA (dfedorov12.github.io/zapp) statt MS Forms + Power
  Automate; Begründung: Live-Kumulierungsprüfung, Partner-Autocomplete, Wiederverwendung
  des Bedarfsanfrage-Musters, kein Flow-Ownership-Problem.
- ANLEITUNG.md (Power-Automate-Variante als Referenz) + provision-zapp-lists.ps1 erstellt;
  Listennamen auf `ZAPP` / `ZAPP_Konfiguration` korrigiert.
- SPA erstellt: index.html, css/styles.css, js/config.js, js/graph.js, js/app.js
  - MSAL (Client-ID c7710322-…, Tenant fdb70646-…), Graph-REST-Helfer, Anlagen-Upload
    in Bibliothek ZAPP_Anlagen (Graph kann keine Listenelement-Anhänge)
  - Views: Neue Zuwendung (Live-Bewertung inkl. Kumulierung + Red Flag), Meine Vorgänge,
    Genehmigungen (Stufe 1 Führungskraft via Graph manager, Fallback/Stufe 2 CO),
    Auswertung (nur CO/Vertreter)
  - Entscheidungen werden mit Stempel in Kommentar1/2 dokumentiert; Mails via Graph
    sendMail mit Deep-Link ?vorgang=<id>
- Offen: siteHostname/sitePath in js/config.js prüfen; Spalten ComplianceOfficerEmail /
  VertreterEmail in ZAPP_Konfiguration ergänzen; Bibliothek ZAPP_Anlagen anlegen;
  SPA-Plattform in der App-Registrierung ergänzen; Cron (Erinnerung/DSGVO) noch nicht gebaut.

## 2026-07-20 – Fix Site-Pfad

- Listen liegen auf /sites/IT (nicht /sites/zapp): js/config.js korrigiert.

## 2026-07-20 – Corporate Design

- DIHAG-Foundry-Group-CD umgesetzt (Azurblau 17509E, Navy 1A2644, Anthrazit 424241, Lichtblau 99B7CD, Orange F08300, Schrift Exo via Google Fonts).
- setup-zapp.ps1 (Spalten/Konfig-Zeilen/Anlagen-Bibliothek per Graph) ins Repo uebernommen.

## 2026-07-20 – Einstellungen-Ansicht (Rollen & Genehmiger)

- Neue Admin-Ansicht "Einstellungen" (nur fuer Administratoren): Rollenmatrix (wer darf was), Rollen zuweisen (CO, Vertreter, Admins), Genehmiger-Workflow (Stufe 1 Fuehrungskraft ODER fester Genehmiger), Schwellenwerte/Fristen je Empfaengertyp.
- Konfig-Modell erweitert: globale Zeile "Allgemein" (CO/Vertreter/AdminEmails/Genehmiger1Modus/Genehmiger1Email) + Schwellen-Zeilen je Typ. Fallback auf alte CO-Felder der Typ-Zeile.
- App legt fehlende Konfig-Spalten beim Speichern selbst an (ensureTextColumns via Graph). setup-zapp.ps1 ergaenzt (neue Spalten + Allgemein-Zeile).
- Verifiziert per Vorschau-Render (Struktur + CD-Farben korrekt).

## 2026-07-20 – Rollen: fedorov = einfacher Nutzer

- CO/Vertreter/Admin = administrator@dihag.com (nicht mehr fedorov). setup-zapp.ps1: Variable $AdminEmail, Allgemein-Zeile als Upsert (korrigiert bereits geseedete fedorov-Werte).

## 2026-07-20 – Anlagen anzeigen + per Mail mitschicken

- Detail-/Genehmigungsdialog: Anlagen als anklickbare Links (webUrl, oeffnen in SharePoint/Office online) via listAnlagen; formatBytes-Anzeige.
- Genehmigungs-Mails haengen die Anlagen an: Stufe 1 direkt aus den ausgewaehlten Dateien, Stufe 2 (an CO) aus der Bibliothek (getDriveItemBase64). Graph sendMail um fileAttachment erweitert, Gesamtgroesse via mailMaxTotalBytes (3 MB) begrenzt.

## 2026-07-20 – Filter/CSV (#6) + Aenderungssperre-Vorbereitung (#3)

- Filter/Suche in "Meine Vorgaenge" und "Auswertung" (Text/Status/Jahr), fokus-erhaltend; CSV-Export (de, Semikolon, UTF-8-BOM) der gefilterten Auswertung.
- Vorgangsnummer wird jetzt beim Anlegen gesetzt (ZW-JJJJ-MMTT-HHMMSS-RRR), kein Nach-Update mehr -> Antragsteller brauchen nur "Hinzufuegen", nicht "Bearbeiten" (Grundlage fuer Aenderungssperre).

## 2026-07-20 – Cron (#1/#4) + Haertung (#3/#2)

- cron/zapp_cron.py (App-only, DIHAG Cron-Job 089bf9ad, Python stdlib) + .github/workflows/zapp-cron.yml (taeglich 05:00 UTC): Erinnerung/Eskalation, tenant-weite Kumulierung (Partner+Jahr ueber alle), DSGVO-Anonymisierung+Anlagenloeschung. Versand als administrator@dihag.com (Mail.Send).
- cron/README.md: Sites.Selected+Site-Grant, Mail.Send+ApplicationAccessPolicy, Client-Secret, gh secret set.
- harden-zapp-permissions.ps1: Versionierung, nur-eigene-Elemente, Rolle "ZAPP Erfassen" (Hinzufuegen ohne Bearbeiten) listen-bezogen.

## 2026-07-20 – Cron scharfgeschaltet

- GitHub-Secrets ZAPP_TENANT_ID/CLIENT_ID/CLIENT_SECRET gesetzt (Secret via addPassword->gh, 2 Jahre).
- DIHAG Cron-Job: App-Rollen Sites.Selected + Mail.Send (Consent), Site-Grant write auf /sites/IT.
- Testlauf erfolgreich: App-only-Token, 3 Vorgaenge gelesen, CO=administrator@dihag.com, keine Aktion faellig.
- Offen/optional: Mail.Send per ApplicationAccessPolicy einschraenken; harden-zapp-permissions.ps1 (#3) mit Erfasser-Gruppe.

## 2026-07-20 – Hilfe-Reiter

- Reiter "Hilfe" fuer alle Nutzer (nicht versteckt): kurze Doku (Zweck, was melden, Ampel-Bewertung gruen/gelb/rot, Ablauf, Meine Vorgaenge/Anlagen, Datenschutz, Kontakt CO). CO-E-Mail wird dynamisch aus cfgGlobal als mailto gesetzt (renderHilfe).

## 2026-07-23 – Compliance Officer = compliance@dihag.com

- CO (Stufe-2-Genehmigung + Benachrichtigungen) = compliance@dihag.com; Admin/Vertreter bleiben administrator@dihag.com. setup-zapp.ps1: $CoEmail eingefuehrt, Allgemein-Upsert + Typ-Zeilen-Seed getrennt.
- Live-Umstellung via neuem App-only Workflow zapp-admin.yml + cron/set_config.py (kein SharePoint-Login): Allgemein CO=compliance@dihag.com, Vertreter/Admin=administrator@dihag.com bestaetigt.

## 2026-07-23 – Custom Domain zapp.dihag.de

- CNAME=zapp.dihag.de; ZAPP_APP_URL (Workflow) + APP_URL-Default (zapp_cron.py) + README auf https://zapp.dihag.de/. Deep-Links/MSAL-Redirect sind dynamisch (origin+pathname), kein Codeeingriff.
- Offen extern: DNS CNAME zapp->dfedorov12.github.io; Entra-Redirect-URI https://zapp.dihag.de/ ergaenzen.
