/**
 * Web アプリのエントリ: doGet(UI) / doPost(JSON API)。
 * 生成タブ: フォーム入力 → 生成シートへ保存(upsert) → Node /render → 検索シートへURL書き戻し。
 * 検索タブ: 事例検索シートをフィルタ表示（Search.gs）。
 */

/** UI を返す。 */
function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('SlideGen 事例ツール')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** index.html から取り込む用。 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** 生成フォームの項目定義を UI へ渡す。 */
function getGenFields() {
  return GEN_FIELDS;
}

/** 管理No.プルダウン用: 事例検索シートの {id, name, docUrl} 一覧（id 昇順）。 */
function getCaseOptions() {
  var data = readSearchRows_();
  return data.rows
    .map(function (r) { return { id: String(r.id || ''), name: String(r.name || ''), docUrl: String(r.docUrl || '') }; })
    .filter(function (o) { return o.id !== ''; })
    .sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
}

/** 検索シートから ID 一致の行を返す（無ければ null）。 */
function findSearchRowById_(caseId) {
  caseId = String(caseId || '').trim();
  if (!caseId) return null;
  var rows = readSearchRows_().rows;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id).trim() === caseId) return rows[i];
  }
  return null;
}

// ============================================================
// 画像アップロード（フォームのファイル選択 → Drive 公開URL化）
// ============================================================
/** アップロード先フォルダ。UPLOAD_FOLDER_ID プロパティがあればそこ、無ければマイドライブ直下。 */
function getUploadFolder_() {
  var id = getProp_('UPLOAD_FOLDER_ID', '');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* 落ちたら root */ }
  }
  return DriveApp.getRootFolder();
}

/**
 * UI から data URL（base64）を受け取り Drive に保存、リンク共有(閲覧)にして公開URLを返す。
 * 返り値: { ok, url, fileId } / { ok:false, error }
 */
function uploadImageToDrive(dataUrl, filename) {
  var m = /^data:([^;]+);base64,(.*)$/.exec(String(dataUrl || ''));
  if (!m) return { ok: false, error: '画像データ形式が不正です。' };
  try {
    var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], filename || 'slidegen-upload');
    var file = getUploadFolder_().createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var id = file.getId();
    // Slides/Node が取得できる公開URL（Node 側 drive.ts と同形式）
    return { ok: true, url: 'https://drive.google.com/uc?export=view&id=' + id, fileId: id };
  } catch (e) {
    return { ok: false, error: 'Drive へのアップロードに失敗しました: ' + ((e && e.message) || e) };
  }
}

/**
 * JSON API（外部/プログラム利用）。UI は google.script.run を使う。
 * body: { action:'search', filters }
 *     | { action:'generate', content|row, caseId }
 *     | { action:'saveAndGenerate', form }
 */
function doPost(e) {
  var out = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);
  try {
    var body = (e && e.postData && e.postData.contents) ? JSON.parse(e.postData.contents) : {};
    var action = body.action || 'search';
    if (action === 'search') {
      out.setContent(JSON.stringify(searchCompanies(body.filters || {})));
    } else if (action === 'generate') {
      out.setContent(JSON.stringify(generateSlide(body)));
    } else if (action === 'saveAndGenerate') {
      out.setContent(JSON.stringify(saveAndGenerate(body.form || {})));
    } else {
      out.setContent(JSON.stringify({ ok: false, error: 'unknown action: ' + action }));
    }
  } catch (err) {
    out.setContent(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
  }
  return out;
}

// ============================================================
// content マッピング
// ============================================================

/** 生成フォーム（GEN_FIELDS のキー）→ スライド content(7+2スロット)。 */
function buildContentFromForm_(form) {
  form = form || {};
  return {
    logo:    String(form.logoUrl   || ''),
    tagline: String(form.tagline   || form.name || ''),
    qr:      String(form.qrUrl     || ''),
    frame1:  String(form.image1Url || ''),
    head1:   String(form.head1     || ''),
    body1:   String(form.body1     || ''),
    frame2:  String(form.image2Url || ''),
    head2:   String(form.head2     || ''),
    body2:   String(form.body2     || '')
  };
}

/** 生成シートの行オブジェクト（GEN_COLUMN_MAP キー）→ content。 */
function buildContentFromRow_(row) {
  return buildContentFromForm_(row || {});
}

/** content の画像スロット（必須・非空）を事前チェック。 */
function missingImageSlots_(content) {
  return ['logo', 'qr', 'frame1', 'frame2'].filter(function (k) {
    return !content[k] || String(content[k]).trim() === '';
  });
}

// ============================================================
// Node /render 呼び出し（共通）
// qrText を渡すと Node 側が QR を生成して content.qr に差し込む（DOC_URL → QR）。
// ============================================================
function callNodeRender_(content, qrText) {
  // qrText がある場合 qr は Node が生成するのでチェック対象外
  var slots = qrText ? ['logo', 'frame1', 'frame2'] : ['logo', 'qr', 'frame1', 'frame2'];
  var missing = slots.filter(function (k) { return !content[k] || String(content[k]).trim() === ''; });
  if (missing.length) {
    return { ok: false, error: '画像が未設定です（' + missing.join(', ') + '）。' };
  }
  var url = getProp_('NODE_RENDER_URL', '');
  var apiKey = getProp_('RENDER_API_KEY', '');
  if (!url || !apiKey) {
    return { ok: false, error: 'NODE_RENDER_URL / RENDER_API_KEY が未設定です（スクリプトプロパティを確認）。' };
  }
  var payload = { templateId: 'coming-soon-v1', content: content };
  if (qrText) payload.qrText = String(qrText);
  var resp;
  try {
    resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Api-Key': apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      followRedirects: true
    });
  } catch (e) {
    return { ok: false, error: 'Node への接続に失敗しました: ' + ((e && e.message) || e) };
  }
  var code = resp.getResponseCode();
  var text = resp.getContentText();
  var data;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  if (code < 200 || code >= 300 || !data || data.ok !== true) {
    return { ok: false, error: (data && data.error) ? data.error : ('HTTP ' + code + ': ' + text.slice(0, 300)) };
  }
  return { ok: true, presentationUrl: data.presentationUrl };
}

// ============================================================
// 生成シートへの保存（upsert by 管理No.）
// ============================================================
function upsertGenRow_(form) {
  var sheet = getGenSheet_();
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var hIndex = {};
  headers.forEach(function (h, i) { hIndex[h] = i; });

  // GEN_COLUMN_MAP のヘッダーが無ければ末尾に追加
  Object.keys(GEN_COLUMN_MAP).forEach(function (key) {
    var h = GEN_COLUMN_MAP[key];
    if (!(h in hIndex)) {
      lastCol += 1;
      sheet.getRange(1, lastCol).setValue(h);
      hIndex[h] = lastCol - 1;
    }
  });

  // 管理No. で既存行を探す（無ければ追記）
  var caseIdCol0 = hIndex[GEN_COLUMN_MAP.caseId];
  var caseIdVal = String(form.caseId || '').trim();
  var targetRow = -1;
  var n = sheet.getLastRow();
  if (caseIdVal && n >= 2) {
    var ids = sheet.getRange(2, caseIdCol0 + 1, n - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === caseIdVal) { targetRow = i + 2; break; }
    }
  }
  if (targetRow < 0) targetRow = sheet.getLastRow() + 1;

  // フォーム値を該当行へ書き込み（フォームが真実 = 全項目を反映）
  Object.keys(GEN_COLUMN_MAP).forEach(function (key) {
    var col = hIndex[GEN_COLUMN_MAP[key]] + 1;
    var val = form[key];
    sheet.getRange(targetRow, col).setValue(val === undefined || val === null ? '' : val);
  });
  return targetRow;
}

// ============================================================
// 検索シートへの URL 書き戻し（管理No. == ID で突合）
// ============================================================
function writebackSearchUrl_(caseId, url) {
  caseId = String(caseId || '').trim();
  if (!caseId) return { wrote: false, note: '管理No.が空のため書き戻しスキップ' };

  var sheet = getSearchSheet_();
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var idHeader = SEARCH_COLUMN_MAP[MATCH_SEARCH_KEY]; // 'ID'
  var wbHeader = writebackHeader_();                  // '営業資料URL'

  var idCol0 = headers.indexOf(idHeader);
  if (idCol0 < 0) return { wrote: false, note: '検索シートに "' + idHeader + '" 列がありません' };

  var wbCol0 = headers.indexOf(wbHeader);
  if (wbCol0 < 0) { wbCol0 = lastCol; sheet.getRange(1, wbCol0 + 1).setValue(wbHeader); } // 末尾に作成

  var n = sheet.getLastRow();
  if (n < 2) return { wrote: false, note: '検索シートにデータ行がありません' };

  var ids = sheet.getRange(2, idCol0 + 1, n - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === caseId) {
      sheet.getRange(i + 2, wbCol0 + 1).setValue(url);
      return { wrote: true, note: '検索シート ' + (i + 2) + '行目「' + wbHeader + '」へ書き込み', row: i + 2 };
    }
  }
  return { wrote: false, note: '検索シートに ID="' + caseId + '" の行が見つかりません' };
}

// ============================================================
// 生成タブ: 保存 → 生成 → 書き戻し（UI から google.script.run で呼ぶ）
// ============================================================
function saveAndGenerate(form) {
  form = form || {};

  // 0) 検索シートの該当行を参照（企業名の自動補完・QR元のDOC_URL取得）
  var searchRow = findSearchRowById_(form.caseId);
  if (!form.name && searchRow) form.name = searchRow.name;
  var docUrl = searchRow ? String(searchRow.docUrl || '') : '';
  // 生成シートの「QRコード添付」列には QR の元になった DOC_URL を記録
  form.qrUrl = docUrl;

  // 1) 生成シートへ保存（upsert）
  var savedRow;
  try {
    savedRow = upsertGenRow_(form);
  } catch (e) {
    return { ok: false, error: '生成シートへの保存に失敗しました: ' + ((e && e.message) || e) };
  }

  // 2) QR の元 URL チェック
  if (!docUrl) {
    return { ok: false, error: '管理No.="' + (form.caseId || '') + '" の DOC_URL が検索シートに見つかりません（QRを生成できません）。', savedRow: savedRow };
  }

  // 3) Node でスライド生成（QR は docUrl から Node が生成）
  var content = buildContentFromForm_(form);
  var gen = callNodeRender_(content, docUrl);
  if (!gen.ok) return { ok: false, error: gen.error, savedRow: savedRow };

  // 4) 検索シートへ URL 書き戻し（管理No. == ID）
  var wb = writebackSearchUrl_(form.caseId, gen.presentationUrl);

  return { ok: true, presentationUrl: gen.presentationUrl, savedRow: savedRow, writeback: wb, qrSource: docUrl };
}

/**
 * 既存行 or content から直接生成（doPost / 一覧運用向け）。
 * payload: { content:{...} } | { row:{...GEN_COLUMN_MAP キー...} }, 任意 caseId。
 */
function generateSlide(payload) {
  payload = payload || {};
  var content = payload.content || (payload.row ? buildContentFromRow_(payload.row) : null);
  if (!content) return { ok: false, error: 'row も content も渡されていません。' };

  var gen = callNodeRender_(content);
  if (!gen.ok) return gen;

  var caseId = payload.caseId || (payload.row && payload.row.caseId) || '';
  var wb = caseId ? writebackSearchUrl_(caseId, gen.presentationUrl) : { wrote: false, note: 'caseId 無し' };
  return { ok: true, presentationUrl: gen.presentationUrl, writeback: wb };
}
