"use strict";

// Zentrale Konfiguration der ZAPP-SPA.
const ZAPP_CONFIG = {
  clientId: "c7710322-13ab-44c5-8ba1-314ca5cdb38d",
  tenantId: "fdb70646-023a-403b-a4b9-1f474a935123",

  siteHostname: "dihag.sharepoint.com",
  sitePath: "/sites/IT",

  listName: "ZAPP",
  configListName: "ZAPP_Konfiguration",
  attachmentsLibrary: "ZAPP_Anlagen",     // Dokumentbibliothek für Anhänge (muss auf der Site existieren)

  // User.Read.All nur nötig, wenn Genehmigungsstufe 1 über die Führungskraft (Get manager) läuft.
  graphScopes: ["User.Read", "User.ReadBasic.All", "Sites.ReadWrite.All", "Mail.Send", "User.Read.All"],

  maxAttachmentBytes: 4 * 1024 * 1024,
  // Gesamtgröße der inline an eine Mail angehängten Anlagen. Graph /sendMail begrenzt
  // die gesamte Nachricht auf ~4 MB; darüber liegende Dateien bleiben nur in der App/Bibliothek.
  mailMaxTotalBytes: 3 * 1024 * 1024
};
