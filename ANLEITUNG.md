# ZAPP – Zuwendungs-App (Eigenbau-Anleitung)

Nachbau und Verbesserung der equeo-CompCor-ZAPP mit MS Forms, Power Automate,
SharePoint und Power BI. Verbesserungen gegenüber dem Original:

| # | Original (equeo) | Eigenbau |
|---|---|---|
| 1 | Excel-Tabelle als Ablage | SharePoint-Liste (Versionierung, Berechtigungen, Trigger) |
| 2 | Genehmigung per einfacher E-Mail | Approvals-Connector (Audit-Trail, Teams, Vertretung) |
| 3 | Schwellenwerte in Forms verdrahtet | Konfig-Liste, vom CO selbst änderbar |
| 4 | Keine Kumulierungsprüfung | Jahressumme je Partner+Person wird geprüft |
| 5 | Keine Erinnerung/Eskalation | Täglicher Erinnerungs-/Eskalations-Flow |
| 6 | Keine Löschfrist | DSGVO-Archivierungs-Flow |
| 7 | — | Red-Flag-Frage (laufende Ausschreibung ⇒ immer genehmigungspflichtig) |

## Architektur

```
MS Forms ──► Flow 1: Intake ──► Liste ZAPP
                │ (Schwellen aus ZAPP_Konfiguration,
                │  Kumulierungsprüfung)
                ▼
        Status "In Genehmigung"
                │
                ▼
   Flow 2: Genehmigung (Trigger: Statuswechsel)
        Stufe 1: Führungskraft (Get manager)
        Stufe 2: Compliance Officer
                │
                ▼
        Genehmigt / Abgelehnt + Mail

   Flow 3: Erinnerung & Eskalation   (täglich 07:00)
   Flow 4: Archivierung/Anonymisierung (monatlich)
```

## Voraussetzungen

- Dedizierte SharePoint-Site (z. B. `/sites/zapp`), Zugriff nur Compliance Office;
  Antragsteller brauchen **keinen** Site-Zugriff (sie nutzen nur Forms).
- Service-Konto (z. B. `svc-zapp@…`) als Besitzer von Form + Flows.
  Nie auf ein persönliches Konto legen.
- PnP.PowerShell für das Provisionierungs-Skript (`Install-Module PnP.PowerShell`),
  inkl. registrierter Entra-App (ClientId) für `Connect-PnPOnline`.

---

## 1. Datenmodell

Wird von [provision-zapp-lists.ps1](provision-zapp-lists.ps1) automatisch angelegt.

### Liste `ZAPP`

| Interner Name | Typ | Bemerkung |
|---|---|---|
| Title | Text | Vorgangsnr., vom Flow gesetzt: `ZW-2026-0001` |
| Richtung | Choice | Geben / Empfangen |
| AntragstellerEmail | Text | E-Mail des Einreichers (Textspalte, damit OData-Filter einfach bleibt) |
| Antragsteller | Person | Einreicher |
| Geschaeftspartner | Text | Unternehmen des Partners |
| PartnerPerson | Text | Person beim Partner |
| EmpfaengerTyp | Choice | Nicht-Amtsträger / Amtsträger |
| ArtZuwendung | Choice | Geschenk / Bewirtung / Einladung Veranstaltung / Reisekosten / Sonstiges |
| Beschreibung | Note | |
| Betrag | Currency | Wert in EUR |
| DatumZuwendung | DateTime | Datum der Zuwendung |
| Anlass | Text | |
| RedFlag | Boolean | Laufende Ausschreibung/Verhandlung mit Partner |
| KumulierteSummeJahr | Currency | Vom Flow berechnet (inkl. dieses Antrags) |
| Status | Choice | Eingereicht / Kein Handlungsbedarf / Dokumentiert / In Genehmigung / In Genehmigung Stufe 1 / In Genehmigung Stufe 2 / Genehmigt / Abgelehnt / Archiviert |
| GenehmigungGestartet | DateTime | Für Erinnerung/Eskalation |
| AktuellerGenehmigerEmail | Text | Für Erinnerungs-Flow |
| ErinnerungGesendet | Boolean | |
| EskalationGesendet | Boolean | |
| Genehmiger1 | Person | Führungskraft |
| Entscheidung1 | Choice | Genehmigt / Abgelehnt |
| Kommentar1 | Note | |
| Genehmiger2 | Person | Compliance Officer |
| Entscheidung2 | Choice | Genehmigt / Abgelehnt |
| Kommentar2 | Note | |
| Anmerkungen | Note | Freitext aus dem Formular |
| FormsResponseId | Text | Referenz zur Forms-Antwort |

Anlagen (Rechnungen, Belege) werden als **Listenelement-Anhänge** gespeichert
(Flow 1 kopiert sie aus dem OneDrive des Form-Besitzers).

### Liste `ZAPP_Konfiguration`

Eine Zeile pro Empfängertyp – der CO ändert Schwellenwerte selbst, ohne Flow/Formular anzufassen.

| Interner Name | Typ | Nicht-Amtsträger (Beispiel) | Amtsträger (Beispiel) |
|---|---|---|---|
| Title | Text | `Nicht-Amtsträger` | `Amtsträger` |
| DokuSchwelle | Currency | 35 | 0 |
| GenehmigungsSchwelle | Currency | 100 | 0 |
| KumulierungsSchwelleJahr | Currency | 150 | 0 |
| ComplianceOfficer | Person | … | … |
| Vertreter | Person | … | … |
| ZweistufigAktiv | Boolean | Ja | Ja |
| ErinnerungNachTagen | Number | 3 | 3 |
| EskalationNachTagen | Number | 7 | 7 |
| AufbewahrungJahre | Number | 6 | 6 |

Logik: `Betrag < DokuSchwelle` ⇒ kein Handlungsbedarf ·
`< GenehmigungsSchwelle` ⇒ nur Doku · sonst Genehmigung.
Amtsträger mit Schwellen = 0 ⇒ immer genehmigungspflichtig (gleiche Logik, keine Sonderfälle im Flow).

---

## 2. MS Forms – Fragenkatalog (15 Fragen)

Formular auf dem Service-Konto anlegen, Zugriff „Nur Personen in meiner Organisation“
(damit Name/E-Mail des Einreichers automatisch erfasst werden).

1. Richtung: Geben oder Empfangen? *(Auswahl: Geben / Empfangen)*
2. Art der Zuwendung *(Auswahl: Geschenk / Bewirtung / Einladung Veranstaltung / Reisekosten / Sonstiges)*
3. Beschreibung der Zuwendung *(Text)*
4. Wert in EUR (ggf. geschätzt) *(Zahl)*
5. Datum der Zuwendung *(Datum)*
6. Anlass *(Text)*
7. Geschäftspartner (Unternehmen) *(Text)*
8. Person beim Geschäftspartner *(Text)*
9. Handelt es sich um einen Amtsträger? *(Auswahl: Ja / Nein)*
10. Besteht mit dem Partner aktuell eine Ausschreibung, Vergabe oder Vertragsverhandlung? *(Auswahl: Ja / Nein / Weiß nicht)* ← **Red Flag**
11. Wurde die Zuwendung bereits gewährt/angenommen? *(Auswahl: Ja / Nein)*
12. Einmalig oder wiederkehrend? *(Auswahl)*
13. Anlagen (Rechnung, Beleg, Mailverkehr) *(Datei-Upload, mehrere erlauben)*
14. Anmerkungen *(Text, lang)*
15. Ich bestätige die Richtigkeit der Angaben *(Auswahl: Ja)*

Keine Verzweigungslogik in Forms einbauen – die gesamte Schwellenlogik liegt in Flow 1
(sonst gibt es die Logik doppelt und die Kumulierungsprüfung wäre unmöglich).

---

## 3. Flow 1 – „ZAPP – Intake“

**Trigger:** Forms – *When a new response is submitted* (Form auswählen)

1. **Forms – Get response details** (Response Id aus Trigger).
2. **Compose `cEmpfaengerTyp`:**
   `if(equals(<Antwort Frage 9>, 'Ja'), 'Amtsträger', 'Nicht-Amtsträger')`
3. **Compose `cBetrag`:** `float(<Antwort Frage 4>)`
4. **SharePoint – Get items** `ZAPP_Konfiguration`, Filter Query:
   `Title eq '@{outputs('cEmpfaengerTyp')}'`, Top Count 1.
5. **Compose `cKonfig`:** `first(body('Get_items_Konfiguration')?['value'])`
   – Zugriffe später z. B. `outputs('cKonfig')?['GenehmigungsSchwelle']`.
6. **Kumulierungsprüfung** – SharePoint – Get items `ZAPP`, Filter Query:

   ```
   AntragstellerEmail eq '@{outputs('Get_response_details')?['body/responder']}'
   and Geschaeftspartner eq '@{<Antwort Frage 7>}'
   and DatumZuwendung ge '@{concat(formatDateTime(utcNow(),'yyyy'),'-01-01')}'
   and Status ne 'Abgelehnt'
   ```

7. **Select `sBetraege`:** From = Ergebnis aus 6, Map: `Betrag` → `item()?['Betrag']`
8. **Compose `cSummeBisher`:**

   ```
   xpath(xml(json(concat('{"root":{"item":', string(body('sBetraege')), '}}'))), 'sum(//item/Betrag)')
   ```

9. **Compose `cGesamtsumme`:** `add(float(outputs('cSummeBisher')), outputs('cBetrag'))`
10. **SharePoint – Create item** in `ZAPP`: alle Formularfelder,
    `Status = Eingereicht`, `KumulierteSummeJahr = cGesamtsumme`,
    `Title = concat('ZW-', formatDateTime(utcNow(),'yyyy'), '-', <ID nach Create per Update nachtragen oder utcNow-Ticks>)`.
11. **Anlagen kopieren** – Compose `cAnlagen`: `json(<Antwort Frage 13>)`
    (Forms liefert ein JSON-Array). **Apply to each** über `outputs('cAnlagen')`:
    - OneDrive for Business – *Get file content* (File = `item()?['id']`)
      – die Dateien liegen im OneDrive des Form-Besitzers unter `Apps/Microsoft Forms/…`.
    - SharePoint – *Add attachment* am Item aus Schritt 10 (`item()?['name']` + Inhalt).
12. **Entscheidungslogik (verschachtelte Condition):**
    - **Genehmigungspflichtig**, wenn
      `cBetrag ≥ GenehmigungsSchwelle` **oder** `cGesamtsumme ≥ KumulierungsSchwelleJahr`
      **oder** `<Antwort Frage 10> ≠ 'Nein'` (Red Flag):
      → Update item: `Status = In Genehmigung`, `GenehmigungGestartet = utcNow()`
      → Mail an Antragsteller: „Ihre Meldung ZW-… ist eingegangen und wird geprüft.“
    - sonst **Dokumentationspflichtig**, wenn `cBetrag ≥ DokuSchwelle`:
      → Update item: `Status = Dokumentiert`
      → Mail: „Diese Zuwendung bedarf keiner Genehmigung, sie wurde dokumentiert.“
    - sonst: → Update item: `Status = Kein Handlungsbedarf`
      → Mail: „Keine Dokumentation und Genehmigung erforderlich.“

**Fehlerbehandlung:** Schritte 1–12 in einen Scope „Try“; dahinter Scope „Catch“
(*Configure run after: has failed, has timed out*) mit Mail an Admin inkl. Run-Link:

```
concat('https://make.powerautomate.com/environments/', workflow()?['tags']?['environmentName'],
       '/flows/', workflow()?['name'], '/runs/', workflow()?['run']?['name'])
```

---

## 4. Flow 2 – „ZAPP – Genehmigung“

**Trigger:** SharePoint – *When an item is created or modified* (`ZAPP`),
**Trigger Condition** (Settings → Trigger Conditions – verhindert Endlosschleife):

```
@equals(triggerBody()?['Status']?['Value'], 'In Genehmigung')
```

1. **Update item:** `Status = In Genehmigung Stufe 1` (matcht die Trigger Condition
   nicht mehr ⇒ kein Retrigger).
2. **Get items** `ZAPP_Konfiguration` (Filter `Title eq '<EmpfaengerTyp des Items>'`), `cKonfig` wie oben.
3. **Office 365 Users – Get manager (v2)** von `AntragstellerEmail`.
   In eigenen Try-Scope: schlägt fehl (z. B. Geschäftsführung ohne Manager)
   → Catch: Genehmiger Stufe 1 = ComplianceOfficer aus `cKonfig`.
4. **Update item:** `AktuellerGenehmigerEmail = <Manager-Mail>`.
5. **Approvals – Start and wait for an approval** (Typ *Approve/Reject – First to respond*):
   - Assigned to: Manager
   - Title: `Zuwendung @{Title}: @{Geschaeftspartner}, @{Betrag} €`
   - Details (Markdown): Richtung, Art, Anlass, Betrag, **kumulierte Jahressumme**,
     Red-Flag-Hinweis, Link zum Listenelement.
6. **Ergebnis schreiben:** `Genehmiger1`, `Entscheidung1`, `Kommentar1`
   (`outputs(...)?['body/responses'][0]` → `comments`).
7. **Condition – abgelehnt?** → `Status = Abgelehnt`, Mail an Antragsteller
   (mit Kommentar), CC Compliance Officer. **Terminate (Succeeded)**.
8. **Condition – `ZweistufigAktiv`?**
   - Ja: `Status = In Genehmigung Stufe 2`, `AktuellerGenehmigerEmail = CO`,
     `ErinnerungGesendet = false` zurücksetzen.
     **Approval 2** an ComplianceOfficer **und** Vertreter (*First to respond* –
     damit Urlaub den Prozess nicht blockiert). Ergebnis in `Genehmiger2/Entscheidung2/Kommentar2`.
   - Nein: weiter zu 9.
9. **Finaler Status** `Genehmigt` oder `Abgelehnt` + Mail an Antragsteller mit
   Entscheidung und Kommentaren.

---

## 5. Flow 3 – „ZAPP – Erinnerung & Eskalation“

**Trigger:** Recurrence, täglich 07:00, Zeitzone W. Europe Standard Time.

1. **Get items** `ZAPP`, Filter Query: `startswith(Status,'In Genehmigung')`
2. **Apply to each:**
   - Konfig-Zeile zum EmpfaengerTyp holen (oder einmal vor der Schleife beide laden).
   - **Eskalation:** wenn `GenehmigungGestartet < addDays(utcNow(), -<EskalationNachTagen>)`
     und `EskalationGesendet = false`
     → Mail an Vertreter + CO („seit X Tagen unbearbeitet“), `EskalationGesendet = true`.
   - sonst **Erinnerung:** wenn `< addDays(utcNow(), -<ErinnerungNachTagen>)`
     und `ErinnerungGesendet = false`
     → Mail an `AktuellerGenehmigerEmail`, `ErinnerungGesendet = true`.

Vergleichs-Ausdruck (Condition, *less than*):

```
items('Apply_to_each')?['GenehmigungGestartet']
   <   addDays(utcNow(), mul(-1, int(outputs('cKonfig')?['EskalationNachTagen'])))
```

---

## 6. Flow 4 – „ZAPP – Archivierung (DSGVO)“

**Trigger:** Recurrence, monatlich (1. des Monats, 06:00).

1. **Get items**, Filter Query:
   `DatumZuwendung lt '@{formatDateTime(getPastTime(6,'Year'),'yyyy-MM-dd')}' and Status ne 'Archiviert'`
   (6 = `AufbewahrungJahre`; steuerlich relevante Belege 6–10 Jahre aufbewahren – mit
   Steuerabteilung abstimmen).
2. **Apply to each:** Personenfelder leeren, `AntragstellerEmail = 'anonymisiert'`,
   Beschreibung/Anmerkungen kürzen, Anhänge löschen (SharePoint – *Get attachments* →
   *Delete attachment*), `Status = Archiviert`.
   Alternativ vorher als CSV in eine Archiv-Bibliothek exportieren.

---

## 7. Power BI (optional)

Datenquelle: SharePoint-Liste `ZAPP` (Connector „SharePoint Online-Liste“).
Sinnvolle Kacheln für den CO:

- Summe Zuwendungen je Geschäftspartner (Top 10) – Kumulierungs-Hotspots
- Anzahl/Summe je Monat (Trend), Split Geben vs. Empfangen
- Ablehnungsquote, durchschnittliche Genehmigungsdauer (`Modified - GenehmigungGestartet`)
- Red-Flag-Vorgänge

Zugriff auf den Bericht nur Compliance Office (Workspace-Berechtigung).

---

## 8. Betrieb / ALM

- Form + alle 4 Flows gehören dem **Service-Konto**; CO und Admin als Mitbesitzer der Flows.
- Flows in einer **Solution** anlegen (make.powerautomate.com → Solutions) mit
  Connection References – dann sind sie exportierbar/versionierbar.
- Site-Berechtigungen: Antragsteller haben keinen Zugriff auf die Liste;
  Mails aus den Flows sind ihre einzige Sicht auf den Vorgang.
- Änderungen an Schwellen/Personen: nur `ZAPP_Konfiguration` pflegen, kein Flow-Deployment.

## Reihenfolge beim Aufbau

1. `provision-zapp-lists.ps1` gegen die Site laufen lassen (legt beide Listen + Beispiel-Konfig an)
2. Forms-Formular anlegen (Abschnitt 2)
3. Flow 1 bauen und mit Testantworten alle drei Zweige prüfen
4. Flow 2 bauen (Trigger Condition nicht vergessen!), Genehmigung in Outlook/Teams testen
5. Flows 3 + 4 bauen
6. Power BI, Rollout-Kommunikation (Handout), Richtlinie referenzieren
