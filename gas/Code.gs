/**
 * Web アプリのエントリ: doGet(UI) / doPost(JSON API)。
 * 検索は Search.gs、Node 中継は generateSlide()（Step 11 で実装）。
 */

/** UI を返す。 */
function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('SlideGen 企業検索')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** index.html から <?!= include('partial') ?> で部分テンプレを取り込む用。 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * JSON API。外部/プログラムからの利用向け（UI は google.script.run を使う）。
 * body: { action: 'search', filters: {...} } | { action: 'generate', content|row: {...} }
 * action 省略時は search 扱い（search-filter.schema.json 準拠の { filters } を直接受ける）。
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
    } else {
      out.setContent(JSON.stringify({ ok: false, error: 'unknown action: ' + action }));
    }
  } catch (err) {
    out.setContent(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
  }
  return out;
}

/**
 * Sheets の1行 → Node /render が期待する content(7スロット) へマッピング。
 * 対応は integration-gas-node.md §2「用途」列 / §4 の契約に準拠。
 */
function buildContentFromRow_(row) {
  return {
    logo:    String(row.logoUrl   || ''),
    tagline: String(row.tagline   || row.name || ''),
    qr:      String(row.qrUrl     || ''),
    frame1:  String(row.image1Url || ''),
    body1:   String(row.body1     || ''),
    frame2:  String(row.image2Url || ''),
    body2:   String(row.body2     || '')
  };
}

/** content の画像スロット（必須・非空）を事前チェックして分かりやすいエラーにする。 */
function missingImageSlots_(content) {
  return ['logo', 'qr', 'frame1', 'frame2'].filter(function (k) {
    return !content[k] || String(content[k]).trim() === '';
  });
}

/** ヘッダー名から1-based列番号を返す（無ければ -1）。 */
function columnIndexByHeader_(sheet, header) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === header) return i + 1;
  }
  return -1;
}

/** 任意: 生成URLを Sheets の該当行へ書き戻す（URL_WRITEBACK_HEADER 設定時のみ）。 */
function writebackUrl_(row, url) {
  var header = getProp_('URL_WRITEBACK_HEADER', '');
  if (!header || !row || !row._row) return false;
  try {
    var sheet = getSheet_();
    var col = columnIndexByHeader_(sheet, header);
    if (col < 0) return false; // 列が無ければ静かにスキップ
    sheet.getRange(row._row, col).setValue(url);
    return true;
  } catch (e) {
    // 書き戻し失敗は生成自体を妨げない
    return false;
  }
}

/**
 * 選択企業をスライド生成（Node /render へ中継）。
 * payload: { row: {...readCompanies_ の行...} } もしくは { content: {7slots} }
 * 返り値: { ok, presentationUrl, wroteBack } / { ok:false, error }
 */
function generateSlide(payload) {
  payload = payload || {};
  var row = payload.row || null;
  var content = payload.content || (row ? buildContentFromRow_(row) : null);
  if (!content) {
    return { ok: false, error: 'row も content も渡されていません。' };
  }

  var missing = missingImageSlots_(content);
  if (missing.length) {
    return { ok: false, error: '画像URLが未設定の行です（' + missing.join(', ') + '）。Sheets の該当列を確認してください。' };
  }

  var url = getProp_('NODE_RENDER_URL', '');
  var apiKey = getProp_('RENDER_API_KEY', '');
  if (!url || !apiKey) {
    return { ok: false, error: 'NODE_RENDER_URL / RENDER_API_KEY が未設定です。スクリプトプロパティを確認してください（gas/README.md）。' };
  }

  var resp;
  try {
    resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Api-Key': apiKey },
      payload: JSON.stringify({ templateId: 'coming-soon-v1', content: content }),
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
    var msg = (data && data.error) ? data.error : ('HTTP ' + code + ': ' + text.slice(0, 300));
    return { ok: false, error: msg };
  }

  var wroteBack = writebackUrl_(row, data.presentationUrl);
  return { ok: true, presentationUrl: data.presentationUrl, wroteBack: wroteBack };
}
