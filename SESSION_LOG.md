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
