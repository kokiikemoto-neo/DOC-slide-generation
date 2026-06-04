/**
 * 設定: 2シート構成（事例生成シート／事例検索シート）の列名マップ・区切り文字・
 * Script Properties 読み取り。実シートに合わせて GEN_COLUMN_MAP / SEARCH_COLUMN_MAP を編集してください。
 * 設定値（シート名/QRエンドポイント等）はコードに書かず Script Properties から読みます。
 */

// ============================================================
// 事例生成シート（生成タブの入力フォームの保存先 / 1行=1事例）
// 各列 → スライドスロット: logoUrl→logo / tagline→tagline / qrUrl→qr /
//   image1Url→frame1 / head1→①見出し / body1→①本文 /
//   image2Url→frame2 / head2→②見出し / body2→②本文。caseId/name は識別・代替用。
// ============================================================
var GEN_COLUMN_MAP = {
  caseId:    '管理No.',
  name:      '企業名',
  logoUrl:   '企業ロゴ',
  tagline:   '活用背景一言',
  qrUrl:     'QRコード添付',
  image1Url: '画像①',
  head1:     '画像①のタイトル',
  body1:     '画像①の詳細',
  image2Url: '画像②',
  head2:     '画像②のタイトル',
  body2:     '画像②の詳細'
};

/**
 * 生成フォームの入力項目（表示順）。type は UI のための目安。
 * caseId は検索シートID一覧からの選択(select)、name は選択に応じて自動記入。
 * QR は「検索シートの DOC_URL から自動生成」のためフォーム項目から除外（手入力させない）。
 */
var GEN_FIELDS = [
  { key: 'caseId',    label: '管理No.（検索シートから選択）', type: 'select' },
  { key: 'name',      label: '企業名（自動記入・編集可）',     type: 'text' },
  { key: 'logoUrl',   label: '企業ロゴ',           type: 'image' },
  { key: 'tagline',   label: '活用背景一言',       type: 'text' },
  { key: 'image1Url', label: '画像①',            type: 'image' },
  { key: 'head1',     label: '画像①のタイトル',    type: 'text' },
  { key: 'body1',     label: '画像①の詳細',        type: 'textarea' },
  { key: 'image2Url', label: '画像②',            type: 'image' },
  { key: 'head2',     label: '画像②のタイトル',    type: 'text' },
  { key: 'body2',     label: '画像②の詳細',        type: 'textarea' }
];

// ============================================================
// 事例検索シート（検索タブ / 生成URLの書き戻し先 / 1行=1事例）
// ============================================================
var SEARCH_COLUMN_MAP = {
  id:          'ID',
  name:        '企業名',
  industry:    '業種',
  hireCount:   '採用人数(新卒)',
  empScale:    '従業員規模',
  hq:          '本社所在地',
  region:      '地域',
  media:       '掲載媒体',
  challenge:   '採用課題',
  docUrl:      'DOC_URL',
  salesDocUrl: '営業資料URL',
  lpUrl:       'LPURL'
};

/** 検索シートで単一数値として解釈する論理キー（今は無し）。 */
var SEARCH_NUMERIC_KEYS = [];

/**
 * 「min, max」形式で“幅”を表す列（例: 採用人数(新卒)/従業員規模 のセルが "1, 5" = 1〜5人）。
 * セルから数値を拾って区間 [lo, hi] に正規化し、range フィルタは“区間の重なり”で判定する。
 */
var SEARCH_RANGE_KEYS = ['hireCount', 'empScale'];

/** 検索シートで複数値セルとして split する論理キー（in フィルタでタグ判定）。 */
var SEARCH_MULTI_VALUE_KEYS = ['industry', 'region', 'media', 'challenge'];

/** 検索UIのファセット（複数選択候補）を出す論理キー。 */
var SEARCH_FACET_KEYS = ['industry', 'region', 'challenge'];

/** 突合キー: 生成シートの caseId(管理No.) ＝ 検索シートの id(ID)。 */
var MATCH_GEN_KEY = 'caseId';
var MATCH_SEARCH_KEY = 'id';

/** 生成スライドの保存先フォルダID（既定）。Script Property SHARE_FOLDER_ID で上書き可。
 *  このフォルダをチームに「編集者」で共有しておくと、中の生成スライドも全員が編集可になる。 */
var DEFAULT_SHARE_FOLDER_ID = '1-G6ZHbifIlrkEdq_Fuys1cPL4_eWw0rJ';

/** 複数値セルの区切り: カンマ既定。全角カンマ・読点・セミコロン(半/全角)・改行もフォールバック許容。 */
var MULTI_VALUE_SPLIT = /[,、，;；\n\r]+/;

// ============================================================
// Script Properties
// ============================================================
function _props() {
  return PropertiesService.getScriptProperties();
}

function getProp_(name, fallback) {
  var v = _props().getProperty(name);
  return (v === null || v === undefined || v === '') ? (fallback === undefined ? '' : fallback) : v;
}

/** 生成シート名（既定 "事例生成シート"）。 */
function genSheetName_() { return getProp_('GEN_SHEET_NAME', '事例生成シート'); }
/** 検索シート名（既定 "事例検索シート"）。 */
function searchSheetName_() { return getProp_('SEARCH_SHEET_NAME', '事例検索シート'); }
/** 生成URLの書き戻し先ヘッダー（既定 "営業資料URL"）。列移動しても名前で引くので追従。 */
function writebackHeader_() { return getProp_('WRITEBACK_HEADER', '営業資料URL'); }

/** フォルダURL/共有リンクを貼られても ID を取り出す（/folders/<id> もしくは ID そのもの）。 */
function normalizeFolderId_(raw) {
  if (!raw) return '';
  var s = String(raw).trim();
  var m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  s = s.split('?')[0].split('#')[0];
  var m2 = s.match(/[a-zA-Z0-9_-]{20,}/);
  return m2 ? m2[0] : s;
}

/** SPREADSHEET_ID に URL を貼られても ID を抽出する（/d/<id>/ もしくは ID そのもの）。 */
function normalizeSpreadsheetId_(raw) {
  if (!raw) return '';
  var s = String(raw).trim();
  var m = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  var m2 = s.match(/[a-zA-Z0-9_-]{30,}/);
  return m2 ? m2[0] : s;
}

/** 対象スプレッドシート。SPREADSHEET_ID プロパティ優先、無ければアクティブ（コンテナバインド時）。 */
function getSpreadsheet_() {
  var id = normalizeSpreadsheetId_(getProp_('SPREADSHEET_ID', ''));
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('SPREADSHEET_ID が未設定です。スクリプトプロパティに対象スプレッドシートのIDを設定してください。');
}

/** 名前でシート取得。無ければ実在シート一覧付きで例外。 */
function getSheetByName_(name) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    var names = ss.getSheets().map(function (s) { return s.getName(); });
    throw new Error('シート "' + name + '" が見つかりません。実在するシート: [' + names.join(', ') + ']。');
  }
  return sheet;
}

function getGenSheet_() { return getSheetByName_(genSheetName_()); }
function getSearchSheet_() { return getSheetByName_(searchSheetName_()); }

// ============================================================
// 調査用ヘルパ（エディタから手動実行）
// ============================================================
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

/** 全タブの先頭数行を列ごとにダンプ（タブ名・列構成の確認用）。 */
function inspectRows() {
  var ss = getSpreadsheet_();
  var sheets = ss.getSheets();
  Logger.log('スプレッドシート: "%s"  タブ数=%s', ss.getName(), sheets.length);
  sheets.forEach(function (s) { _dumpSheet_(s, 6); });
}
