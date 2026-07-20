# ZAPP: Listen-Schema vervollstaendigen + Konfig-Zeilen + Anlagen-Bibliothek
$ErrorActionPreference = "Stop"
$g = "https://graph.microsoft.com/v1.0"

$site = Invoke-MgGraphRequest -Method GET -Uri "$g/sites/dihag.sharepoint.com:/sites/IT"
$sid = $site.id
Write-Host "Site gefunden: $($site.webUrl)"

function Ensure-Columns($listName, $defs) {
    $cols = (Invoke-MgGraphRequest -Method GET -Uri "$g/sites/$sid/lists/$listName/columns?`$top=200").value
    $existing = @($cols | ForEach-Object { $_.name })
    foreach ($d in $defs) {
        if ($existing -contains $d.name) { continue }
        $body = @{ name = $d.name; displayName = $d.name }
        $body[$d.kind] = @{}
        Invoke-MgGraphRequest -Method POST -Uri "$g/sites/$sid/lists/$listName/columns" `
            -Body ($body | ConvertTo-Json -Depth 4) -ContentType "application/json" | Out-Null
        Write-Host "  [$listName] Spalte '$($d.name)' ($($d.kind)) angelegt"
    }
}

# --- ZAPP_Konfiguration: Spalten sicherstellen -----------------------------
$konfigDefs = @(
    @{ name = "DokuSchwelle";             kind = "number" },
    @{ name = "GenehmigungsSchwelle";     kind = "number" },
    @{ name = "KumulierungsSchwelleJahr"; kind = "number" },
    @{ name = "ZweistufigAktiv";          kind = "boolean" },
    @{ name = "ErinnerungNachTagen";      kind = "number" },
    @{ name = "EskalationNachTagen";      kind = "number" },
    @{ name = "AufbewahrungJahre";        kind = "number" },
    @{ name = "ComplianceOfficerEmail";   kind = "text" },
    @{ name = "VertreterEmail";           kind = "text" }
)
Ensure-Columns "ZAPP_Konfiguration" $konfigDefs

# --- ZAPP: Spalten sicherstellen (nur fehlende werden angelegt) ------------
$zappDefs = @(
    @{ name = "Richtung";                 kind = "text" },
    @{ name = "AntragstellerEmail";       kind = "text" },
    @{ name = "Geschaeftspartner";        kind = "text" },
    @{ name = "PartnerPerson";            kind = "text" },
    @{ name = "EmpfaengerTyp";            kind = "text" },
    @{ name = "ArtZuwendung";             kind = "text" },
    @{ name = "Beschreibung";             kind = "text" },
    @{ name = "Betrag";                   kind = "number" },
    @{ name = "DatumZuwendung";           kind = "dateTime" },
    @{ name = "Anlass";                   kind = "text" },
    @{ name = "RedFlag";                  kind = "boolean" },
    @{ name = "KumulierteSummeJahr";      kind = "number" },
    @{ name = "Status";                   kind = "text" },
    @{ name = "GenehmigungGestartet";     kind = "dateTime" },
    @{ name = "AktuellerGenehmigerEmail"; kind = "text" },
    @{ name = "ErinnerungGesendet";       kind = "boolean" },
    @{ name = "EskalationGesendet";       kind = "boolean" },
    @{ name = "Entscheidung1";            kind = "text" },
    @{ name = "Kommentar1";               kind = "text" },
    @{ name = "Entscheidung2";            kind = "text" },
    @{ name = "Kommentar2";               kind = "text" },
    @{ name = "Anmerkungen";              kind = "text" }
)
Ensure-Columns "ZAPP" $zappDefs

# --- Konfig-Zeilen anlegen (CO/Vertreter vorerst = fedorov@dihag.com) ------
$rows = (Invoke-MgGraphRequest -Method GET -Uri "$g/sites/$sid/lists/ZAPP_Konfiguration/items?expand=fields&`$top=50").value
$titles = @($rows | ForEach-Object { $_.fields.Title })

$seed = @(
    @{ Title = "Nicht-Amtsträger"; DokuSchwelle = 35; GenehmigungsSchwelle = 100; KumulierungsSchwelleJahr = 150 },
    @{ Title = "Amtsträger";       DokuSchwelle = 0;  GenehmigungsSchwelle = 0;   KumulierungsSchwelleJahr = 0 }
)
foreach ($s in $seed) {
    if ($titles -contains $s.Title) { Write-Host "Konfig-Zeile '$($s.Title)' existiert bereits"; continue }
    $fields = $s + @{
        ZweistufigAktiv = $true
        ErinnerungNachTagen = 3; EskalationNachTagen = 7; AufbewahrungJahre = 6
        ComplianceOfficerEmail = "fedorov@dihag.com"
        VertreterEmail = "fedorov@dihag.com"
    }
    Invoke-MgGraphRequest -Method POST -Uri "$g/sites/$sid/lists/ZAPP_Konfiguration/items" `
        -Body (@{ fields = $fields } | ConvertTo-Json -Depth 4) -ContentType "application/json" | Out-Null
    Write-Host "Konfig-Zeile '$($s.Title)' angelegt"
}

# --- Dokumentbibliothek ZAPP_Anlagen ---------------------------------------
$lists = (Invoke-MgGraphRequest -Method GET -Uri "$g/sites/$sid/lists?`$top=200").value
if (-not ($lists | Where-Object { $_.displayName -eq "ZAPP_Anlagen" })) {
    Invoke-MgGraphRequest -Method POST -Uri "$g/sites/$sid/lists" `
        -Body (@{ displayName = "ZAPP_Anlagen"; list = @{ template = "documentLibrary" } } | ConvertTo-Json -Depth 4) `
        -ContentType "application/json" | Out-Null
    Write-Host "Dokumentbibliothek ZAPP_Anlagen angelegt"
} else {
    Write-Host "Dokumentbibliothek ZAPP_Anlagen existiert bereits"
}

Write-Host ""
Write-Host "FERTIG. CO/Vertreter-E-Mails in ZAPP_Konfiguration bei Bedarf anpassen."
