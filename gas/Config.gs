/**
 * 設定: 列名マップ・区切り文字・Script Properties 読み取り。
 * 実シートに合わせて COLUMN_MAP を編集してください（既定は integration-gas-node.md §2 の例）。
 * 機密（NODE_RENDER_URL / RENDER_API_KEY）はコードに書かず Script Properties から読みます。
 */

/** 論理キー → スプレッドシートのヘッダー名。実シートのヘッダーに合わせて調整する。 */
var COLUMN_MAP = {
  companyId: '企業ID',
  name:      '企業名',
  hireCount: '採用人数',
  soldNeeds: '売れたニーズ',
  industry:  '業種',
  logoUrl:   'ロゴURL',
  qrUrl:     'QR URL',
  image1Url: '画像1 URL',
  image2Url: '画像2 URL',
  body1:     '本文1',
  body2:     '本文2',
  tagline:   'ひとこと'
};

/** 数値として解釈する論理キー（range フィルタ対象）。 */
var NUMERIC_KEYS = ['hireCount'];

/** 複数値セルとして split する論理キー（in フィルタでタグ判定）。 */
var MULTI_VALUE_KEYS = ['soldNeeds', 'industry'];

/** 複数値セルの区切り: カンマ既定。全角カンマ・読点・セミコロン(半/全角)・改行もフォールバック許容。 */
var MULTI_VALUE_SPLIT = /[,、，;；\n\r]+/;

/** UI のファセット（複数選択候補）を出す論理キー。 */
var FACET_KEYS = ['soldNeeds', 'industry'];

function _props() {
  return PropertiesService.getScriptProperties();
}

function getProp_(name, fallback) {
  var v = _props().getProperty(name);
  return (v === null || v === undefined || v === '') ? (fallback === undefined ? '' : fallback) : v;
}

/** 検索対象スプレッドシート。SPREADSHEET_ID プロパティ優先、無ければアクティブ（コンテナバインド時）。 */
function getSpreadsheet_() {
  var id = getProp_('SPREADSHEET_ID', '');
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('SPREADSHEET_ID が未設定です。スクリプトプロパティに対象スプレッドシートのIDを設定してください。');
}

/** companies シート。SHEET_NAME プロパティ（既定 "companies"）。 */
function getSheet_() {
  var ss = getSpreadsheet_();
  var name = getProp_('SHEET_NAME', 'companies');
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error('シート "' + name + '" が見つかりません。SHEET_NAME を確認してください。');
  }
  return sheet;
}

/** エディタから手動実行: 1行目のヘッダーをログに出して実列名を確認する。 */
function inspectHeaders() {
  var sheet = getSheet_();
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log('ヘッダー(%s列): %s', headers.length, JSON.stringify(headers));
  return headers;
}
