"use strict";

// MSAL-Setup und Microsoft-Graph-Helfer

const msalInstance = new msal.PublicClientApplication({
  auth: {
    clientId: ZAPP_CONFIG.clientId,
    authority: "https://login.microsoftonline.com/" + ZAPP_CONFIG.tenantId,
    redirectUri: window.location.origin + window.location.pathname
  },
  cache: { cacheLocation: "sessionStorage" }
});

let _account = null;

// Liefert das angemeldete Konto oder startet den Login-Redirect (dann null).
async function ensureLogin() {
  const resp = await msalInstance.handleRedirectPromise();
  if (resp && resp.account) {
    _account = resp.account;
  } else {
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length > 0) {
      _account = accounts[0];
    } else {
      msalInstance.loginRedirect({ scopes: ZAPP_CONFIG.graphScopes });
      return null;
    }
  }
  msalInstance.setActiveAccount(_account);
  return _account;
}

function logout() {
  msalInstance.logoutRedirect({ account: _account });
}

async function getToken() {
  try {
    const r = await msalInstance.acquireTokenSilent({ scopes: ZAPP_CONFIG.graphScopes, account: _account });
    return r.accessToken;
  } catch (e) {
    msalInstance.acquireTokenRedirect({ scopes: ZAPP_CONFIG.graphScopes });
    throw e;
  }
}

async function graphFetch(path, opts = {}) {
  const token = await getToken();
  const url = path.startsWith("https://") ? path : "https://graph.microsoft.com/v1.0" + path;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
      ...(opts.headers || {})
    }
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : res.status + " " + res.statusText;
    throw new Error(msg);
  }
  return data;
}

// ---------------------------------------------------------------------------
// SharePoint über Graph
// ---------------------------------------------------------------------------

let _siteId = null;
let _anlagenDriveId = null;

async function getSiteId() {
  if (_siteId) return _siteId;
  const site = await graphFetch(`/sites/${ZAPP_CONFIG.siteHostname}:${ZAPP_CONFIG.sitePath}`);
  _siteId = site.id;
  return _siteId;
}

async function getAllItems(listName) {
  const siteId = await getSiteId();
  let url = `/sites/${siteId}/lists/${encodeURIComponent(listName)}/items?expand=fields&$top=200`;
  const out = [];
  while (url) {
    const data = await graphFetch(url);
    out.push(...data.value);
    url = data["@odata.nextLink"] || null;
  }
  return out;
}

async function createItem(listName, fields) {
  const siteId = await getSiteId();
  return graphFetch(`/sites/${siteId}/lists/${encodeURIComponent(listName)}/items`, {
    method: "POST",
    body: JSON.stringify({ fields })
  });
}

async function updateItemFields(listName, itemId, fields) {
  const siteId = await getSiteId();
  return graphFetch(`/sites/${siteId}/lists/${encodeURIComponent(listName)}/items/${itemId}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields)
  });
}

// ---------------------------------------------------------------------------
// Anhänge (Dokumentbibliothek, ein Ordner je Vorgangsnummer)
// ---------------------------------------------------------------------------

async function getAnlagenDriveId() {
  if (_anlagenDriveId) return _anlagenDriveId;
  const siteId = await getSiteId();
  const drives = await graphFetch(`/sites/${siteId}/drives`);
  const drive = drives.value.find(d => d.name === ZAPP_CONFIG.attachmentsLibrary);
  if (!drive) throw new Error(`Dokumentbibliothek "${ZAPP_CONFIG.attachmentsLibrary}" wurde auf der Site nicht gefunden.`);
  _anlagenDriveId = drive.id;
  return _anlagenDriveId;
}

async function uploadAnlage(vorgangsNr, file) {
  const driveId = await getAnlagenDriveId();
  // Ordner anlegen (Konflikt = existiert schon, ignorieren)
  await graphFetch(`/drives/${driveId}/root/children`, {
    method: "POST",
    body: JSON.stringify({ name: vorgangsNr, folder: {}, "@microsoft.graph.conflictBehavior": "fail" })
  }).catch(() => {});
  const token = await getToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(vorgangsNr)}/${encodeURIComponent(file.name)}:/content`,
    { method: "PUT", headers: { "Authorization": "Bearer " + token }, body: await file.arrayBuffer() }
  );
  if (!res.ok) throw new Error(`Upload von "${file.name}" fehlgeschlagen (${res.status}).`);
}

// ---------------------------------------------------------------------------
// Benutzer & Mail
// ---------------------------------------------------------------------------

async function getMe() {
  return graphFetch("/me?$select=displayName,mail,userPrincipalName");
}

// Führungskraft eines Benutzers; null, wenn keine hinterlegt oder kein Recht.
async function getManager(userMail) {
  try {
    const m = await graphFetch(`/users/${encodeURIComponent(userMail)}/manager?$select=displayName,mail,userPrincipalName`);
    return m && (m.mail || m.userPrincipalName) ? m : null;
  } catch (e) {
    return null;
  }
}

async function sendMail(to, subject, htmlBody) {
  await graphFetch("/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: htmlBody },
        toRecipients: [{ emailAddress: { address: to } }]
      },
      saveToSentItems: true
    })
  });
}
