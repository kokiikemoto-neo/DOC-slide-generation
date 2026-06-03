/**
 * 検索ロジック: Sheets 読み取り + range/in/contains フィルタ（AND結合）。
 * 仕様は integration-gas-node.md §3 / schemas/search-filter.schema.json に準拠。
 */

/** 複数値セルを区切り文字で split → trim → 空要素除去。 */
function splitMulti_(value) {
  if (value === null || value === undefined) return [];
  return String(value)
    .split(MULTI_VALUE_SPLIT)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}

/**
 * companies シートを読み、論理キーで引ける行オブジェクト配列にする。
 * 返り値: { headerIndex, rows } rows[i] = { _row, companyId, name, hireCount(number), soldNeeds([]), ... }
 */
function readCompanies_() {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return { rows: [], headerIndex: {} };

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });

  // ヘッダー名 → 列index
  var headerIndex = {};
  headers.forEach(function (h, i) { headerIndex[h] = i; });

  // 論理キー → 列index（COLUMN_MAP 経由。存在しない列は -1）
  var keyIndex = {};
  Object.keys(COLUMN_MAP).forEach(function (key) {
    var header = COLUMN_MAP[key];
    keyIndex[key] = (header in headerIndex) ? headerIndex[header] : -1;
  });

  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var raw = values[r];
    // 完全空行はスキップ
    var allEmpty = raw.every(function (c) { return c === '' || c === null; });
    if (allEmpty) continue;

    var obj = { _row: r + 1 }; // 1-based 行番号（書き戻し用）
    Object.keys(keyIndex).forEach(function (key) {
      var idx = keyIndex[key];
      var cell = idx >= 0 ? raw[idx] : '';
      if (NUMERIC_KEYS.indexOf(key) >= 0) {
        var n = Number(cell);
        obj[key] = (cell === '' || isNaN(n)) ? null : n;
      } else if (MULTI_VALUE_KEYS.indexOf(key) >= 0) {
        obj[key] = splitMulti_(cell);
      } else {
        obj[key] = cell === null ? '' : String(cell);
      }
    });
    rows.push(obj);
  }
  return { rows: rows, headerIndex: headerIndex };
}

/** range: min/max（どちらか省略可）。値が null の行は不一致。 */
function matchRange_(value, cond) {
  if (value === null || value === undefined || isNaN(Number(value))) return false;
  var v = Number(value);
  if (cond.min !== undefined && cond.min !== null && v < cond.min) return false;
  if (cond.max !== undefined && cond.max !== null && v > cond.max) return false;
  return true;
}

/** in: 行の値（配列 or 単一）が、指定 values のいずれかに一致すれば true。 */
function matchIn_(value, cond) {
  var wanted = cond.values || [];
  if (wanted.length === 0) return true; // 値未指定は無視
  var have = Array.isArray(value) ? value : (value === '' || value == null ? [] : [String(value)]);
  for (var i = 0; i < have.length; i++) {
    if (wanted.indexOf(have[i]) >= 0) return true;
  }
  return false;
}

/** contains: 部分一致（大文字小文字無視）。 */
function matchContains_(value, cond) {
  var needle = (cond.value || '').toString().trim();
  if (needle === '') return true; // 値未指定は無視
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
  var keys = Object.keys(filters).filter(function (k) {
    return !isEmptyCondition_(filters[k]);
  });
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
        default:         ok = true; // 未知typeは無視（通す）
      }
      if (!ok) return false; // AND
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

/**
 * 検索本体: filters を受けて該当行を返す（UI/doPost 共用）。
 * 返り値: { count, rows }
 */
function searchCompanies(filters) {
  validateFilters_(filters);
  var data = readCompanies_();
  var hit = applyFilters_(data.rows, filters);
  return { count: hit.length, rows: hit };
}

/** UI の複数選択候補（ファセット）を全行から収集する。 */
function getFacets() {
  var data = readCompanies_();
  var facets = {};
  FACET_KEYS.forEach(function (key) {
    var set = {};
    data.rows.forEach(function (row) {
      var vals = Array.isArray(row[key]) ? row[key] : splitMulti_(row[key]);
      vals.forEach(function (v) { if (v) set[v] = true; });
    });
    facets[key] = Object.keys(set).sort();
  });
  return facets;
}
