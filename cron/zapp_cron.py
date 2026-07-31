#!/usr/bin/env python3
"""ZAPP Cron-Job (App-only, Microsoft Graph).

Laeuft taeglich via GitHub Actions und erledigt, was die SPA nicht kann:
  1. Erinnerung + Eskalation offener Genehmigungen
  2. Tenant-weite Kumulierungspruefung je Geschaeftspartner/Jahr (ueber alle Antragsteller)
  3. DSGVO-Archivierung/Anonymisierung nach Ablauf der Aufbewahrungsfrist

Nur Python-Standardbibliothek. Konfiguration ueber Umgebungsvariablen
(siehe cron/README.md). Versand aller Mails einheitlich als ZAPP_SENDER
(administrator@dihag.com) mit Application-Permission Mail.Send.
"""

import os
import sys
import json
import datetime
import urllib.request
import urllib.parse
import urllib.error

TENANT   = os.environ["ZAPP_TENANT_ID"]
CLIENT   = os.environ["ZAPP_CLIENT_ID"]
SECRET   = os.environ["ZAPP_CLIENT_SECRET"]
HOST     = os.environ.get("ZAPP_SITE_HOST", "dihag.sharepoint.com")
SITEPATH = os.environ.get("ZAPP_SITE_PATH", "/sites/IT")
SENDER   = os.environ.get("ZAPP_SENDER", "administrator@dihag.com")
APP_URL  = os.environ.get("ZAPP_APP_URL", "https://zapp.dihag.de/")

LIST        = "ZAPP"
CONFIG_LIST = "ZAPP_Konfiguration"
ANLAGEN_LIB = "ZAPP_Anlagen"
GRAPH       = "https://graph.microsoft.com/v1.0"

NOW = datetime.datetime.now(datetime.timezone.utc)


# --------------------------------------------------------------------------
# Graph-Grundfunktionen
# --------------------------------------------------------------------------

def get_token():
    data = urllib.parse.urlencode({
        "client_id": CLIENT,
        "client_secret": SECRET,
        "scope": "https://graph.microsoft.com/.default",
        "grant_type": "client_credentials",
    }).encode()
    url = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
    with urllib.request.urlopen(urllib.request.Request(url, data=data)) as r:
        return json.load(r)["access_token"]


TOKEN = get_token()


def api(method, path, body=None):
    url = path if path.startswith("http") else GRAPH + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> {e.code}: {e.read().decode()[:400]}")


SITE_ID = api("GET", f"/sites/{HOST}:{SITEPATH}")["id"]


def all_items(list_name):
    out, url = [], f"/sites/{SITE_ID}/lists/{list_name}/items?expand=fields&$top=200"
    while url:
        d = api("GET", url)
        out += d["value"]
        url = d.get("@odata.nextLink")
    return out


def patch_fields(list_name, item_id, fields):
    api("PATCH", f"/sites/{SITE_ID}/lists/{list_name}/items/{item_id}/fields", fields)


def send_mail(to, subject, html):
    if not to:
        return
    api("POST", f"/users/{urllib.parse.quote(SENDER)}/sendMail", {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": html},
            "toRecipients": [{"emailAddress": {"address": to}}],
        },
        "saveToSentItems": True,
    })


# --------------------------------------------------------------------------
# Hilfsfunktionen
# --------------------------------------------------------------------------

def parse_dt(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))


def days_since(s):
    return (NOW - parse_dt(s)).days


def num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def link_for(item_id):
    return f"{APP_URL}?vorgang={item_id}"


def load_config():
    types, glob = {}, {}
    for r in all_items(CONFIG_LIST):
        f = r["fields"]
        if f.get("Title") == "Allgemein":
            glob = f
        else:
            types[f.get("Title")] = f
    nat = types.get("Nicht-Amtsträger", {})
    co = (glob.get("ComplianceOfficerEmail") or nat.get("ComplianceOfficerEmail") or SENDER).strip()
    vert = (glob.get("VertreterEmail") or nat.get("VertreterEmail") or co).strip()
    return types, co, vert


def anlagen_drive_id():
    for dr in api("GET", f"/sites/{SITE_ID}/drives").get("value", []):
        if dr["name"] == ANLAGEN_LIB:
            return dr["id"]
    return None


# --------------------------------------------------------------------------
# 1. Erinnerung + Eskalation
# --------------------------------------------------------------------------

def run_reminders(items, types, co, vert):
    for it in items:
        f = it["fields"]
        if not str(f.get("Status", "")).startswith("In Genehmigung"):
            continue
        started = f.get("GenehmigungGestartet")
        if not started:
            continue
        try:
            cfg = types.get(f.get("EmpfaengerTyp", "Nicht-Amtsträger"), {})
            erin = int(num(cfg.get("ErinnerungNachTagen"), 3))
            eska = int(num(cfg.get("EskalationNachTagen"), 7))
            d = days_since(started)
            title = f.get("Title", "")
            partner = f.get("Geschaeftspartner", "")
            betrag = f.get("Betrag", "")
            approver = (f.get("AktuellerGenehmigerEmail") or co).strip()
            link = link_for(it["id"])

            if d >= eska and not f.get("EskalationGesendet"):
                send_mail(vert, f"ZAPP Eskalation: {title} seit {d} Tagen offen",
                          f"<p>Der Vorgang <b>{title}</b> ({partner}, {betrag} €) wartet seit "
                          f"<b>{d} Tagen</b> auf Genehmigung durch {approver} und wurde noch nicht "
                          f"entschieden.</p><p><a href='{link}'>Vorgang in ZAPP öffnen</a></p>")
                patch_fields(LIST, it["id"], {"EskalationGesendet": True})
                print(f"Eskalation: {title} ({d}d)")
            elif d >= erin and not f.get("ErinnerungGesendet"):
                send_mail(approver, f"ZAPP Erinnerung: {title} wartet auf Ihre Genehmigung",
                          f"<p>Der Vorgang <b>{title}</b> ({partner}, {betrag} €) wartet seit "
                          f"<b>{d} Tagen</b> auf Ihre Entscheidung.</p>"
                          f"<p><a href='{link}'>Vorgang öffnen und entscheiden</a></p>")
                patch_fields(LIST, it["id"], {"ErinnerungGesendet": True})
                print(f"Erinnerung: {title} ({d}d)")
        except Exception as e:
            print(f"WARN Erinnerung {f.get('Title')}: {e}", file=sys.stderr)


# --------------------------------------------------------------------------
# 2. Tenant-weite Kumulierung (ueber alle Antragsteller)
# --------------------------------------------------------------------------

def run_cumulation(items, types, co):
    sums = {}
    for it in items:
        f = it["fields"]
        if f.get("Status") in ("Abgelehnt", "Archiviert"):
            continue
        p = (f.get("Geschaeftspartner") or "").strip().lower()
        dt = f.get("DatumZuwendung")
        if not p or not dt:
            continue
        key = (p, parse_dt(dt).year)
        sums[key] = sums.get(key, 0.0) + num(f.get("Betrag"))

    for it in items:
        f = it["fields"]
        # nur noch nicht genehmigungspflichtige Vorgaenge nachtraeglich eskalieren
        if f.get("Status") not in ("Kein Handlungsbedarf", "Dokumentiert"):
            continue
        p = (f.get("Geschaeftspartner") or "").strip().lower()
        dt = f.get("DatumZuwendung")
        if not p or not dt:
            continue
        try:
            thr = num(types.get(f.get("EmpfaengerTyp", "Nicht-Amtsträger"), {}).get("KumulierungsSchwelleJahr"))
            if thr <= 0:
                continue
            jahr = parse_dt(dt).year
            total = sums.get((p, jahr), 0.0)
            if total < thr:
                continue
            title = f.get("Title", "")
            link = link_for(it["id"])
            patch_fields(LIST, it["id"], {
                "Status": "In Genehmigung Stufe 1",
                "GenehmigungGestartet": NOW.isoformat(),
                "AktuellerGenehmigerEmail": co,
                "ErinnerungGesendet": False,
                "EskalationGesendet": False,
            })
            send_mail(co, f"ZAPP: Kumulierung überschritten – {title} ({f.get('Geschaeftspartner','')})",
                      f"<p>Die Jahressumme beim Partner <b>{f.get('Geschaeftspartner','')}</b> ({jahr}) "
                      f"hat mit <b>{total:.2f} €</b> die Kumulierungsschwelle {thr:.2f} € überschritten "
                      f"(Summe über alle Mitarbeiter).</p><p>Der zuvor nur dokumentierte Vorgang "
                      f"<b>{title}</b> wurde deshalb nachträglich zur Genehmigung vorgelegt.</p>"
                      f"<p><a href='{link}'>Vorgang öffnen</a></p>")
            print(f"Kumulierung eskaliert: {title} (Partner-Summe {total:.2f} >= {thr:.2f})")
        except Exception as e:
            print(f"WARN Kumulierung {f.get('Title')}: {e}", file=sys.stderr)


# --------------------------------------------------------------------------
# 3. DSGVO-Archivierung / Anonymisierung
# --------------------------------------------------------------------------

def run_archiving(items, types):
    drive_id = None
    for it in items:
        f = it["fields"]
        if f.get("Status") == "Archiviert":
            continue
        dt = f.get("DatumZuwendung")
        if not dt:
            continue
        try:
            jahre = int(num(types.get(f.get("EmpfaengerTyp", "Nicht-Amtsträger"), {}).get("AufbewahrungJahre"), 6))
            if days_since(dt) < jahre * 365:
                continue
            title = f.get("Title", "")
            # personenbezogene Felder anonymisieren, Statistikfelder (Partner-Firma, Betrag, Art) bleiben
            patch_fields(LIST, it["id"], {
                "AntragstellerEmail": "anonymisiert",
                "PartnerPerson": "anonymisiert",
                "Anmerkungen": "",
                "AktuellerGenehmigerEmail": "",
                "Status": "Archiviert",
            })
            # Anhaenge loeschen (Ordner = Vorgangsnummer)
            try:
                if drive_id is None:
                    drive_id = anlagen_drive_id()
                if drive_id and title:
                    api("DELETE", f"/drives/{drive_id}/root:/{urllib.parse.quote(title)}:")
            except Exception:
                pass
            print(f"Archiviert/anonymisiert: {title}")
        except Exception as e:
            print(f"WARN Archivierung {f.get('Title')}: {e}", file=sys.stderr)


# --------------------------------------------------------------------------

def main():
    types, co, vert = load_config()
    if "Nicht-Amtsträger" not in types or "Amtsträger" not in types:
        print("ABBRUCH: ZAPP_Konfiguration unvollständig (Zeilen Nicht-Amtsträger/Amtsträger fehlen).",
              file=sys.stderr)
        sys.exit(1)
    items = all_items(LIST)
    print(f"ZAPP Cron gestartet {NOW.isoformat()} – {len(items)} Vorgänge, CO={co}")
    run_reminders(items, types, co, vert)
    run_cumulation(items, types, co)
    run_archiving(items, types)
    print("ZAPP Cron fertig.")


if __name__ == "__main__":
    main()
