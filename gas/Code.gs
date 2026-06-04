/**
 * Web アプリのエントリ: doGet(UI) / doPost(JSON API)。
 * 生成タブ: フォーム入力 → 生成シートへ保存(upsert) → GAS でスライド生成 → 検索シートへURL上書き。
 * 検索タブ: 事例検索シートをフィルタ表示（Search.gs）。
 */

/**
 * 【最初に1回だけエディタで実行】SlidesApp/DriveApp の権限(presentations/drive)を承認させる。
 * テスト用スライドを1枚作ってすぐゴミ箱へ捨てるだけ。承認画面が出たら許可してください。
 */
function grantPermissions() {
  var p = SlidesApp.create('slidegen-permission-test');
  DriveApp.getFileById(p.getId()).setTrashed(true);
  Logger.log('OK: presentations / drive スコープを承認しました（テスト用スライドはゴミ箱へ）。');
  return 'OK';
}

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
function writebackSearchUrl_(caseId, url, trashOld) {
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
      var cell = sheet.getRange(i + 2, wbCol0 + 1);
      if (trashOld) {
        var prev = String(cell.getValue() || '');
        if (prev && prev !== url) trashSlideByUrl_(prev); // 旧スライドをゴミ箱へ（上書き）
      }
      cell.setValue(url);
      return { wrote: true, note: '検索シート ' + (i + 2) + '行目「' + wbHeader + '」へ書き込み（上書き）', row: i + 2 };
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

  // 1) レンダリング用 content（画像は base64 dataURL のまま）
  var content = buildContentFromForm_(form);

  // 2) 生成シートへ保存（upsert）。dataURL は巨大なのでセルにはファイル名/マーカーを書く。
  var names = form._imageNames || {};
  var sheetForm = {};
  Object.keys(GEN_COLUMN_MAP).forEach(function (k) { sheetForm[k] = form[k]; });
  ['logoUrl', 'image1Url', 'image2Url'].forEach(function (k) {
    var v = String(sheetForm[k] || '');
    if (v.indexOf('data:') === 0) sheetForm[k] = names[k] || '(アップロード画像)';
  });
  sheetForm.name = form.name;
  sheetForm.qrUrl = docUrl; // QR の元になった DOC_URL を記録
  var savedRow;
  try {
    savedRow = upsertGenRow_(sheetForm);
  } catch (e) {
    return { ok: false, error: '生成シートへの保存に失敗しました: ' + ((e && e.message) || e) };
  }

  // 3) QR の元 URL チェック
  if (!docUrl) {
    return { ok: false, error: '管理No.="' + (form.caseId || '') + '" の DOC_URL が検索シートに見つかりません（QRを生成できません）。', savedRow: savedRow };
  }

  // 4) GAS でスライド生成（毎回新規作成）。dims はブラウザが送る元画像寸法。
  var dims = form._imageDims || {};
  var gen = renderSlide(content, docUrl, {
    logo: dims.logoUrl, frame1: dims.image1Url, frame2: dims.image2Url
  });
  if (!gen.ok) return { ok: false, error: gen.error, savedRow: savedRow };

  // 5) 検索シートへ URL 書き戻し（管理No. == ID）。旧スライドはゴミ箱へ＝上書き。
  var wb = writebackSearchUrl_(form.caseId, gen.url, true);

  return { ok: true, presentationUrl: gen.url, savedRow: savedRow, writeback: wb, qrSource: docUrl, shareNote: gen.shareNote || '' };
}

/**
 * content から直接生成（doPost / プログラム利用向け）。
 * payload: { content:{...画像はdataURL...}, caseId, dims }。
 */
function generateSlide(payload) {
  payload = payload || {};
  var content = payload.content || (payload.row ? buildContentFromRow_(payload.row) : null);
  if (!content) return { ok: false, error: 'content が渡されていません。' };

  var caseId = payload.caseId || (payload.row && payload.row.caseId) || '';
  var searchRow = findSearchRowById_(caseId);
  var docUrl = searchRow ? String(searchRow.docUrl || '') : '';

  var gen = renderSlide(content, docUrl, payload.dims || {});
  if (!gen.ok) return gen;

  var wb = caseId ? writebackSearchUrl_(caseId, gen.url, true) : { wrote: false, note: 'caseId 無し' };
  return { ok: true, presentationUrl: gen.url, writeback: wb };
}
