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
 * 選択企業をスライド生成（Node /render へ中継）。Step 11 で実装。
 * payload: { row: {...readCompanies_ の行...} } もしくは { content: {7slots} }
 */
function generateSlide(payload) {
  throw new Error('generateSlide は Step 11 で実装されます。');
}
