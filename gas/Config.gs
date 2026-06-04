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

/** SPREADSHEET_ID に URL を貼られても ID を抽出する（/d/<id>/ もしくは ID そのもの）。 */
function normalizeSpreadsheetId_(raw) {
  if (!raw) return '';
  var s = String(raw).trim();
  var m = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // 余計なクエリ等が付いていても ID 部分だけ拾う
  var m2 = s.match(/[a-zA-Z0-9_-]{30,}/);
  return m2 ? m2[0] : s;
}

/** 検索対象スプレッドシート。SPREADSHEET_ID プロパティ優先、無ければアクティブ（コンテナバインド時）。 */
function getSpreadsheet_() {
  var id = normalizeSpreadsheetId_(getProp_('SPREADSHEET_ID', ''));
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
    var names = ss.getSheets().map(function (s) { return s.getName(); });
    throw new Error('シート "' + name + '" が見つかりません。実在するシート: [' + names.join(', ') +
      ']。SHEET_NAME を実シート名に設定するか Config.gs の既定を変更してください。');
  }
  return sheet;
}

/**
 * エディタから手動実行: スプレッドシート内の全シート名と、対象シートの1行目ヘッダーをログ出力。
 * SHEET_NAME が未一致でも、先頭シートにフォールバックしてヘッダーを表示する（実列名の発見用）。
 */
function inspectHeaders() {
  var ss = getSpreadsheet_();
  var allNames = ss.getSheets().map(function (s) { return s.getName(); });
  Logger.log('スプレッドシート内のシート一覧: %s', JSON.stringify(allNames));

  var wanted = getProp_('SHEET_NAME', 'companies');
  var sheet = ss.getSheetByName(wanted);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    Logger.log('SHEET_NAME="%s" は未一致。先頭シート "%s" のヘッダーを表示します。', wanted, sheet.getName());
    Logger.log('→ このシートを使うなら スクリプトプロパティ SHEET_NAME に "%s" を設定してください。', sheet.getName());
  } else {
    Logger.log('対象シート: "%s"', sheet.getName());
  }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log('ヘッダー(%s列): %s', headers.length, JSON.stringify(headers));
  return headers;
}

function _colLabel_(i) {
  var s = '';
  i = i + 1;
  while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

/** 1シートの先頭 nRows を列ごとにログ出力。 */
function _dumpSheet_(sheet, nRows) {
  Logger.log('==== シート "%s" (gid=%s)  行数=%s 列数=%s ====',
    sheet.getName(), sheet.getSheetId(), sheet.getLastRow(), sheet.getLastColumn());
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) { Logger.log('(空シート)'); return; }
  var rows = Math.min(nRows, sheet.getLastRow());
  var cols = sheet.getLastColumn();
  var values = sheet.getRange(1, 1, rows, cols).getValues();
  for (var r = 0; r < values.length; r++) {
    var parts = [];
    for (var c = 0; c < values[r].length; c++) {
      var v = values[r][c];
      parts.push(_colLabel_(c) + '=' + (v === '' || v === null ? '·' : String(v)));
    }
    Logger.log('行%s: %s', r + 1, parts.join(' | '));
  }
}

/**
 * エディタから手動実行: スプレッドシート内の【全タブ】の先頭数行を列ごとにダンプする。
 * タブ名が不明でも、これ一発で事例生成シート等の構造（ヘッダー行・各列の中身）が分かる。
 */
function inspectRows() {
  var ss = getSpreadsheet_();
  var sheets = ss.getSheets();
  Logger.log('スプレッドシート: "%s"  タブ数=%s', ss.getName(), sheets.length);
  sheets.forEach(function (s) { _dumpSheet_(s, 6); });
}
