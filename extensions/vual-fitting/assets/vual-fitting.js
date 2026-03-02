(function () {
  "use strict";

  // ============================
  // Config & State
  // ============================

  var STORAGE_KEY = "vual_fitting_portrait";
  var SELECTION_KEY = "vual_fitting_selection";
  var MAX_IMAGE_DIM = 1024;
  var MAX_ITEMS = 5;

  var MODEL_SETTINGS_KEY = "vual_fitting_model";

  var state = {
    root: null,
    modal: null,
    proxyUrl: "",
    locale: "en",
    portrait: null,
    resultImage: null,
    checkedIds: {}, // productId -> true for checked items
    step: "selection", // selection | upload | preview | generating | result
    showingBefore: false,
    modelSettings: { gender: "female", height: 165 },
    dailyRemaining: null,
    dailyLimit: null,
  };

  // ============================
  // i18n
  // ============================

  var strings = {
    en: {
      title: "Virtual Try-On",
      selectionTitle: "Your Try-On Items",
      selectionEmpty:
        "No items added yet. Browse products and tap \"Try On\" to add items here.",
      selectionHint: "Select items to try on together",
      removeItem: "Remove",
      uploadTitle: "Upload Your Photo",
      uploadDesc:
        "Take or upload a full-body photo to see how these items look on you.",
      uploadDescJewelryRing:
        "Take or upload a close-up photo of your hand to see how this ring looks.",
      uploadDescJewelryNecklace:
        "Take or upload a close-up photo of your neck to see how this necklace looks.",
      uploadDescJewelryEarring:
        "Take or upload a close-up photo of your ear to see how this earring looks.",
      uploadDescJewelryBracelet:
        "Take or upload a close-up photo of your wrist to see how this bracelet looks.",
      tips: [
        "Stand facing the camera",
        "Show your full body",
        "Use a plain background",
        "Good lighting helps",
      ],
      tipsJewelry: [
        "Close-up of the body part",
        "Good lighting is essential",
        "Plain background works best",
        "Show skin clearly",
      ],
      takePhoto: "Take Photo",
      uploadPhoto: "Upload Photo",
      useSaved: "Use Saved Photo",
      deleteSaved: "Delete",
      previewTitle: "Confirm Your Photo",
      changePhoto: "Change",
      generate: "Generate Try-On",
      generating: "Creating your look...",
      generatingDesc: "This usually takes 15-30 seconds",
      resultTitle: "Your Try-On Result",
      before: "Before",
      after: "After",
      tryAnother: "Try Different Combo",
      tryAgain: "Try Again",
      addToCart: "Add All to Cart",
      addedToCart: "Added!",
      close: "Close",
      download: "Download",
      errorNoCredits:
        "Virtual try-on is currently unavailable for this store.",
      errorDailyLimit:
        "You've reached your daily try-on limit. Please try again tomorrow.",
      errorGeneral: "Something went wrong. Please try again.",
      dailyRemaining: "tries remaining today",
      poweredBy: "Powered by VUAL",
      itemCount: " items ",
      selectedCount: "selected",
      tryOnSelected: "Try On Selected",
      modelSettingsLabel: "Your Info",
      genderLabel: "Gender",
      genderFemale: "Female",
      genderMale: "Male",
      heightLabel: "Height",
      heightUnit: "cm",
    },
    ja: {
      title: "バーチャル試着",
      selectionTitle: "試着アイテム",
      selectionEmpty:
        "アイテムがまだ追加されていません。商品ページで「試着する」をタップして追加してください。",
      selectionHint: "一緒に試着したいアイテムを選んでください",
      removeItem: "削除",
      uploadTitle: "写真をアップロード",
      uploadDesc:
        "全身写真を撮影またはアップロードして、着用イメージをご確認ください。",
      uploadDescJewelryRing:
        "手のクローズアップ写真を撮影またはアップロードして、リングの着用イメージをご確認ください。",
      uploadDescJewelryNecklace:
        "首元のクローズアップ写真を撮影またはアップロードして、ネックレスの着用イメージをご確認ください。",
      uploadDescJewelryEarring:
        "耳のクローズアップ写真を撮影またはアップロードして、ピアスの着用イメージをご確認ください。",
      uploadDescJewelryBracelet:
        "手首のクローズアップ写真を撮影またはアップロードして、ブレスレットの着用イメージをご確認ください。",
      tips: [
        "正面を向いて立ってください",
        "全身が写るようにしてください",
        "シンプルな背景がベストです",
        "明るい場所で撮影してください",
      ],
      tipsJewelry: [
        "対象部位のクローズアップ",
        "明るい照明が重要です",
        "シンプルな背景がベストです",
        "肌がはっきり見えるように",
      ],
      takePhoto: "写真を撮る",
      uploadPhoto: "アップロード",
      useSaved: "保存済みの写真を使う",
      deleteSaved: "削除",
      previewTitle: "写真の確認",
      changePhoto: "変更",
      generate: "試着画像を生成",
      generating: "画像を作成中...",
      generatingDesc: "通常15〜30秒かかります",
      resultTitle: "試着結果",
      before: "ビフォー",
      after: "アフター",
      tryAnother: "別の組み合わせを試す",
      tryAgain: "もう一度試す",
      addToCart: "すべてカートに追加",
      addedToCart: "追加しました！",
      close: "閉じる",
      download: "ダウンロード",
      errorNoCredits: "バーチャル試着は現在ご利用いただけません。",
      errorDailyLimit:
        "本日の試着回数の上限に達しました。明日また試してください。",
      errorGeneral: "エラーが発生しました。もう一度お試しください。",
      dailyRemaining: "回（本日残り）",
      poweredBy: "Powered by VUAL",
      itemCount: "点 ",
      selectedCount: "選択中",
      tryOnSelected: "選択アイテムで試着",
      modelSettingsLabel: "あなたの情報",
      genderLabel: "性別",
      genderFemale: "女性",
      genderMale: "男性",
      heightLabel: "身長",
      heightUnit: "cm",
    },
  };

  function t(key) {
    var lang = state.locale.startsWith("ja") ? "ja" : "en";
    return (strings[lang] && strings[lang][key]) || strings.en[key] || key;
  }

  // ============================
  // Selection Pool (localStorage)
  // ============================

  function getSelection() {
    try {
      var data = localStorage.getItem(SELECTION_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  function saveSelection(items) {
    try {
      localStorage.setItem(SELECTION_KEY, JSON.stringify(items));
    } catch (e) {
      // quota exceeded
    }
  }

  function addToSelection(item) {
    var items = getSelection();
    for (var i = 0; i < items.length; i++) {
      if (items[i].productId === item.productId) {
        return items;
      }
    }
    items.push(item);
    saveSelection(items);
    updateBadge();
    return items;
  }

  function removeFromSelection(productId) {
    var items = getSelection().filter(function (item) {
      return item.productId !== productId;
    });
    saveSelection(items);
    // Also uncheck
    delete state.checkedIds[productId];
    updateBadge();
    return items;
  }

  function getCheckedItems() {
    var items = getSelection();
    return items.filter(function (item) {
      return state.checkedIds[item.productId];
    });
  }

  function getCheckedCount() {
    var count = 0;
    for (var key in state.checkedIds) {
      if (state.checkedIds[key]) count++;
    }
    return count;
  }

  // ============================
  // Image Utilities
  // ============================

  function resizeImage(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var w = img.width;
        var h = img.height;
        if (w <= MAX_IMAGE_DIM && h <= MAX_IMAGE_DIM) {
          resolve(dataUrl);
          return;
        }
        var scale = MAX_IMAGE_DIM / Math.max(w, h);
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = dataUrl;
    });
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ============================
  // Portrait localStorage
  // ============================

  function getSavedPortrait() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function savePortrait(dataUrl) {
    try {
      localStorage.setItem(STORAGE_KEY, dataUrl);
    } catch (e) {
      // quota exceeded
    }
  }

  function deleteSavedPortrait() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // ignore
    }
  }

  // ============================
  // Model Settings localStorage
  // ============================

  function getSavedModelSettings() {
    try {
      var data = localStorage.getItem(MODEL_SETTINGS_KEY);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  function saveModelSettings(settings) {
    try {
      localStorage.setItem(MODEL_SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      // ignore
    }
  }

  // ============================
  // Auto-detect category from product type
  // ============================

  function detectCategory(productType, fallback) {
    if (!productType) return fallback || "upper_body";
    var t = productType.toLowerCase();
    // Jewelry categories
    if (/ring|band/i.test(t)) return "jewelry_ring";
    if (/necklace|pendant|chain|choker/i.test(t)) return "jewelry_necklace";
    if (/earring|stud|hoop/i.test(t)) return "jewelry_earring";
    if (/bracelet|bangle|cuff/i.test(t)) return "jewelry_bracelet";
    // Fashion categories
    if (
      /shoe|sneaker|boot|sandal|pump|heel|loafer|slipper|footwear|mule/i.test(t)
    )
      return "footwear";
    if (/pant|trouser|jean|skirt|short|legging|bottom/i.test(t))
      return "lower_body";
    if (/dress|gown|jumpsuit|romper|one.?piece/i.test(t)) return "dresses";
    if (
      /top|shirt|blouse|jacket|coat|sweater|hoodie|cardigan|vest|tee|polo|knit|pullover/i.test(
        t
      )
    )
      return "upper_body";
    if (/bag|handbag|tote|clutch|purse|backpack/i.test(t)) return "bags";
    if (/hat|cap|scarf|glove|belt|accessori/i.test(t)) return "accessories";
    return fallback || "upper_body";
  }

  function categoryDisplayName(cat) {
    var lang = state.locale.startsWith("ja") ? "ja" : "en";
    var names = {
      en: {
        upper_body: "Tops",
        lower_body: "Bottoms",
        dresses: "Dresses",
        footwear: "Footwear",
        bags: "Bags",
        accessories: "Accessories",
        jewelry_ring: "Ring",
        jewelry_necklace: "Necklace",
        jewelry_earring: "Earring",
        jewelry_bracelet: "Bracelet",
      },
      ja: {
        upper_body: "トップス",
        lower_body: "ボトムス",
        dresses: "ワンピース",
        footwear: "シューズ",
        bags: "バッグ",
        accessories: "アクセサリー",
        jewelry_ring: "リング",
        jewelry_necklace: "ネックレス",
        jewelry_earring: "ピアス",
        jewelry_bracelet: "ブレスレット",
      },
    };
    return (names[lang] && names[lang][cat]) || cat || "";
  }

  function isJewelryCategory(cat) {
    return cat && cat.indexOf("jewelry_") === 0;
  }

  // ============================
  // Modal HTML builders
  // ============================

  function headerHTML(title) {
    return (
      '<div class="vf-header">' +
      '<h3 class="vf-header__title">' +
      escapeHTML(title) +
      "</h3>" +
      '<button class="vf-header__close" data-action="close" aria-label="' +
      t("close") +
      '">' +
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      "</button>" +
      "</div>"
    );
  }

  function selectionStepHTML() {
    var items = getSelection();
    var checkedCount = getCheckedCount();
    var itemsHTML = "";

    if (items.length === 0) {
      itemsHTML =
        '<div class="vf-selection-empty">' +
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
        '<p class="vf-selection-empty__text">' +
        escapeHTML(t("selectionEmpty")) +
        "</p>" +
        "</div>";
    } else {
      itemsHTML = '<div class="vf-selection-list">';
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var isChecked = !!state.checkedIds[item.productId];
        itemsHTML +=
          '<div class="vf-selection-item' +
          (isChecked ? " vf-selection-item--checked" : "") +
          '" data-action="toggle-item" data-product-id="' +
          escapeHTML(item.productId) +
          '">' +
          '<div class="vf-selection-item__check">' +
          '<div class="vf-checkbox' +
          (isChecked ? " vf-checkbox--checked" : "") +
          '">' +
          (isChecked
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
            : "") +
          "</div>" +
          "</div>" +
          '<div class="vf-selection-item__img-wrap">' +
          '<img src="' +
          escapeHTML(item.productImage) +
          '" alt="' +
          escapeHTML(item.productTitle) +
          '" class="vf-selection-item__img" />' +
          "</div>" +
          '<div class="vf-selection-item__info">' +
          '<span class="vf-selection-item__title">' +
          escapeHTML(item.productTitle) +
          "</span>" +
          '<span class="vf-selection-item__category">' +
          escapeHTML(categoryDisplayName(item.category)) +
          "</span>" +
          "</div>" +
          '<button class="vf-selection-item__remove" data-action="remove-item" data-product-id="' +
          escapeHTML(item.productId) +
          '" aria-label="' +
          t("removeItem") +
          '">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          "</button>" +
          "</div>";
      }
      itemsHTML += "</div>";
    }

    var hint =
      items.length > 0
        ? '<p class="vf-selection-hint">' +
          escapeHTML(t("selectionHint")) +
          "</p>"
        : "";

    // Bottom action bar with count and proceed button
    var actionBar = "";
    if (items.length > 0) {
      var countText =
        checkedCount > 0
          ? checkedCount + t("itemCount") + t("selectedCount")
          : "";
      actionBar =
        '<div class="vf-selection-actions">' +
        '<span class="vf-selection-actions__count">' +
        escapeHTML(countText) +
        "</span>" +
        '<button class="vf-btn vf-btn--primary vf-btn--large" data-action="proceed-tryon"' +
        (checkedCount === 0 ? " disabled" : "") +
        ">" +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>' +
        "<span>" +
        t("tryOnSelected") +
        "</span>" +
        "</button>" +
        "</div>";
    }

    return (
      headerHTML(t("selectionTitle")) +
      '<div class="vf-body">' +
      hint +
      itemsHTML +
      "</div>" +
      actionBar +
      footerHTML()
    );
  }

  function getJewelryMode() {
    var checked = getCheckedItems();
    if (checked.length === 0) return null;
    var cat = checked[0].category;
    return isJewelryCategory(cat) ? cat : null;
  }

  function getUploadDesc() {
    var jCat = getJewelryMode();
    if (jCat === "jewelry_ring") return t("uploadDescJewelryRing");
    if (jCat === "jewelry_necklace") return t("uploadDescJewelryNecklace");
    if (jCat === "jewelry_earring") return t("uploadDescJewelryEarring");
    if (jCat === "jewelry_bracelet") return t("uploadDescJewelryBracelet");
    return t("uploadDesc");
  }

  function uploadStepHTML() {
    var saved = getSavedPortrait();
    var jMode = getJewelryMode();
    var tipsList = jMode ? t("tipsJewelry") : t("tips");
    var tipsHTML = tipsList
      .map(function (tip) {
        return "<li>" + escapeHTML(tip) + "</li>";
      })
      .join("");

    var savedSection = saved
      ? '<div class="vf-saved">' +
        '<div class="vf-saved__preview">' +
        '<img src="' +
        saved +
        '" alt="Saved portrait" class="vf-saved__img" />' +
        "</div>" +
        '<div class="vf-saved__actions">' +
        '<button class="vf-btn vf-btn--primary" data-action="use-saved">' +
        t("useSaved") +
        "</button>" +
        '<button class="vf-btn vf-btn--text vf-btn--danger" data-action="delete-saved">' +
        t("deleteSaved") +
        "</button>" +
        "</div>" +
        "</div>" +
        '<div class="vf-divider"><span>or</span></div>'
      : "";

    // Show selected garments info
    var checked = getCheckedItems();
    var garmentInfo = "";
    if (checked.length > 0) {
      garmentInfo = '<div class="vf-selected-garments">';
      for (var i = 0; i < checked.length; i++) {
        garmentInfo +=
          '<div class="vf-selected-garment-thumb">' +
          '<img src="' +
          escapeHTML(checked[i].productImage) +
          '" alt="" class="vf-selected-garment-thumb__img" />' +
          "</div>";
      }
      garmentInfo +=
        '<span class="vf-selected-garments__count">' +
        checked.length +
        t("itemCount") +
        "</span>" +
        "</div>";
    }

    return (
      headerHTML(t("uploadTitle")) +
      '<div class="vf-body">' +
      garmentInfo +
      '<p class="vf-desc">' +
      escapeHTML(getUploadDesc()) +
      "</p>" +
      '<ul class="vf-tips">' +
      tipsHTML +
      "</ul>" +
      savedSection +
      '<div class="vf-upload-btns">' +
      '<button class="vf-btn vf-btn--outline" data-action="take-photo">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>' +
      "<span>" +
      t("takePhoto") +
      "</span>" +
      "</button>" +
      '<button class="vf-btn vf-btn--outline" data-action="upload-photo">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
      "<span>" +
      t("uploadPhoto") +
      "</span>" +
      "</button>" +
      "</div>" +
      '<input type="file" accept="image/*" class="vf-file-input" id="vf-file-camera" capture="user" />' +
      '<input type="file" accept="image/*" class="vf-file-input" id="vf-file-gallery" />' +
      "</div>" +
      footerHTML()
    );
  }

  function previewStepHTML() {
    var checked = getCheckedItems();
    var garmentInfo = "";
    if (checked.length > 0) {
      garmentInfo = '<div class="vf-selected-garments vf-selected-garments--compact">';
      for (var i = 0; i < checked.length; i++) {
        garmentInfo +=
          '<div class="vf-selected-garment-thumb">' +
          '<img src="' +
          escapeHTML(checked[i].productImage) +
          '" alt="" class="vf-selected-garment-thumb__img" />' +
          "</div>";
      }
      garmentInfo += "</div>";
    }

    var ms = state.modelSettings;
    var modelSettingsHTML =
      '<div class="vf-model-settings">' +
      '<div class="vf-model-settings__label">' +
      escapeHTML(t("modelSettingsLabel")) +
      "</div>" +
      '<div class="vf-model-settings__row">' +
      // Gender toggle
      '<div class="vf-model-settings__field">' +
      '<label class="vf-field-label">' + escapeHTML(t("genderLabel")) + "</label>" +
      '<div class="vf-gender-toggle">' +
      '<button class="vf-gender-btn' + (ms.gender === "female" ? " vf-gender-btn--active" : "") + '" data-action="set-gender" data-value="female">' +
      escapeHTML(t("genderFemale")) +
      "</button>" +
      '<button class="vf-gender-btn' + (ms.gender === "male" ? " vf-gender-btn--active" : "") + '" data-action="set-gender" data-value="male">' +
      escapeHTML(t("genderMale")) +
      "</button>" +
      "</div>" +
      "</div>" +
      // Height input
      '<div class="vf-model-settings__field">' +
      '<label class="vf-field-label">' + escapeHTML(t("heightLabel")) + "</label>" +
      '<div class="vf-height-input">' +
      '<input type="number" id="vf-height" class="vf-height-input__field" value="' + ms.height + '" min="140" max="200" step="1" />' +
      '<span class="vf-height-input__unit">' + escapeHTML(t("heightUnit")) + "</span>" +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>";

    return (
      headerHTML(t("previewTitle")) +
      '<div class="vf-body">' +
      '<div class="vf-preview">' +
      '<img src="' +
      state.portrait +
      '" alt="Your portrait" class="vf-preview__img" />' +
      "</div>" +
      modelSettingsHTML +
      garmentInfo +
      '<div class="vf-preview-actions">' +
      '<button class="vf-btn vf-btn--outline" data-action="change-photo">' +
      t("changePhoto") +
      "</button>" +
      '<button class="vf-btn vf-btn--primary vf-btn--large" data-action="generate">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>' +
      "<span>" +
      t("generate") +
      "</span>" +
      "</button>" +
      "</div>" +
      "</div>" +
      footerHTML()
    );
  }

  function generatingStepHTML() {
    var checked = getCheckedItems();
    var productImgs = "";
    for (var i = 0; i < checked.length; i++) {
      productImgs +=
        '<img src="' +
        escapeHTML(checked[i].productImage) +
        '" alt="" class="vf-generating__product-img" />';
    }

    return (
      headerHTML(t("title")) +
      '<div class="vf-body vf-body--center">' +
      '<div class="vf-generating">' +
      '<div class="vf-spinner"></div>' +
      '<p class="vf-generating__title">' +
      escapeHTML(t("generating")) +
      "</p>" +
      '<p class="vf-generating__desc">' +
      escapeHTML(t("generatingDesc")) +
      "</p>" +
      '<div class="vf-generating__products">' +
      productImgs +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function resultStepHTML() {
    var displayImage = state.showingBefore
      ? state.portrait
      : state.resultImage;

    // Daily remaining badge
    var dailyBadge = "";
    if (state.dailyRemaining !== null && state.dailyRemaining !== undefined) {
      dailyBadge =
        '<div class="vf-daily-remaining">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
        '<span>' + state.dailyRemaining + ' ' + t("dailyRemaining") + '</span>' +
        "</div>";
    }

    return (
      headerHTML(t("resultTitle")) +
      '<div class="vf-body">' +
      dailyBadge +
      '<div class="vf-result">' +
      '<img src="' +
      displayImage +
      '" alt="Try-on result" class="vf-result__img" />' +
      '<div class="vf-result__toggle">' +
      '<button class="vf-toggle-btn ' +
      (!state.showingBefore ? "vf-toggle-btn--active" : "") +
      '" data-action="show-after">' +
      t("after") +
      "</button>" +
      '<button class="vf-toggle-btn ' +
      (state.showingBefore ? "vf-toggle-btn--active" : "") +
      '" data-action="show-before">' +
      t("before") +
      "</button>" +
      "</div>" +
      "</div>" +
      '<div class="vf-result-actions">' +
      '<button class="vf-btn vf-btn--icon" data-action="download" title="' + t("download") + '">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
      "</button>" +
      '<button class="vf-btn vf-btn--outline" data-action="try-another">' +
      t("tryAnother") +
      "</button>" +
      '<button class="vf-btn vf-btn--primary vf-btn--large" data-action="add-to-cart">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>' +
      "<span>" +
      t("addToCart") +
      "</span>" +
      "</button>" +
      "</div>" +
      "</div>" +
      footerHTML()
    );
  }

  function footerHTML() {
    return (
      '<div class="vf-footer">' +
      '<span class="vf-footer__text">' +
      t("poweredBy") +
      "</span>" +
      "</div>"
    );
  }

  function escapeHTML(str) {
    if (!str) return "";
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ============================
  // Render & Event Binding
  // ============================

  function renderModal() {
    var content;
    switch (state.step) {
      case "selection":
        content = selectionStepHTML();
        break;
      case "upload":
        content = uploadStepHTML();
        break;
      case "preview":
        content = previewStepHTML();
        break;
      case "generating":
        content = generatingStepHTML();
        break;
      case "result":
        content = resultStepHTML();
        break;
    }

    state.modal.innerHTML =
      '<div class="vf-overlay" data-action="close"></div>' +
      '<div class="vf-content">' +
      content +
      "</div>";

    bindEvents();
  }

  function bindEvents() {
    var modal = state.modal;

    // Close
    modal.querySelectorAll('[data-action="close"]').forEach(function (el) {
      el.addEventListener("click", closeModal);
    });

    // Selection step — toggle item checkbox
    modal
      .querySelectorAll('[data-action="toggle-item"]')
      .forEach(function (el) {
        el.addEventListener("click", function (e) {
          if (e.target.closest('[data-action="remove-item"]')) return;
          var productId = el.dataset.productId;
          if (state.checkedIds[productId]) {
            delete state.checkedIds[productId];
          } else {
            // Limit to MAX_ITEMS
            if (getCheckedCount() >= MAX_ITEMS) return;
            state.checkedIds[productId] = true;
          }
          renderModal();
        });
      });

    // Selection step — remove item
    modal
      .querySelectorAll('[data-action="remove-item"]')
      .forEach(function (el) {
        el.addEventListener("click", function (e) {
          e.stopPropagation();
          var productId = el.dataset.productId;
          removeFromSelection(productId);
          renderModal();
        });
      });

    // Selection step — proceed to try-on
    var proceedBtn = modal.querySelector('[data-action="proceed-tryon"]');
    if (proceedBtn) {
      proceedBtn.addEventListener("click", function () {
        if (getCheckedCount() === 0) return;
        var saved = getSavedPortrait();
        if (saved) {
          state.portrait = saved;
          state.step = "preview";
        } else {
          state.step = "upload";
        }
        renderModal();
      });
    }

    // Upload step
    var cameraBtn = modal.querySelector('[data-action="take-photo"]');
    if (cameraBtn) {
      cameraBtn.addEventListener("click", function () {
        document.getElementById("vf-file-camera").click();
      });
    }

    var uploadBtn = modal.querySelector('[data-action="upload-photo"]');
    if (uploadBtn) {
      uploadBtn.addEventListener("click", function () {
        document.getElementById("vf-file-gallery").click();
      });
    }

    var cameraInput = document.getElementById("vf-file-camera");
    if (cameraInput) {
      cameraInput.addEventListener("change", handleFileSelect);
    }

    var galleryInput = document.getElementById("vf-file-gallery");
    if (galleryInput) {
      galleryInput.addEventListener("change", handleFileSelect);
    }

    var useSavedBtn = modal.querySelector('[data-action="use-saved"]');
    if (useSavedBtn) {
      useSavedBtn.addEventListener("click", function () {
        state.portrait = getSavedPortrait();
        state.step = "preview";
        renderModal();
      });
    }

    var deleteSavedBtn = modal.querySelector('[data-action="delete-saved"]');
    if (deleteSavedBtn) {
      deleteSavedBtn.addEventListener("click", function () {
        deleteSavedPortrait();
        renderModal();
      });
    }

    // Preview step
    var changeBtn = modal.querySelector('[data-action="change-photo"]');
    if (changeBtn) {
      changeBtn.addEventListener("click", function () {
        state.portrait = null;
        state.step = "upload";
        renderModal();
      });
    }

    // Model settings — gender toggle
    modal.querySelectorAll('[data-action="set-gender"]').forEach(function (el) {
      el.addEventListener("click", function () {
        state.modelSettings.gender = el.dataset.value;
        saveModelSettings(state.modelSettings);
        renderModal();
      });
    });

    // Model settings — height input
    var heightInput = document.getElementById("vf-height");
    if (heightInput) {
      heightInput.addEventListener("change", function () {
        var val = parseInt(heightInput.value, 10);
        if (val >= 140 && val <= 200) {
          state.modelSettings.height = val;
          saveModelSettings(state.modelSettings);
        }
      });
    }

    var generateBtn = modal.querySelector('[data-action="generate"]');
    if (generateBtn) {
      generateBtn.addEventListener("click", callFittingAPI);
    }

    // Result step
    var showAfterBtn = modal.querySelector('[data-action="show-after"]');
    if (showAfterBtn) {
      showAfterBtn.addEventListener("click", function () {
        state.showingBefore = false;
        renderModal();
      });
    }

    var showBeforeBtn = modal.querySelector('[data-action="show-before"]');
    if (showBeforeBtn) {
      showBeforeBtn.addEventListener("click", function () {
        state.showingBefore = true;
        renderModal();
      });
    }

    var tryAgainBtn = modal.querySelector('[data-action="try-again"]');
    if (tryAgainBtn) {
      tryAgainBtn.addEventListener("click", function () {
        state.resultImage = null;
        state.showingBefore = false;
        state.step = "preview";
        renderModal();
      });
    }

    var tryAnotherBtn = modal.querySelector('[data-action="try-another"]');
    if (tryAnotherBtn) {
      tryAnotherBtn.addEventListener("click", function () {
        state.resultImage = null;
        state.showingBefore = false;
        state.step = "selection";
        renderModal();
      });
    }

    var downloadBtn = modal.querySelector('[data-action="download"]');
    if (downloadBtn) {
      downloadBtn.addEventListener("click", downloadResult);
    }

    var addToCartBtn = modal.querySelector('[data-action="add-to-cart"]');
    if (addToCartBtn) {
      addToCartBtn.addEventListener("click", addToCart);
    }
  }

  // ============================
  // Handlers
  // ============================

  function handleFileSelect(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    fileToDataUrl(file).then(function (dataUrl) {
      resizeImage(dataUrl).then(function (resized) {
        state.portrait = resized;
        savePortrait(resized);
        state.step = "preview";
        renderModal();
      });
    });

    e.target.value = "";
  }

  function callFittingAPI() {
    var checked = getCheckedItems();
    if (checked.length === 0) return;

    state.step = "generating";
    renderModal();

    // Build arrays for multi-garment API
    var garmentImageUrls = [];
    var categories = [];
    for (var i = 0; i < checked.length; i++) {
      garmentImageUrls.push(checked[i].productImage);
      categories.push(checked[i].category || "upper_body");
    }

    fetch(state.proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personImage: state.portrait,
        garmentImageUrls: garmentImageUrls,
        categories: categories,
        modelSettings: state.modelSettings,
      }),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data.success) {
          state.resultImage = data.resultImage;
          state.showingBefore = false;
          state.dailyRemaining = data.dailyRemaining;
          state.dailyLimit = data.dailyLimit;
          state.step = "result";
        } else {
          state.step = "preview";
          var msg;
          if (data.error === "NO_CREDITS") {
            msg = t("errorNoCredits");
          } else if (data.error === "DAILY_LIMIT_REACHED") {
            msg = t("errorDailyLimit");
          } else {
            msg = t("errorGeneral");
          }
          showError(msg);
        }
        renderModal();
      })
      .catch(function () {
        state.step = "preview";
        renderModal();
        showError(t("errorGeneral"));
      });
  }

  function downloadResult() {
    if (!state.resultImage) return;
    var link = document.createElement("a");
    link.href = state.resultImage;
    link.download = "vual-tryon-" + Date.now() + ".png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function addToCart() {
    var checked = getCheckedItems();
    if (checked.length === 0) return;

    var btn = state.modal.querySelector('[data-action="add-to-cart"]');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>' +
        "<span>" +
        t("addedToCart") +
        "</span>";
    }

    // Add all checked items to cart
    var cartItems = [];
    for (var i = 0; i < checked.length; i++) {
      if (checked[i].variantId) {
        cartItems.push({
          id: parseInt(checked[i].variantId, 10),
          quantity: 1,
        });
      }
    }

    if (cartItems.length === 0) return;

    fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: cartItems }),
    })
      .then(function () {
        setTimeout(function () {
          closeModal();
        }, 1200);
      })
      .catch(function () {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML =
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>' +
            "<span>" +
            t("addToCart") +
            "</span>";
        }
      });
  }

  function showError(msg) {
    var existing = state.modal.querySelector(".vf-error-toast");
    if (existing) existing.remove();

    var toast = document.createElement("div");
    toast.className = "vf-error-toast";
    toast.textContent = msg;
    state.modal.querySelector(".vf-content").appendChild(toast);

    setTimeout(function () {
      if (toast.parentNode) toast.remove();
    }, 4000);
  }

  // ============================
  // Badge (item count on button)
  // ============================

  function updateBadge() {
    var badge = document.getElementById("vual-fitting-badge");
    if (!badge) return;
    var count = getSelection().length;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = "flex";
    } else {
      badge.style.display = "none";
    }
  }

  // ============================
  // Modal Open / Close
  // ============================

  function openModal() {
    var items = getSelection();

    if (items.length === 1) {
      // Only 1 item — auto-check it and go to upload/preview
      state.checkedIds = {};
      state.checkedIds[items[0].productId] = true;
      var saved = getSavedPortrait();
      if (saved) {
        state.portrait = saved;
        state.step = "preview";
      } else {
        state.step = "upload";
      }
    } else {
      // Multiple items — show selection with checkboxes
      // Auto-check all items if nothing was previously checked
      if (getCheckedCount() === 0) {
        state.checkedIds = {};
        for (var i = 0; i < items.length && i < MAX_ITEMS; i++) {
          state.checkedIds[items[i].productId] = true;
        }
      }
      state.step = "selection";
    }

    state.resultImage = null;
    state.showingBefore = false;
    state.modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    renderModal();
  }

  function closeModal() {
    state.modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    state.modal.innerHTML = "";
  }

  // ============================
  // Fitting Status Check
  // ============================

  function checkFittingStatus(callback) {
    var CACHE_KEY = "vual_fitting_status";
    var CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    // Check sessionStorage cache first — only cache enabled=true
    // (disabled state is never cached so re-enabling takes effect immediately)
    try {
      var cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        var parsed = JSON.parse(cached);
        if (parsed.enabled && Date.now() - parsed.ts < CACHE_TTL) {
          callback(true);
          return;
        }
        // Clear stale or disabled cache
        sessionStorage.removeItem(CACHE_KEY);
      }
    } catch (e) {}

    // Fetch status from App Proxy
    fetch(state.proxyUrl + "?check=status", { method: "GET" })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var enabled = data.enabled !== false;
        try {
          // Only cache enabled=true to allow quick re-enable
          if (enabled) {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ enabled: true, ts: Date.now() }));
          } else {
            sessionStorage.removeItem(CACHE_KEY);
          }
        } catch (e) {}
        callback(enabled);
      })
      .catch(function () {
        callback(true); // fail-open: show button on network error
      });
  }

  // ============================
  // Init
  // ============================

  function init() {
    state.root = document.getElementById("vual-fitting-root");
    if (!state.root) return;

    state.proxyUrl = state.root.dataset.proxyUrl || "/apps/vual-fitting";
    state.locale = state.root.dataset.locale || "en";
    state.modal = document.getElementById("vual-fitting-modal");

    // Restore saved model settings
    var savedModel = getSavedModelSettings();
    if (savedModel) {
      state.modelSettings = savedModel;
    }

    // Check if fitting is enabled before wiring up the button
    checkFittingStatus(function (enabled) {
      if (!enabled) {
        state.root.style.display = "none";
        return;
      }
      initButton();
    });
  }

  function initButton() {
    var manualCategory = state.root.dataset.category || "";
    var productType = state.root.dataset.productType || "";
    var currentProduct = {
      productTitle: state.root.dataset.productTitle || "",
      productImage: state.root.dataset.productImage || "",
      productId: state.root.dataset.productId || "",
      variantId: state.root.dataset.variantId || "",
      category: detectCategory(productType, manualCategory),
    };

    // Button click: add current product to selection, then open modal
    var trigger = document.getElementById("vual-fitting-trigger");
    if (trigger) {
      trigger.addEventListener("click", function () {
        addToSelection(currentProduct);
        openModal();
      });
    }

    // Close on Escape key
    document.addEventListener("keydown", function (e) {
      if (
        e.key === "Escape" &&
        state.modal.getAttribute("aria-hidden") === "false"
      ) {
        closeModal();
      }
    });

    updateBadge();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
