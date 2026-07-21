# ZAPP Cron – Einrichtung

Der Cron ([zapp_cron.py](zapp_cron.py)) läuft täglich über GitHub Actions
([../.github/workflows/zapp-cron.yml](../.github/workflows/zapp-cron.yml)) und macht drei Dinge:

1. **Erinnerung + Eskalation** offener Genehmigungen (nach `ErinnerungNachTagen` / `EskalationNachTagen` aus `ZAPP_Konfiguration`).
2. **Tenant-weite Kumulierung**: summiert je Geschäftspartner+Jahr über **alle** Antragsteller; überschreitet die Summe `KumulierungsSchwelleJahr`, werden bislang nur dokumentierte Vorgänge nachträglich zur Genehmigung vorgelegt (CO wird informiert).
3. **DSGVO-Archivierung**: nach Ablauf von `AufbewahrungJahre` werden personenbezogene Felder anonymisiert, Anlagen gelöscht, Status = `Archiviert`.

Er läuft **App-only** (ohne angemeldeten Nutzer) mit der App **DIHAG Cron-Job** und verschickt alle Mails einheitlich als **administrator@dihag.com**.

## 1. App-Berechtigungen (DIHAG Cron-Job, Client `089bf9ad-…`)

Im Entra-Portal → App-Registrierung *DIHAG Cron-Job* → API-Berechtigungen → **Application permissions** hinzufügen und Admin-Consent erteilen:

| Berechtigung | Zweck |
|---|---|
| `Sites.Selected` | Zugriff nur auf die eine ZAPP-Site (nicht tenant-weit) |
| `Mail.Send` | Mails als administrator@dihag.com senden |

`Sites.Selected` allein gewährt noch keinen Zugriff – die App muss zusätzlich **auf der Site freigeschaltet** werden (einmalig, als Global-/SharePoint-Admin):

```powershell
Connect-MgGraph -TenantId fdb70646-023a-403b-a4b9-1f474a935123 -Scopes "Sites.FullControl.All"
$site = Invoke-MgGraphRequest GET "https://graph.microsoft.com/v1.0/sites/dihag.sharepoint.com:/sites/IT"
Invoke-MgGraphRequest POST "https://graph.microsoft.com/v1.0/sites/$($site.id)/permissions" -Body (@{
  roles = @("write")
  grantedToIdentities = @(@{ application = @{ id = "089bf9ad-2d9a-4cbc-b85d-88b4484af0bb"; displayName = "DIHAG Cron-Job" } })
} | ConvertTo-Json -Depth 6) -ContentType "application/json"
```

## 2. Mail.Send einschränken (empfohlen)

`Mail.Send` als Application gilt sonst für **alle** Postfächer. Auf administrator@dihag.com begrenzen (Exchange Online PowerShell):

```powershell
# einmalig: mail-enabled Security-Group mit administrator@dihag.com anlegen, dann:
New-ApplicationAccessPolicy -AppId 089bf9ad-2d9a-4cbc-b85d-88b4484af0bb `
  -PolicyScopeGroupId zapp-sender@dihag.com -AccessRight RestrictAccess `
  -Description "ZAPP Cron darf nur als administrator@dihag.com senden"
```

## 3. Client-Secret + GitHub-Secrets

1. Entra → *DIHAG Cron-Job* → Zertifikate & Geheimnisse → **Neues Client-Secret**, Wert kopieren.
2. Im Repo `dfedorov12/zapp` die drei Secrets setzen (Wert des Secrets nicht committen!):

```bash
gh secret set ZAPP_TENANT_ID   -R dfedorov12/zapp -b "fdb70646-023a-403b-a4b9-1f474a935123"
gh secret set ZAPP_CLIENT_ID   -R dfedorov12/zapp -b "089bf9ad-2d9a-4cbc-b85d-88b4484af0bb"
gh secret set ZAPP_CLIENT_SECRET -R dfedorov12/zapp -b "<client-secret-wert>"
```

Site, Absender etc. stehen als `env:` im Workflow und sind keine Geheimnisse.

## 4. Testen

GitHub → Repo → **Actions → ZAPP Cron → Run workflow** (manueller Start).
Das Log zeigt pro Aktion eine Zeile (Erinnerung/Eskalation/Kumulierung/Archivierung).
Zeitplan: täglich 05:00 UTC.

## Hinweis zur Kumulierung

Die **Live**-Prüfung in der SPA sieht aus Datenschutzgründen nur die eigenen Meldungen des
Antragstellers. Die **vollständige** Summe über alle Mitarbeiter kann nur dieser App-only-Job
bilden – deshalb liegt die tenant-weite Kumulierung hier und nicht in der SPA.
