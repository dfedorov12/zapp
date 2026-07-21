# ZAPP – Berechtigungen haerten (Aenderungssperre #3 + Datenschutz #2)
#
# Wirkt NUR auf die ZAPP-Listen, nicht auf die uebrige IT-Site:
#   - Versionierung an (Audit-Trail)
#   - Lese-/Schreibzugriff nur auf eigene Elemente
#   - Benutzerdefinierte Berechtigungsstufe "ZAPP Erfassen" = Hinzufuegen + eigene Ansehen,
#     aber NICHT Bearbeiten/Loeschen  -> eingereichte Zuwendungen sind unveraenderbar
#
# Voraussetzung: Install-Module PnP.PowerShell ; registrierte Entra-App (ClientId).
#
# Aufruf:
#   .\harden-zapp-permissions.ps1 -SiteUrl "https://dihag.sharepoint.com/sites/IT" `
#       -ClientId "<entra-app-guid>" [-ErfasserGruppe "Alle Benutzer"]

param(
    [Parameter(Mandatory)][string]$SiteUrl,
    [Parameter(Mandatory)][string]$ClientId,
    [string]$ErfasserGruppe   # optional: SP-/AD-Gruppe aller Antragsteller
)

$ErrorActionPreference = "Stop"
Connect-PnPOnline -Url $SiteUrl -Interactive -ClientId $ClientId

# --- 1. Versionierung (Audit) ---------------------------------------------
foreach ($l in @("ZAPP", "ZAPP_Konfiguration")) {
    Set-PnPList -Identity $l -EnableVersioning $true -MajorVersions 500 | Out-Null
    Write-Host "Versionierung aktiviert: $l"
}

# --- 2. Nur eigene Elemente lesen/schreiben -------------------------------
# ReadSecurity 2 = nur eigene lesen; WriteSecurity 2 = nur eigene schreiben
foreach ($l in @("ZAPP", "ZAPP_Anlagen")) {
    if (Get-PnPList -Identity $l -ErrorAction SilentlyContinue) {
        Set-PnPList -Identity $l -ReadSecurity 2 -WriteSecurity 2 | Out-Null
        Write-Host "Nur-eigene-Elemente gesetzt: $l"
    } else {
        Write-Host "Liste $l nicht gefunden – uebersprungen."
    }
}

# --- 3. Berechtigungsstufe "ZAPP Erfassen" (Hinzufuegen ohne Bearbeiten) ---
$roleName = "ZAPP Erfassen"
if (-not (Get-PnPRoleDefinition -Identity $roleName -ErrorAction SilentlyContinue)) {
    Add-PnPRoleDefinition -RoleName $roleName -Clone "Contribute" `
        -Exclude EditListItems, DeleteListItems, DeleteVersions `
        -Description "Zuwendung melden, aber eingereichte Vorgaenge nicht mehr aendern/loeschen" | Out-Null
    Write-Host "Berechtigungsstufe '$roleName' angelegt."
} else {
    Write-Host "Berechtigungsstufe '$roleName' existiert bereits."
}

# --- 4. Vererbung der ZAPP-Liste brechen + Erfasser-Gruppe zuweisen -------
if ($ErfasserGruppe) {
    Set-PnPList -Identity "ZAPP" -BreakRoleInheritance -CopyRoleAssignments | Out-Null
    # bestehende Bearbeiten/Beitragen-Zuweisung der Gruppe entfernen und "ZAPP Erfassen" setzen
    Set-PnPListPermission -Identity "ZAPP" -Group $ErfasserGruppe -RemoveRole "Bearbeiten" -ErrorAction SilentlyContinue
    Set-PnPListPermission -Identity "ZAPP" -Group $ErfasserGruppe -RemoveRole "Mitwirken"  -ErrorAction SilentlyContinue
    Set-PnPListPermission -Identity "ZAPP" -Group $ErfasserGruppe -AddRole $roleName
    Write-Host "Vererbung gebrochen; '$ErfasserGruppe' -> '$roleName'."
    Write-Host "WICHTIG: Compliance Officer/Vertreter/Genehmiger brauchen weiterhin 'Bearbeiten' auf ZAPP."
} else {
    Write-Host ""
    Write-Host "Schritt 4 uebersprungen (keine -ErfasserGruppe angegeben)."
    Write-Host "Manuell in SharePoint: Liste ZAPP -> Berechtigungen -> Vererbung beenden,"
    Write-Host "der Antragsteller-Gruppe die Stufe '$roleName' statt 'Bearbeiten' geben."
    Write-Host "CO/Vertreter/Genehmiger behalten 'Bearbeiten'."
}

Write-Host ""
Write-Host "Fertig."
