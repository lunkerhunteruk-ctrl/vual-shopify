export type Locale = "en" | "ja";

export function detectLocale(request: Request): Locale {
  const url = new URL(request.url);
  const param = url.searchParams.get("locale") || "";
  return param.startsWith("ja") ? "ja" : "en";
}

type TranslationMap = Record<string, string>;

const en: TranslationMap = {
  // Page
  "page.title": "Look Creation",
  "page.subtitle": "Generate professional model photography",
  // Products
  "products.select": "Select Products",
  "products.search_placeholder": "Search products...",
  "products.all": "All",
  "products.brand": "Brand:",
  // Selected panel
  "selected.title": "Selected",
  // Model selection
  "model.select": "Select Model",
  "model.female": "Female",
  "model.male": "Male",
  "model.ethnicity": "Ethnicity",
  "model.click_to_select": "Click to select a model",
  "model.selected_label": "Model selected",
  "model.none_available": "No models available for this selection. AI will generate a model based on settings below.",
  // Model Settings
  "model_settings.title": "Model Settings",
  "model_settings.height": "Height",
  "model_settings.pose": "Pose",
  // Poses
  "pose.standing": "Standing",
  "pose.walking": "Walking",
  "pose.sitting": "Sitting",
  "pose.dynamic": "Dynamic",
  "pose.leaning": "Leaning",
  "pose.custom": "Custom (use prompt)",
  // Styling
  "styling.title": "Styling",
  "styling.tops_hem": "Tops Hem",
  "styling.outer_layer": "Outer Layer",
  "styling.auto": "Auto",
  "styling.tuck_in": "Tucked In",
  "styling.tuck_out": "Untucked",
  "styling.french_tuck": "French Tuck",
  "styling.open": "Open",
  "styling.closed": "Closed",
  // Scene Settings
  "scene.title": "Scene Settings",
  "scene.background": "Background",
  "scene.aspect_ratio": "Aspect Ratio",
  "scene.custom_prompt": "Custom prompt (optional)",
  "scene.custom_prompt_placeholder": "e.g., casual street style, holding a coffee cup",
  // Backgrounds
  "bg.studioWhite": "Studio White",
  "bg.studioGray": "Studio Gray",
  "bg.outdoorUrban": "Outdoor Urban",
  "bg.outdoorNature": "Outdoor Nature",
  "bg.cafeIndoor": "Cafe Indoor",
  "bg.beachResort": "Beach Resort",
  "bg.custom": "Custom (use prompt)",
  "bg.marble": "Marble Surface",
  "bg.velvet": "Velvet Dark",
  "bg.natural": "Natural Linen",
  // Aspect ratios
  "ar.portrait": "3:4 (Portrait)",
  "ar.square": "1:1 (Square)",
  "ar.landscape": "4:3 (Landscape)",
  "ar.hero": "16:9 (Hero Banner)",
  "ar.story": "9:16 (Story)",
  // Filters
  "filter.none": "Original",
  "filter.natural": "Natural",
  "filter.film": "Film",
  "filter.chrome": "Chrome",
  "filter.polaroid": "Polaroid",
  "filter.polaroidDusk": "Polaroid Dusk",
  "filter.polaroidBlue": "Polaroid Blue",
  // Generation steps
  "step.garments": "Selecting your garments",
  "step.outfit": "Combining the outfit",
  "step.scene": "Building the scene",
  "step.model": "Positioning the model",
  "step.lighting": "Setting the lighting",
  "step.final": "Developing the final look",
  // Modal
  "modal.creating": "Creating Look...",
  "modal.generated": "Generated Look",
  "modal.download": "Download",
  "modal.discard": "Discard",
  "modal.open_admin": "Open →",
  "modal.draft_saved": "Draft collection created — publish from Products › Collections",
  // Misc
  "load_more": "Load more products",
  "create_look": "Create Look",
  "upgrade_plan": "Upgrade Plan",
  // Toasts
  "toast.generated": "Image generated successfully!",
  "toast.generated_overage": "Image generated successfully! (overage)",
  "toast.saved": "Image saved to product!",
  "toast.discarded": "Draft collection discarded.",
};

const ja: TranslationMap = {
  // Page
  "page.title": "ルック生成",
  "page.subtitle": "プロのモデル写真を生成",
  // Products
  "products.select": "商品を選択",
  "products.search_placeholder": "商品を検索...",
  "products.all": "すべて",
  "products.brand": "ブランド：",
  // Selected panel
  "selected.title": "選択済み",
  // Model selection
  "model.select": "モデルを選択",
  "model.female": "女性",
  "model.male": "男性",
  "model.ethnicity": "エスニシティ",
  "model.click_to_select": "クリックしてモデルを選択",
  "model.selected_label": "モデル選択済み",
  "model.none_available": "このセレクションで利用可能なモデルはありません。以下の設定をもとにAIがモデルを生成します。",
  // Model Settings
  "model_settings.title": "モデル設定",
  "model_settings.height": "身長",
  "model_settings.pose": "ポーズ",
  // Poses
  "pose.standing": "スタンディング",
  "pose.walking": "ウォーキング",
  "pose.sitting": "シッティング",
  "pose.dynamic": "ダイナミック",
  "pose.leaning": "リーニング",
  "pose.custom": "カスタム（プロンプト使用）",
  // Styling
  "styling.title": "スタイリング",
  "styling.tops_hem": "トップスの裾",
  "styling.outer_layer": "アウター",
  "styling.auto": "自動",
  "styling.tuck_in": "タックイン",
  "styling.tuck_out": "アンタック",
  "styling.french_tuck": "フレンチタック",
  "styling.open": "オープン",
  "styling.closed": "クローズド",
  // Scene Settings
  "scene.title": "シーン設定",
  "scene.background": "背景",
  "scene.aspect_ratio": "アスペクト比",
  "scene.custom_prompt": "カスタムプロンプト（任意）",
  "scene.custom_prompt_placeholder": "例：カジュアルなストリートスタイル、コーヒーカップを持つ",
  // Backgrounds
  "bg.studioWhite": "スタジオホワイト",
  "bg.studioGray": "スタジオグレー",
  "bg.outdoorUrban": "アウトドア・アーバン",
  "bg.outdoorNature": "アウトドア・ナチュラル",
  "bg.cafeIndoor": "カフェ・インドア",
  "bg.beachResort": "ビーチリゾート",
  "bg.custom": "カスタム（プロンプト使用）",
  "bg.marble": "マーブルサーフェス",
  "bg.velvet": "ベルベットダーク",
  "bg.natural": "ナチュラルリネン",
  // Aspect ratios
  "ar.portrait": "3:4（ポートレート）",
  "ar.square": "1:1（スクエア）",
  "ar.landscape": "4:3（ランドスケープ）",
  "ar.hero": "16:9（ヒーローバナー）",
  "ar.story": "9:16（ストーリー）",
  // Filters
  "filter.none": "オリジナル",
  "filter.natural": "ナチュラル",
  "filter.film": "フィルム",
  "filter.chrome": "クローム",
  "filter.polaroid": "ポラロイド",
  "filter.polaroidDusk": "ポラロイド・ダスク",
  "filter.polaroidBlue": "ポラロイド・ブルー",
  // Generation steps
  "step.garments": "ガーメントを選択中",
  "step.outfit": "コーディネートを組み合わせ中",
  "step.scene": "シーンを構築中",
  "step.model": "モデルをポジショニング中",
  "step.lighting": "ライティングを調整中",
  "step.final": "最終ルックを現像中",
  // Modal
  "modal.creating": "ルックを生成中...",
  "modal.generated": "生成されたルック",
  "modal.download": "ダウンロード",
  "modal.discard": "削除",
  "modal.open_admin": "開く →",
  "modal.draft_saved": "ドラフトコレクション作成済み — Products › Collections から公開できます",
  // Misc
  "load_more": "もっと読み込む",
  "create_look": "ルックを生成",
  "upgrade_plan": "プランをアップグレード",
  // Toasts
  "toast.generated": "画像が生成されました！",
  "toast.generated_overage": "画像が生成されました！（超過分）",
  "toast.saved": "商品に画像を保存しました！",
  "toast.discarded": "ドラフトコレクションを削除しました。",
};

const translations: Record<Locale, TranslationMap> = { en, ja };

/** Return the translated string, falling back to English then the key itself. */
export function t(key: string, locale: Locale): string {
  return translations[locale]?.[key] ?? translations.en[key] ?? key;
}
