"use strict";

// Zentrale Konfiguration der ZAPP-SPA.
// TODO vor dem ersten Start prüfen: siteHostname + sitePath auf die Site zeigen lassen,
// auf der die Listen ZAPP und ZAPP_Konfiguration liegen.
const ZAPP_CONFIG = {
  clientId: "c7710322-13ab-44c5-8ba1-314ca5cdb38d",
  tenantId: "fdb70646-023a-403b-a4b9-1f474a935123",

  siteHostname: "dihag.sharepoint.com",   // TODO: prüfen
  sitePath: "/sites/zapp",                // TODO: prüfen

  listName: "ZAPP",
  configListName: "ZAPP_Konfiguration",
  attachmentsLibrary: "ZAPP_Anlagen",     // Dokumentbibliothek für Anhänge (muss auf der Site existieren)

  // User.Read.All nur nötig, wenn Genehmigungsstufe 1 über die Führungskraft (Get manager) läuft.
  graphScopes: ["User.Read", "User.ReadBasic.All", "Sites.ReadWrite.All", "Mail.Send", "User.Read.All"],

  maxAttachmentBytes: 4 * 1024 * 1024
};
