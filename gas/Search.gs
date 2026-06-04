/**
 * 検索ロジック: Sheets 読み取り + range/in/contains フィルタ（AND結合）。
 * 仕様は integration-gas-node.md §3 / schemas/search-filter.schema.json に準拠。
 * 検索タブは「事例検索シート」(SEARCH_COLUMN_MAP) を対象にする。
 */

/** 複数値セルを区切り文字で split → trim → 空要素除去。 */
function splitMulti_(value) {
  if (value === null || value === undefined) return [];
  return String(value)
    .split(MULTI_VALUE_SPLIT)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}

/** セルから数値を拾って区間 [lo, hi] に正規化（"1, 5"→{lo:1,hi:5} / "5"→{lo:5,hi:5} / 数値無し→null）。 */
function parseInterval_(cell) {
  if (cell === '' || cell === null || cell === undefined) return null;
  var nums = String(cell).match(/-?\d+(?:\.\d+)?/g);
  if (!nums || !nums.length) return null;
  var vals = nums.map(Number);
  return { lo: Math.min.apply(null, vals), hi: Math.max.apply(null, vals) };
}

/**
 * 任意のシートを columnMap で論理キー付きの行オブジェクト配列にする。
 * numericKeys は Number 化、multiKeys は split して配列化、rangeKeys は区間 {lo,hi} 化。
 * 返り値: { rows, headerIndex } rows[i] = { _row, <logicalKey>: value, ... }
 */
function readRows_(sheet, columnMap, numericKeys, multiKeys, rangeKeys) {
  numericKeys = numericKeys || [];
  multiKeys = multiKeys || [];
  rangeKeys = rangeKeys || [];
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return { rows: [], headerIndex: {} };

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var headerIndex = {};
  headers.forEach(function (h, i) { headerIndex[h] = i; });

  var keyIndex = {};
  Object.keys(columnMap).forEach(function (key) {
    var header = columnMap[key];
    keyIndex[key] = (header in headerIndex) ? headerIndex[header] : -1;
  });

  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var raw = values[r];
    var allEmpty = raw.every(function (c) { return c === '' || c === null; });
    if (allEmpty) continue;

    var obj = { _row: r + 1 };
    Object.keys(keyIndex).forEach(function (key) {
      var idx = keyIndex[key];
      var cell = idx >= 0 ? raw[idx] : '';
      if (rangeKeys.indexOf(key) >= 0) {
        obj[key] = parseInterval_(cell);
      } else if (numericKeys.indexOf(key) >= 0) {
        var n = Number(cell);
        obj[key] = (cell === '' || isNaN(n)) ? null : n;
      } else if (multiKeys.indexOf(key) >= 0) {
        obj[key] = splitMulti_(cell);
      } else {
        obj[key] = cell === null ? '' : String(cell);
      }
    });
    rows.push(obj);
  }
  return { rows: rows, headerIndex: headerIndex };
}

/**
 * range: 行の値を区間 [lo,hi] とみなし、検索条件 [min,max] と“重なれば”一致。
 * 行値は {lo,hi}（幅を持つ列）でも 単一数値（[n,n] とみなす）でも可。min/max は省略可。
 */
function matchRange_(value, cond) {
  var iv = null;
  if (value && typeof value === 'object' && value.lo !== undefined) iv = value;
  else if (typeof value === 'number' && !isNaN(value)) iv = { lo: value, hi: value };
  if (!iv) return false;
  if (cond.min !== undefined && cond.min !== null && cond.min !== '' && iv.hi < Number(cond.min)) return false;
  if (cond.max !== undefined && cond.max !== null && cond.max !== '' && iv.lo > Number(cond.max)) return false;
  return true;
}

/** in: 行の値（配列 or 単一）が、指定 values のいずれかに一致すれば true。 */
function matchIn_(value, cond) {
  var wanted = cond.values || [];
  if (wanted.length === 0) return true;
  var have = Array.isArray(value) ? value : (value === '' || value == null ? [] : [String(value)]);
  for (var i = 0; i < have.length; i++) {
    if (wanted.indexOf(have[i]) >= 0) return true;
  }
  return false;
}

/** contains: 部分一致（大文字小文字無視）。 */
function matchContains_(value, cond) {
  var needle = (cond.value || '').toString().trim();
  if (needle === '') return true;
  var hay = Array.isArray(value) ? value.join(' ') : String(value == null ? '' : value);
  return hay.toLowerCase().indexOf(needle.toLowerCase()) >= 0;
}

/** 「値が実質未指定」のフィルタは無視する（AND から外す）。 */
function isEmptyCondition_(cond) {
  if (!cond || !cond.type) return true;
  if (cond.type === 'range') {
    var hasMin = cond.min !== undefined && cond.min !== null && cond.min !== '';
    var hasMax = cond.max !== undefined && cond.max !== null && cond.max !== '';
    return !hasMin && !hasMax;
  }
  if (cond.type === 'in') return !cond.values || cond.values.length === 0;
  if (cond.type === 'contains') return !cond.value || String(cond.value).trim() === '';
  return true;
}

/** filters（{ key: {type,...} }）を AND 適用。 */
function applyFilters_(rows, filters) {
  filters = filters || {};
  var keys = Object.keys(filters).filter(function (k) { return !isEmptyCondition_(filters[k]); });
  if (keys.length === 0) return rows.slice();

  return rows.filter(function (row) {
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var cond = filters[key];
      var value = row[key];
      var ok;
      switch (cond.type) {
        case 'range':    ok = matchRange_(value, cond); break;
        case 'in':       ok = matchIn_(value, cond); break;
        case 'contains': ok = matchContains_(value, cond); break;
        default:         ok = true;
      }
      if (!ok) return false;
    }
    return true;
  });
}

/** 検索条件の軽量バリデーション（GAS には ajv が無いため最小限）。 */
function validateFilters_(filters) {
  if (filters === null || filters === undefined) return;
  if (typeof filters !== 'object' || Array.isArray(filters)) {
    throw new Error('filters はオブジェクトである必要があります。');
  }
  Object.keys(filters).forEach(function (key) {
    var c = filters[key];
    if (!c || typeof c !== 'object') throw new Error('filters.' + key + ' が不正です。');
    if (['range', 'in', 'contains'].indexOf(c.type) < 0) {
      throw new Error('filters.' + key + '.type は range/in/contains のいずれか。');
    }
    if (c.type === 'in' && c.values !== undefined && !Array.isArray(c.values)) {
      throw new Error('filters.' + key + '.values は配列。');
    }
  });
}

/** 事例検索シートを読み込む。 */
function readSearchRows_() {
  return readRows_(getSearchSheet_(), SEARCH_COLUMN_MAP, SEARCH_NUMERIC_KEYS, SEARCH_MULTI_VALUE_KEYS, SEARCH_RANGE_KEYS);
}

/**
 * 検索本体（検索タブ / doPost 共用）。filters を受けて該当行を返す。
 * 返り値: { count, rows }
 */
function searchCompanies(filters) {
  validateFilters_(filters);
  var data = readSearchRows_();
  var hit = applyFilters_(data.rows, filters);
  return { count: hit.length, rows: hit };
}

/** 検索UIの複数選択候補（ファセット）を検索シートから収集する。 */
function getFacets() {
  var data = readSearchRows_();
  var facets = {};
  SEARCH_FACET_KEYS.forEach(function (key) {
    var set = {};
    data.rows.forEach(function (row) {
      var vals = Array.isArray(row[key]) ? row[key] : splitMulti_(row[key]);
      vals.forEach(function (v) { if (v) set[v] = true; });
    });
    facets[key] = Object.keys(set).sort();
  });
  return facets;
}
