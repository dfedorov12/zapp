# ZAPP - Provisionierung der SharePoint-Listen
# Voraussetzung: Install-Module PnP.PowerShell -Scope CurrentUser
# PnP benoetigt eine registrierte Entra-App (ClientId), siehe:
# https://pnp.github.io/powershell/articles/registerapplication.html
#
# Aufruf:
#   .\provision-zapp-lists.ps1 -SiteUrl "https://<tenant>.sharepoint.com/sites/zapp" `
#       -ClientId "<entra-app-guid>" `
#       -ComplianceOfficer "co@firma.de" -Vertreter "vertreter@firma.de"

param(
    [Parameter(Mandatory)] [string]$SiteUrl,
    [Parameter(Mandatory)] [string]$ClientId,
    [Parameter(Mandatory)] [string]$ComplianceOfficer,
    [Parameter(Mandatory)] [string]$Vertreter
)

$ErrorActionPreference = "Stop"
Connect-PnPOnline -Url $SiteUrl -Interactive -ClientId $ClientId

# ---------------------------------------------------------------------------
# Liste: ZAPP
# ---------------------------------------------------------------------------
$lz = "ZAPP"
if (-not (Get-PnPList -Identity $lz -ErrorAction SilentlyContinue)) {
    New-PnPList -Title $lz -Template GenericList -EnableVersioning | Out-Null
    Write-Host "Liste $lz angelegt."
}

$statusChoices = @(
    "Eingereicht", "Kein Handlungsbedarf", "Dokumentiert",
    "In Genehmigung", "In Genehmigung Stufe 1", "In Genehmigung Stufe 2",
    "Genehmigt", "Abgelehnt", "Archiviert"
)

# @{InternalName; DisplayName; Type; Choices (optional)}
$felderZuwendungen = @(
    @{N = "Richtung";                 D = "Richtung";                   T = "Choice";   C = @("Geben", "Empfangen") },
    @{N = "AntragstellerEmail";       D = "Antragsteller E-Mail";       T = "Text" },
    @{N = "Antragsteller";            D = "Antragsteller";              T = "User" },
    @{N = "Geschaeftspartner";        D = "Geschäftspartner";           T = "Text" },
    @{N = "PartnerPerson";            D = "Person beim Partner";        T = "Text" },
    @{N = "EmpfaengerTyp";            D = "Empfängertyp";               T = "Choice";   C = @("Nicht-Amtsträger", "Amtsträger") },
    @{N = "ArtZuwendung";             D = "Art der Zuwendung";          T = "Choice";   C = @("Geschenk", "Bewirtung", "Einladung Veranstaltung", "Reisekosten", "Sonstiges") },
    @{N = "Beschreibung";             D = "Beschreibung";               T = "Note" },
    @{N = "Betrag";                   D = "Betrag (EUR)";               T = "Currency" },
    @{N = "DatumZuwendung";           D = "Datum der Zuwendung";        T = "DateTime" },
    @{N = "Anlass";                   D = "Anlass";                     T = "Text" },
    @{N = "RedFlag";                  D = "Red Flag (Ausschreibung)";   T = "Boolean" },
    @{N = "KumulierteSummeJahr";      D = "Kumulierte Summe (Jahr)";    T = "Currency" },
    @{N = "Status";                   D = "Status";                     T = "Choice";   C = $statusChoices },
    @{N = "GenehmigungGestartet";     D = "Genehmigung gestartet";      T = "DateTime" },
    @{N = "AktuellerGenehmigerEmail"; D = "Aktueller Genehmiger";       T = "Text" },
    @{N = "ErinnerungGesendet";       D = "Erinnerung gesendet";        T = "Boolean" },
    @{N = "EskalationGesendet";       D = "Eskalation gesendet";        T = "Boolean" },
    @{N = "Genehmiger1";              D = "Genehmiger Stufe 1";         T = "User" },
    @{N = "Entscheidung1";            D = "Entscheidung Stufe 1";       T = "Choice";   C = @("Genehmigt", "Abgelehnt") },
    @{N = "Kommentar1";               D = "Kommentar Stufe 1";          T = "Note" },
    @{N = "Genehmiger2";              D = "Genehmiger Stufe 2";         T = "User" },
    @{N = "Entscheidung2";            D = "Entscheidung Stufe 2";       T = "Choice";   C = @("Genehmigt", "Abgelehnt") },
    @{N = "Kommentar2";               D = "Kommentar Stufe 2";          T = "Note" },
    @{N = "Anmerkungen";              D = "Anmerkungen";                T = "Note" },
    @{N = "FormsResponseId";          D = "Forms Response Id";          T = "Text" }
)

foreach ($f in $felderZuwendungen) {
    if (Get-PnPField -List $lz -Identity $f.N -ErrorAction SilentlyContinue) { continue }
    $params = @{
        List = $lz; InternalName = $f.N; DisplayName = $f.D; Type = $f.T
        AddToDefaultView = $true
    }
    if ($f.C) { $params.Choices = $f.C }
    Add-PnPField @params | Out-Null
    Write-Host "  Feld $($f.N) ($($f.T)) angelegt."
}

# ---------------------------------------------------------------------------
# Liste: ZAPP_Konfiguration
# ---------------------------------------------------------------------------
$lk = "ZAPP_Konfiguration"
if (-not (Get-PnPList -Identity $lk -ErrorAction SilentlyContinue)) {
    New-PnPList -Title $lk -Template GenericList -EnableVersioning | Out-Null
    Write-Host "Liste $lk angelegt."
}

$felderKonfig = @(
    @{N = "DokuSchwelle";             D = "Doku-Schwelle (EUR)";           T = "Currency" },
    @{N = "GenehmigungsSchwelle";     D = "Genehmigungs-Schwelle (EUR)";   T = "Currency" },
    @{N = "KumulierungsSchwelleJahr"; D = "Kumulierungs-Schwelle/Jahr";    T = "Currency" },
    @{N = "ComplianceOfficer";        D = "Compliance Officer";            T = "User" },
    @{N = "Vertreter";                D = "Vertreter";                     T = "User" },
    @{N = "ZweistufigAktiv";          D = "Zweistufige Genehmigung";       T = "Boolean" },
    @{N = "ErinnerungNachTagen";      D = "Erinnerung nach (Tagen)";       T = "Number" },
    @{N = "EskalationNachTagen";      D = "Eskalation nach (Tagen)";       T = "Number" },
    @{N = "AufbewahrungJahre";        D = "Aufbewahrung (Jahre)";          T = "Number" }
)

foreach ($f in $felderKonfig) {
    if (Get-PnPField -List $lk -Identity $f.N -ErrorAction SilentlyContinue) { continue }
    Add-PnPField -List $lk -InternalName $f.N -DisplayName $f.D -Type $f.T -AddToDefaultView | Out-Null
    Write-Host "  Feld $($f.N) ($($f.T)) angelegt."
}

# Beispiel-Konfiguration (nur anlegen, wenn Liste leer)
if ((Get-PnPListItem -List $lk).Count -eq 0) {
    Add-PnPListItem -List $lk -Values @{
        Title = "Nicht-Amtsträger"
        DokuSchwelle = 35; GenehmigungsSchwelle = 100; KumulierungsSchwelleJahr = 150
        ComplianceOfficer = $ComplianceOfficer; Vertreter = $Vertreter
        ZweistufigAktiv = $true
        ErinnerungNachTagen = 3; EskalationNachTagen = 7; AufbewahrungJahre = 6
    } | Out-Null
    Add-PnPListItem -List $lk -Values @{
        Title = "Amtsträger"
        DokuSchwelle = 0; GenehmigungsSchwelle = 0; KumulierungsSchwelleJahr = 0
        ComplianceOfficer = $ComplianceOfficer; Vertreter = $Vertreter
        ZweistufigAktiv = $true
        ErinnerungNachTagen = 3; EskalationNachTagen = 7; AufbewahrungJahre = 6
    } | Out-Null
    Write-Host "Beispiel-Konfiguration (2 Zeilen) angelegt."
}

Write-Host ""
Write-Host "Fertig. Naechster Schritt: Forms-Formular anlegen (siehe ANLEITUNG.md, Abschnitt 2)."
