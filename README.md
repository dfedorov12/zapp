# ZAPP – Zuwendungs-App

Compliance-App zur Erfassung, Bewertung und Genehmigung von Zuwendungen und Geschenken
(Anti-Korruption, FCPA, UK Bribery Act). SPA auf GitHub Pages, Daten in SharePoint via
Microsoft Graph, Anmeldung via MSAL.

**Live:** https://zapp.dihag.de/ (GitHub Pages Custom Domain; `dfedorov12.github.io/zapp` leitet dorthin um)

## Funktionsweise

- **Neue Zuwendung**: Formular mit Live-Bewertung — beim Ausfüllen zeigt die App sofort,
  ob der Vorgang genehmigungsfrei, dokumentationspflichtig oder genehmigungspflichtig ist.
  Berücksichtigt: Betrag, Empfängertyp (Amtsträger), **Kumulierung** (Jahressumme je
  Geschäftspartner) und **Red Flag** (laufende Ausschreibung/Verhandlung).
- **Genehmigung**: zweistufig — Stufe 1 Führungskraft (Graph `manager`, Fallback CO),
  Stufe 2 Compliance Officer. Entscheidung mit Kommentar direkt in der App,
  Benachrichtigungen per Mail (Graph `sendMail`) mit Deep-Link (`?vorgang=<id>`).
- **Auswertung** (nur CO/Vertreter): Statusübersicht, Top-Partner nach Jahressumme,
  Red-Flag-Vorgänge.
- Schwellenwerte, CO/Vertreter und Fristen kommen aus der Liste `ZAPP_Konfiguration`
  und sind ohne Deployment änderbar.

## Setup

1. **Entra-App** „Dihag ZAPP“: Plattform *Single-page application* mit Redirect-URIs
   `https://zapp.dihag.de/`, `https://dfedorov12.github.io/zapp/` und `http://localhost:3000`.
   Delegierte Graph-Berechtigungen: `User.Read`, `User.ReadBasic.All`,
   `Sites.ReadWrite.All` (Admin-Consent), `Mail.Send`, `User.Read.All` (Admin-Consent,
   für Manager-Lookup Stufe 1).
2. **SharePoint-Site** mit:
   - Liste `ZAPP` (Spalten siehe [ANLEITUNG.md](ANLEITUNG.md) bzw.
     [provision-zapp-lists.ps1](provision-zapp-lists.ps1))
   - Liste `ZAPP_Konfiguration` — zusätzlich zu den Skript-Spalten die Textspalten
     **`ComplianceOfficerEmail`** und **`VertreterEmail`** (die App liest die E-Mails
     daraus, da Graph Personenfelder nur als LookupId liefert)
   - Dokumentbibliothek **`ZAPP_Anlagen`** (ein Ordner je Vorgangsnummer, von der App befüllt)
   - Berechtigungen: Liste `ZAPP` → „Lesezugriff: nur eigene Elemente“;
     CO/Vertreter/Genehmiger über SP-Gruppe mit Vollzugriff
3. **`js/config.js`**: `siteHostname` und `sitePath` auf die Site zeigen lassen.
4. Lokal testen: `python -m http.server 3000` im Repo-Ordner, dann http://localhost:3000

## Cron (Erinnerung, Eskalation, Kumulierung, DSGVO)

App-only-Job unter [cron/](cron/), täglich via GitHub Actions. Erledigt Erinnerung/Eskalation
offener Genehmigungen, tenant-weite Kumulierungsprüfung (über alle Antragsteller) und die
DSGVO-Archivierung. Läuft mit der App *DIHAG Cron-Job*, versendet als administrator@dihag.com.
Einrichtung: [cron/README.md](cron/README.md).

## Berechtigungen härten

[harden-zapp-permissions.ps1](harden-zapp-permissions.ps1) (PnP) setzt listen-bezogen:
Versionierung (Audit), „nur eigene Elemente" und die Stufe „ZAPP Erfassen" (Hinzufügen ohne
Bearbeiten) → eingereichte Zuwendungen sind unveränderbar. Berührt die übrige IT-Site nicht.

## Offene Ausbaustufen

- Power-BI-Bericht auf der Liste `ZAPP`
- Zurückziehen/Korrigieren vor der ersten Genehmigung; EN-Sprachversion

`ANLEITUNG.md` dokumentiert die alternative Umsetzung mit MS Forms + Power Automate
(equeo-Original-Ansatz) inkl. Datenmodell.
