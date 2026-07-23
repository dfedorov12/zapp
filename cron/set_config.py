#!/usr/bin/env python3
"""ZAPP Konfiguration setzen (App-only, ohne SharePoint-Login).

Setzt gezielt Rollenfelder der Zeile "Allgemein" in ZAPP_Konfiguration.
Wird via Workflow zapp-admin.yml (workflow_dispatch) mit Eingaben aufgerufen.
Leere Werte werden ignoriert (nur uebergebene Felder werden geaendert).
"""

import os
import sys
import json
import urllib.request
import urllib.parse
import urllib.error

TENANT   = os.environ["ZAPP_TENANT_ID"]
CLIENT   = os.environ["ZAPP_CLIENT_ID"]
SECRET   = os.environ["ZAPP_CLIENT_SECRET"]
HOST     = os.environ.get("ZAPP_SITE_HOST", "dihag.sharepoint.com")
SITEPATH = os.environ.get("ZAPP_SITE_PATH", "/sites/IT")
GRAPH    = "https://graph.microsoft.com/v1.0"
CONFIG_LIST = "ZAPP_Konfiguration"


def get_token():
    data = urllib.parse.urlencode({
        "client_id": CLIENT, "client_secret": SECRET,
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


def main():
    wanted = {}
    if os.environ.get("ZAPP_SET_CO", "").strip():
        wanted["ComplianceOfficerEmail"] = os.environ["ZAPP_SET_CO"].strip()
    if os.environ.get("ZAPP_SET_VERTRETER", "").strip():
        wanted["VertreterEmail"] = os.environ["ZAPP_SET_VERTRETER"].strip()
    if os.environ.get("ZAPP_SET_ADMINS", "").strip():
        wanted["AdminEmails"] = os.environ["ZAPP_SET_ADMINS"].strip()

    if not wanted:
        print("Keine Werte uebergeben – nichts zu tun.")
        return

    rows = all_items(CONFIG_LIST)
    allg = next((r for r in rows if r["fields"].get("Title") == "Allgemein"), None)
    if allg:
        api("PATCH", f"/sites/{SITE_ID}/lists/{CONFIG_LIST}/items/{allg['id']}/fields", wanted)
        print(f"'Allgemein' aktualisiert: {wanted}")
    else:
        api("POST", f"/sites/{SITE_ID}/lists/{CONFIG_LIST}/items",
            {"fields": {**wanted, "Title": "Allgemein"}})
        print(f"'Allgemein' angelegt: {wanted}")

    # Kontrolle
    allg = next((r for r in all_items(CONFIG_LIST) if r["fields"].get("Title") == "Allgemein"), None)
    f = allg["fields"] if allg else {}
    print("Aktuell:", json.dumps({k: f.get(k) for k in
          ["ComplianceOfficerEmail", "VertreterEmail", "AdminEmails"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
