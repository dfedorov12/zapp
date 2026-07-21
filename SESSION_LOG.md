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
