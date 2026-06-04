/**
 * GAS だけでスライドを生成する（サーバ/GCP 不要）。SlidesApp で背景・画像・テキストを配置。
 * 座標は 960x540pt 基準の固定レイアウト。実ページサイズに合わせて等比スケールする。
 * ※ 透視変換(傾き)は未対応。frame1/frame2 はフレーム内に contain 配置（傾きは後日追加可）。
 */

// 固定レイアウト（Node 版 stylespec-coming-soon-v1 と同じ座標）
var LAYOUT = {
  page: { w: 960, h: 540 },
  typography: {
    tagline: { family: 'Noto Sans JP', sizePt: 20, color: '#1E1D56', bold: true,  align: 'CENTER' },
    head:    { family: 'Noto Sans JP', sizePt: 16, color: '#1E1D56', bold: true,  align: 'START'  },
    body:    { family: 'Noto Sans JP', sizePt: 14, color: '#1E1D56', bold: false, align: 'START'  }
  },
  images: [
    { key: 'logo',   rect: { x: 16,  y: 15,  w: 314, h: 98 },  fit: 'contain' },
    { key: 'qr',     rect: { x: 840, y: 14,  w: 99,  h: 99 },  fit: 'contain' },
    { key: 'frame1', rect: { x: 46,  y: 124, w: 301, h: 211 }, fit: 'fill' },
    { key: 'frame2', rect: { x: 578, y: 313, w: 301, h: 211 }, fit: 'fill' }
  ],
  texts: [
    { key: 'tagline', rect: { x: 350, y: 15,  w: 474, h: 98 },  style: 'tagline', valign: 'MIDDLE' },
    { key: 'head1',   rect: { x: 422, y: 147, w: 496, h: 28 },  style: 'head',    valign: 'MIDDLE' },
    { key: 'body1',   rect: { x: 390, y: 185, w: 528, h: 123 }, style: 'body',    valign: 'TOP'    },
    { key: 'head2',   rect: { x: 69,  y: 329, w: 458, h: 28 },  style: 'head',    valign: 'MIDDLE' },
    { key: 'body2',   rect: { x: 37,  y: 367, w: 490, h: 126 }, style: 'body',    valign: 'TOP'    }
  ]
};

// ---------- 補助 ----------
function backgroundBlob_() {
  var id = getProp_('BACKGROUND_FILE_ID', '');
  if (id) { try { return DriveApp.getFileById(id).getBlob(); } catch (e) { /* fallback */ } }
  return Utilities.newBlob(Utilities.base64Decode(BACKGROUND_PNG_BASE64), 'image/png', 'background.png');
}

function dataUrlToBlob_(dataUrl, name) {
  var m = /^data:([^;]+);base64,(.*)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  return Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name || 'image');
}

/** URL(DOC_URL) → QR画像 Blob。既定は外部QRサービス。QR_API_TEMPLATE で差し替え可。 */
function qrBlob_(text) {
  var tmpl = getProp_('QR_API_TEMPLATE', 'https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=8&data={data}');
  var url = tmpl.replace('{data}', encodeURIComponent(text));
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('QR生成に失敗 (HTTP ' + resp.getResponseCode() + ')');
  return resp.getBlob().setName('qr.png');
}

/** contain: アスペクト比を保って rect 内に収め中央寄せ（pt）。iw/ih は元画像px。 */
function containRect_(rect, iw, ih) {
  if (!iw || !ih || iw <= 0 || ih <= 0) return rect;
  var ir = iw / ih, br = rect.w / rect.h, w, h;
  if (ir > br) { w = rect.w; h = rect.w / ir; } else { h = rect.h; w = rect.h * ir; }
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w: w, h: h };
}

// ---------- テキスト収まり（フォント段階縮小・近似） ----------
function widthEm_(s) {
  var w = 0;
  for (var i = 0; i < s.length; i++) {
    var cp = s.charCodeAt(i);
    w += (cp >= 0x20 && cp <= 0x2e7f) ? 0.5 : 1.0; // 半角=0.5em / 全角=1em
  }
  return w;
}
function textFits_(text, rect, sizePt) {
  var maxEm = rect.w / sizePt;
  if (maxEm <= 0) return false;
  var lines = 0;
  text.split('\n').forEach(function (p) {
    if (p.length === 0) { lines += 1; return; }
    lines += Math.max(1, Math.ceil(widthEm_(p) / maxEm));
  });
  return lines * sizePt * 1.35 <= rect.h;
}
function fitFontPt_(text, rect, baseSizePt) {
  if (!text || text.replace(/\s/g, '') === '') return baseSizePt;
  var min = 9, size = baseSizePt;
  while (size > min) { if (textFits_(text, rect, size)) return size; size -= 1; }
  return min;
}

// ---------- 本体 ----------
/**
 * content(7+2スロット, 画像は dataURL) と docUrl(QR元) からスライドを作成して URL を返す。
 * dims: { logo:{w,h}, frame1:{w,h}, frame2:{w,h} }（ブラウザが送る元画像寸法。contain 計算用）
 * 返り値: { ok, url } / { ok:false, error }
 */
function renderSlide(content, docUrl, dims) {
  dims = dims || {};
  try {
    var pres = SlidesApp.create('SlideGen ' + (content.tagline || content.head1 || '').slice(0, 40));
    var slide = pres.getSlides()[0];

    // 背景（スライド全面）
    try { slide.getBackground().setPictureFill(backgroundBlob_()); } catch (e) { /* 背景失敗は続行 */ }

    var W = pres.getPageWidth(), H = pres.getPageHeight();
    var sx = W / LAYOUT.page.w, sy = H / LAYOUT.page.h;
    var sc = function (r) { return { x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy }; };

    // 画像（logo/qr/frame1/frame2）
    LAYOUT.images.forEach(function (im) {
      var blob, iw, ih;
      if (im.key === 'qr') {
        if (!docUrl) return;
        blob = qrBlob_(docUrl); iw = 600; ih = 600;
      } else {
        var v = content[im.key];
        if (!v) return;
        blob = dataUrlToBlob_(v, im.key);
        if (!blob) return; // dataURL でない場合は今回スキップ（URL直貼りは GAS 単体では未対応）
        var d = dims[im.key] || {};
        iw = d.w || 0; ih = d.h || 0;
      }
      // fill = フレーム枠いっぱい（rectそのまま）/ contain = 余白を残して収める
      var place = (im.fit === 'fill') ? sc(im.rect) : sc(containRect_(im.rect, iw, ih));
      slide.insertImage(blob, place.x, place.y, place.w, place.h);
    });

    // テキスト（tagline/head1/body1/head2/body2）
    LAYOUT.texts.forEach(function (t) {
      var val = String(content[t.key] || '');
      if (val.trim() === '') return;
      var ty = LAYOUT.typography[t.style];
      var fitPt = fitFontPt_(val, t.rect, ty.sizePt); // 960空間で算出
      var r = sc(t.rect);
      var box = slide.insertTextBox(val, r.x, r.y, r.w, r.h);
      var tr = box.getText();
      tr.getTextStyle()
        .setFontFamily(ty.family)
        .setForegroundColor(ty.color)
        .setBold(!!ty.bold)
        .setFontSize(fitPt * sx); // 実ページに合わせてスケール
      try { tr.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment[ty.align]); } catch (e) {}
      try { box.setContentAlignment(SlidesApp.ContentAlignment[t.valign]); } catch (e) {}
    });

    pres.saveAndClose();
    var shareNote = shareSlide_(pres.getId());
    return { ok: true, url: pres.getUrl(), shareNote: shareNote };
  } catch (e) {
    return { ok: false, error: 'スライド生成に失敗: ' + ((e && e.message) || e) };
  }
}

/**
 * 生成スライドの共有設定。既定は「社内ドメイン(リンクを知っていれば編集可)」。
 * Script Property:
 *  - SHARE_MODE: 'domain_edit'(既定) | 'anyone_edit' | 'none'
 *  - SHARE_EDITORS: 追加で編集権限を付ける宛先（メール/グループ、カンマ区切り）
 * 返り値: 失敗時の注記（成功時は ''）。
 */
function shareSlide_(fileId) {
  var notes = [];
  var file;
  try { file = DriveApp.getFileById(fileId); } catch (e) { return '共有設定をスキップ（ファイル取得不可）'; }
  var msg = function (e) { return (e && e.message) || e; };

  var mode = getProp_('SHARE_MODE', 'domain_edit');
  if (mode !== 'none') {
    var linkAccess = (mode === 'anyone_edit') ? DriveApp.Access.ANYONE_WITH_LINK : DriveApp.Access.DOMAIN_WITH_LINK;
    var ok = false;
    // 1) リンク共有で編集付与 → 実際に EDIT が付いたか読み取って確認
    try {
      file.setSharing(linkAccess, DriveApp.Permission.EDIT);
      ok = (String(file.getSharingPermission()) === 'EDIT');
      if (!ok) notes.push('リンク共有が組織設定で「' + file.getSharingPermission() + '」に制限され編集付与不可');
    } catch (e) {
      notes.push('リンク共有失敗(' + msg(e) + ')');
    }
    // 2) ダメなら「ドメイン内で検索可＋編集」を試す（リンク共有制限の回避）
    if (!ok && mode === 'domain_edit') {
      try {
        file.setSharing(DriveApp.Access.DOMAIN, DriveApp.Permission.EDIT);
        if (String(file.getSharingPermission()) === 'EDIT') { ok = true; notes = []; }
      } catch (e) { notes.push('ドメイン共有失敗(' + msg(e) + ')'); }
    }
  }

  // 3) 追加の編集者（メール/グループ）。リンク共有が制限されていてもここは通ることが多い。
  var editors = getProp_('SHARE_EDITORS', '');
  if (editors) {
    var list = editors.split(/[,\s]+/).filter(function (s) { return s; });
    try {
      if (list.length) { file.addEditors(list); notes.push('編集者追加: ' + list.join(',')); }
    } catch (e) { notes.push('編集者追加失敗(' + msg(e) + ')'); }
  }
  return notes.join(' / ');
}

/** URL から Slides のファイルIDを抜き出してゴミ箱へ（上書き時の旧スライド掃除・best-effort）。 */
function trashSlideByUrl_(url) {
  var m = /\/d\/([a-zA-Z0-9_-]+)/.exec(String(url || ''));
  if (!m) return;
  try { DriveApp.getFileById(m[1]).setTrashed(true); } catch (e) { /* ignore */ }
}
