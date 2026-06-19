import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Button,
  Select,
  RangeSlider,
  TextField,
  Thumbnail,
  ResourceList,
  ResourceItem,
  Badge,
  Banner,
  Box,
  Divider,
  Spinner,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { fetchProducts } from "../../lib/shopify/products.server";
import { generateImage } from "../../lib/ai/gemini-image.server";
import { uploadImageToProduct } from "../../lib/shopify/images.server";
import { getCreditStatus, consumeCredit } from "../../lib/billing/credit-tracker.server";
import { detectLocale } from "../lib/i18n";
import type { Locale } from "../lib/i18n";
import type { FilterId } from "../lib/photo-filters";
import { t } from "../lib/i18n";

function getFilters(locale: import("../lib/i18n").Locale): { id: FilterId; label: string }[] {
  return [
    { id: "none", label: t("filter.none", locale) },
    { id: "natural", label: t("filter.natural", locale) },
    { id: "film", label: t("filter.film", locale) },
    { id: "chrome", label: t("filter.chrome", locale) },
    { id: "polaroid", label: t("filter.polaroid", locale) },
    { id: "polaroidDusk", label: t("filter.polaroidDusk", locale) },
    { id: "polaroidBlue", label: t("filter.polaroidBlue", locale) },
  ];
}

// Model database type
interface ModelEntry {
  id: string;
  gender: string;
  ageRange: string;
  ethnicity: string;
  pose: string;
  thumbnail: string;
  fullImage: string;
}

interface JewelryModelEntry {
  id: string;
  gender: string;
  jewelryType: string;
  pose: string;
  thumbnail: string;
  fullImage: string;
}

interface ModelDatabase {
  models: ModelEntry[];
  jewelryModels?: JewelryModelEntry[];
  ethnicities: { id: string; labelEn: string; labelJa: string }[];
  jewelryTypes?: { id: string; labelEn: string; labelJa: string }[];
  jewelryPoses?: Record<string, { id: string; labelEn: string; labelJa: string }[]>;
  genders: { id: string; labelEn: string; labelJa: string }[];
  poses: { id: string; labelEn: string; labelJa: string }[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [{ products, pageInfo }, creditStatus] = await Promise.all([
    fetchProducts(admin),
    getCreditStatus(session.shop),
  ]);

  // Read model database
  let modelDatabase: ModelDatabase | null = null;
  try {
    const appUrl = process.env.SHOPIFY_APP_URL || "https://vual-studio.vercel.app";
    const res = await fetch(`${appUrl}/models/database.json`);
    modelDatabase = await res.json();
  } catch (e) {
    console.error("Failed to load model database:", e);
  }

  const locale = detectLocale(request);
  return json({ products, pageInfo, modelDatabase, creditStatus, shopDomain: session.shop, locale });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "loadMore") {
    const cursor = formData.get("cursor") as string;
    const { products, pageInfo } = await fetchProducts(admin, { cursor });
    return json({ type: "products", products, pageInfo });
  }

  if (intent === "generate") {
    // Check credits before generation
    const creditResult = await consumeCredit(session.shop, "AI look generation");
    if (!creditResult.allowed) {
      return json({
        type: "generation",
        success: false,
        images: [],
        error: "No points remaining. Please upgrade your plan.",
        creditExhausted: true,
      });
    }

    // If overage, create Shopify usage charge
    if (creditResult.isOverage && creditResult.overageAmount > 0) {
      try {
        const { getActiveSubscription, getUsageLineItemId, createUsageCharge } =
          await import("../../lib/billing/shopify-billing.server");
        const activeSub = await getActiveSubscription(admin);
        if (activeSub) {
          const usageLineItemId = getUsageLineItemId(activeSub);
          if (usageLineItemId) {
            await createUsageCharge(
              admin,
              usageLineItemId,
              creditResult.overageAmount,
              `VUAL Studio overage (3 pt)`
            );
          }
        }
      } catch (e) {
        console.error("Failed to create usage charge:", e);
      }
    }

    const garmentImageUrls = JSON.parse(
      formData.get("garmentImages") as string
    ) as string[];
    const modelSettings = JSON.parse(
      formData.get("modelSettings") as string
    ) as any;
    const background = formData.get("background") as string;
    const aspectRatio = formData.get("aspectRatio") as string;
    const customPrompt = (formData.get("customPrompt") as string) || undefined;
    const tuckStyle = (formData.get("tuckStyle") as string) || undefined;
    const outerStyle = (formData.get("outerStyle") as string) || undefined;
    const modelImagePath = (formData.get("modelImage") as string) || undefined;
    const referenceImageUrls = formData.get("referenceImages")
      ? JSON.parse(formData.get("referenceImages") as string) as string[]
      : [];
    const jewelryCategory = (formData.get("jewelryCategory") as string) || undefined;

    // Convert image URLs to base64 data URLs
    async function urlToDataUrl(url: string): Promise<string | null> {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const buffer = await res.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        const contentType = res.headers.get("content-type") || "image/jpeg";
        return `data:${contentType};base64,${base64}`;
      } catch {
        return null;
      }
    }

    // Convert garment URLs to base64 (1 per product = 1 garment slot)
    const garmentDataUrls = await Promise.all(
      garmentImageUrls.map((url) => urlToDataUrl(url))
    );
    const validGarmentImages = garmentDataUrls.filter(Boolean) as string[];

    if (validGarmentImages.length === 0) {
      return json({
        type: "generation",
        success: false,
        images: [],
        error: "Failed to fetch product images",
      });
    }

    // Convert reference images (detail shots) to base64
    const referenceDataUrls = await Promise.all(
      referenceImageUrls.map((url) => urlToDataUrl(url))
    );
    const validReferenceImages = referenceDataUrls.filter(Boolean) as string[];

    // Each product gets its own garment slot (1 product = 1 item in the look)
    const garmentImages = [validGarmentImages[0]];
    const secondGarmentImages = validGarmentImages.length > 1 ? [validGarmentImages[1]] : undefined;
    const thirdGarmentImages = validGarmentImages.length > 2 ? [validGarmentImages[2]] : undefined;
    const fourthGarmentImages = validGarmentImages.length > 3 ? [validGarmentImages[3]] : undefined;
    const fifthGarmentImages = validGarmentImages.length > 4 ? [validGarmentImages[4]] : undefined;

    // Convert model image to base64 via HTTP fetch
    let modelImage: string | undefined;
    if (modelImagePath) {
      try {
        const appUrl = process.env.SHOPIFY_APP_URL || "https://vual-studio.vercel.app";
        const imageUrl = `${appUrl}/${modelImagePath}`;
        const res = await fetch(imageUrl);
        const arrayBuffer = await res.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        const mimeType = modelImagePath.endsWith(".png") ? "image/png" : "image/jpeg";
        modelImage = `data:${mimeType};base64,${base64}`;
      } catch (e) {
        console.error("Failed to read model image:", e);
      }
    }

    // Append reference images info to custom prompt if available
    let finalPrompt = customPrompt;
    if (validReferenceImages.length > 0) {
      const refNote = "The additional reference images show detail views of the same garments (texture, pattern, back view, etc.). Use them to accurately reproduce the garment details, but do NOT add extra items.";
      finalPrompt = finalPrompt ? `${finalPrompt}. ${refNote}` : refNote;
    }

    const result = await generateImage({
      garmentImages: [...garmentImages, ...validReferenceImages],
      secondGarmentImages: jewelryCategory ? undefined : secondGarmentImages,
      thirdGarmentImages: jewelryCategory ? undefined : thirdGarmentImages,
      fourthGarmentImages: jewelryCategory ? undefined : fourthGarmentImages,
      fifthGarmentImages: jewelryCategory ? undefined : fifthGarmentImages,
      modelSettings,
      background,
      aspectRatio: jewelryCategory ? (aspectRatio || "1:1") : aspectRatio,
      customPrompt: finalPrompt,
      tuckStyle: tuckStyle as any,
      outerStyle: outerStyle as any,
      modelImage,
      jewelryCategory: jewelryCategory as any,
    });

    return json({
      type: "generation",
      ...result,
      creditsRemaining: creditResult.creditsRemaining,
      isOverage: creditResult.isOverage,
    });
  }

  if (intent === "saveToProduct") {
    const productId = formData.get("productId") as string;
    const imageBase64 = formData.get("imageBase64") as string;
    const saveModelId = (formData.get("modelId") as string) || "";
    const altText = saveModelId
      ? `VUAL Studio AI Generated | Model: ${saveModelId}`
      : "VUAL Studio AI Generated";

    const result = await uploadImageToProduct(
      admin,
      productId,
      imageBase64,
      altText
    );

    return json({ type: "save", ...result });
  }

  if (intent === "saveAllAndCollection") {
    const productIds = JSON.parse(formData.get("productIds") as string) as string[];
    const imageBase64 = formData.get("imageBase64") as string;
    const productInfoJson = formData.get("productInfo") as string;
    const shopLocale = (formData.get("shopLocale") as string) || "en";
    const modelId = (formData.get("modelId") as string) || undefined;

    // Generate AI collection title + description from product data
    const { generateCollectionCopy } = await import("../../lib/ai/gemini-copywriting.server");
    let collectionTitle = `VUAL Look ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    let descriptionHtml: string | undefined;

    if (productInfoJson) {
      try {
        const productInfo = JSON.parse(productInfoJson);
        const copy = await generateCollectionCopy(productInfo, shopLocale, imageBase64);
        collectionTitle = copy.title;
        descriptionHtml = copy.descriptionHtml;
      } catch (e) {
        console.error("AI copywriting failed, using fallback:", e);
      }
    }

    // 1. Upload image to all selected products in parallel
    const altText = modelId
      ? `VUAL Studio AI Generated | Model: ${modelId}`
      : "VUAL Studio AI Generated";
    const uploadResults = await Promise.all(
      productIds.map((pid) =>
        uploadImageToProduct(admin, pid, imageBase64, altText)
      )
    );

    const failedUploads = uploadResults.filter((r) => !r.success);
    if (failedUploads.length > 0) {
      console.error("Some uploads failed:", failedUploads);
    }

    // 2. Get a public URL for the collection image via staged upload
    // Upload the image as a standalone file first
    const STAGED_UPLOAD_MUTATION = `
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters { name value }
          }
          userErrors { field message }
        }
      }
    `;

    let collectionImageUrl: string | undefined;
    try {
      const stageRes = await admin.graphql(STAGED_UPLOAD_MUTATION, {
        variables: {
          input: [{
            resource: "COLLECTION_IMAGE",
            filename: `vual-look-${Date.now()}.png`,
            mimeType: "image/png",
            httpMethod: "PUT",
          }],
        },
      });
      const stageData = await stageRes.json();
      const target = stageData.data?.stagedUploadsCreate?.stagedTargets?.[0];

      if (target) {
        const imageBuffer = Buffer.from(imageBase64, "base64");
        const uploadRes = await fetch(target.url, {
          method: "PUT",
          headers: { "Content-Type": "image/png" },
          body: imageBuffer,
        });
        if (uploadRes.ok) {
          collectionImageUrl = target.resourceUrl;
        }
      }
    } catch (e) {
      console.error("Collection image upload failed:", e);
    }

    // 3. Create collection with all products + AI-generated copy
    const { createCollection } = await import("../../lib/shopify/collections.server");
    const collectionResult = await createCollection(
      admin,
      collectionTitle,
      productIds,
      collectionImageUrl,
      descriptionHtml,
      modelId,
    );

    // 4. Add "vual-tryon" tag to all products so the fitting button appears
    await Promise.all(
      productIds.map((pid) =>
        admin.graphql(
          `mutation tagsAdd($id: ID!, $tags: [String!]!) {
            tagsAdd(id: $id, tags: $tags) {
              userErrors { field message }
            }
          }`,
          { variables: { id: pid, tags: ["vual-tryon"] } }
        ).catch((e) => console.error(`Failed to tag ${pid}:`, e))
      )
    );

    return json({
      type: "saveAll",
      uploadCount: uploadResults.filter((r) => r.success).length,
      totalProducts: productIds.length,
      collection: collectionResult,
      generatedTitle: collectionTitle,
      generatedDescription: descriptionHtml,
    });
  }

  if (intent === "discard") {
    const collectionId = formData.get("collectionId") as string;
    const { deleteCollection } = await import("../../lib/shopify/collections.server");
    const result = await deleteCollection(admin, collectionId);
    return json({ type: "discard", ...result });
  }

  if (intent === "updateCollectionImage") {
    const collectionId = formData.get("collectionId") as string;
    const imageBase64 = formData.get("imageBase64") as string;

    if (!collectionId || !imageBase64) {
      return json({ type: "updateCollectionImage", success: false });
    }

    // Staged upload to get a public URL for the filtered image
    let imageUrl: string | undefined;
    try {
      const stageRes = await admin.graphql(`
        mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { field message }
          }
        }
      `, {
        variables: {
          input: [{
            resource: "COLLECTION_IMAGE",
            filename: `vual-look-filter-${Date.now()}.png`,
            mimeType: "image/png",
            httpMethod: "PUT",
          }],
        },
      });
      const stageData = await stageRes.json();
      const target = stageData.data?.stagedUploadsCreate?.stagedTargets?.[0];
      if (target) {
        const imageBuffer = Buffer.from(imageBase64, "base64");
        const uploadRes = await fetch(target.url, {
          method: "PUT",
          headers: { "Content-Type": "image/png" },
          body: imageBuffer,
        });
        if (uploadRes.ok) imageUrl = target.resourceUrl;
      }
    } catch (e) {
      console.error("Filter image upload failed:", e);
      return json({ type: "updateCollectionImage", success: false });
    }

    if (!imageUrl) return json({ type: "updateCollectionImage", success: false });

    const updateRes = await admin.graphql(`
      mutation collectionUpdate($input: CollectionInput!) {
        collectionUpdate(input: $input) {
          collection { id }
          userErrors { field message }
        }
      }
    `, { variables: { input: { id: collectionId, image: { src: imageUrl } } } });
    const updateData = await updateRes.json();
    const errors = updateData.data?.collectionUpdate?.userErrors || [];
    return json({ type: "updateCollectionImage", success: errors.length === 0 });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

function getPoseOptions(locale: import("../lib/i18n").Locale) {
  return [
    { label: t("pose.standing", locale), value: "standing" },
    { label: t("pose.walking", locale), value: "walking" },
    { label: t("pose.sitting", locale), value: "sitting" },
    { label: t("pose.dynamic", locale), value: "dynamic" },
    { label: t("pose.leaning", locale), value: "leaning" },
    { label: t("pose.custom", locale), value: "custom" },
  ];
}

function getGenSteps(locale: import("../lib/i18n").Locale): string[] {
  return [
    t("step.garments", locale),
    t("step.outfit", locale),
    t("step.scene", locale),
    t("step.model", locale),
    t("step.lighting", locale),
    t("step.final", locale),
  ];
}

function getBackgroundOptions(locale: import("../lib/i18n").Locale) {
  return [
    { label: t("bg.studioWhite", locale), value: "studioWhite" },
    { label: t("bg.studioGray", locale), value: "studioGray" },
    { label: t("bg.outdoorUrban", locale), value: "outdoorUrban" },
    { label: t("bg.outdoorNature", locale), value: "outdoorNature" },
    { label: t("bg.cafeIndoor", locale), value: "cafeIndoor" },
    { label: t("bg.beachResort", locale), value: "beachResort" },
    { label: t("bg.custom", locale), value: "custom" },
  ];
}

function getJewelryBackgroundOptions(locale: import("../lib/i18n").Locale) {
  return [
    { label: t("bg.studioWhite", locale), value: "studioWhite" },
    { label: t("bg.studioGray", locale), value: "studioGray" },
    { label: t("bg.marble", locale), value: "marble" },
    { label: t("bg.velvet", locale), value: "velvet" },
    { label: t("bg.natural", locale), value: "natural" },
  ];
}

function getAspectRatioOptions(locale: import("../lib/i18n").Locale) {
  return [
    { label: t("ar.portrait", locale), value: "3:4" },
    { label: t("ar.square", locale), value: "1:1" },
    { label: t("ar.landscape", locale), value: "4:3" },
    { label: t("ar.hero", locale), value: "16:9" },
    { label: t("ar.story", locale), value: "9:16" },
  ];
}

export default function StudioPage() {
  const { products: initialProducts, pageInfo: initialPageInfo, modelDatabase, creditStatus, shopDomain, locale } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  // Credit tracking (local state updated after each generation)
  const [localCredits, setLocalCredits] = useState(creditStatus);

  // Product selection
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  // Per-product image selection: { productId: [imageUrl, ...] }
  const [selectedImages, setSelectedImages] = useState<Record<string, string[]>>({});
  const [allProducts] = useState(initialProducts);
  const [pageInfo] = useState(initialPageInfo);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [vendorFilter, setVendorFilter] = useState<string>("all");

  // Exclude non-clothing product types
  const EXCLUDED_TYPES = new Set(["giftcard", "snowboard", "gift card", "gift_card"]);
  const products = useMemo(() => {
    return allProducts.filter((p) => !EXCLUDED_TYPES.has(p.productType.toLowerCase()));
  }, [allProducts]);

  // Auto-detect categories from product types
  const categories = useMemo(() => {
    const typeSet = new Set<string>();
    for (const p of products) {
      if (p.productType) typeSet.add(p.productType);
    }
    return Array.from(typeSet).sort();
  }, [products]);

  // Filter products by category first
  const categoryFilteredProducts = useMemo(() => {
    if (categoryFilter === "all") return products;
    return products.filter((p) => p.productType === categoryFilter);
  }, [products, categoryFilter]);

  // Auto-detect brands from vendors (only from category-filtered products)
  const vendors = useMemo(() => {
    const vendorSet = new Set<string>();
    for (const p of categoryFilteredProducts) {
      if (p.vendor) vendorSet.add(p.vendor);
    }
    return Array.from(vendorSet).sort();
  }, [categoryFilteredProducts]);

  // Reset vendor filter when selected vendor is no longer available
  useEffect(() => {
    if (vendorFilter !== "all" && !vendors.includes(vendorFilter)) {
      setVendorFilter("all");
    }
  }, [vendors, vendorFilter]);

  // Search query
  const [searchQuery, setSearchQuery] = useState("");

  // Filter products by category, vendor, and search query
  const filteredProducts = useMemo(() => {
    let filtered = vendorFilter === "all" ? categoryFilteredProducts : categoryFilteredProducts.filter((p) => p.vendor === vendorFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((p) =>
        p.title.toLowerCase().includes(q) ||
        (p.productType || "").toLowerCase().includes(q) ||
        (p.vendor || "").toLowerCase().includes(q)
      );
    }
    return [...filtered].sort((a, b) => {
      const typeA = (a.productType || "").toLowerCase().trim();
      const typeB = (b.productType || "").toLowerCase().trim();
      // Empty productType goes to the end
      if (!typeA && typeB) return 1;
      if (typeA && !typeB) return -1;
      if (typeA !== typeB) return typeA.localeCompare(typeB);
      return a.title.localeCompare(b.title);
    });
  }, [categoryFilteredProducts, vendorFilter, searchQuery]);

  // Model selection
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null);
  const [gender, setGender] = useState("female");
  const [ethnicity, setEthnicity] = useState("japanese");
  const [height, setHeight] = useState(175);
  const [pose, setPose] = useState("standing");

  // Jewelry mode
  const [jewelryCategory, setJewelryCategory] = useState<string | null>(null);
  const isJewelryMode = !!jewelryCategory;

  // Scene settings
  const [background, setBackground] = useState("studioWhite");
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [customPrompt, setCustomPrompt] = useState("");

  // Styling options
  const [tuckStyle, setTuckStyle] = useState("auto");
  const [outerStyle, setOuterStyle] = useState("auto");

  // Generation state
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [showResultModal, setShowResultModal] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const lastFetcherDataRef = useRef<any>(null);
  const [genStep, setGenStep] = useState(0);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [autoSaveData, setAutoSaveData] = useState<{ collectionId: string; handle: string; title: string } | null>(null);
  const [savedFilter, setSavedFilter] = useState<string>("none");
  const [updateImageStatus, setUpdateImageStatus] = useState<"idle" | "updating" | "updated">("idle");
  const selectedProductsRef = useRef<string[]>([]);
  const selectedProductDataRef = useRef<any[]>([]);
  const selectedModelIdRef = useRef<string | null>(null);

  // Review prompt state
  const [showReviewBanner, setShowReviewBanner] = useState(false);

  // Filter state
  const [selectedFilter, setSelectedFilter] = useState<FilterId>("none");
  const [filteredImages, setFilteredImages] = useState<Record<string, string>>({});
  const [filterProcessing, setFilterProcessing] = useState(false);

  const isGenerating =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "generate";
  const isSaving =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "saveToProduct";

  const selectedFilterRef = useRef<string>("none");
  // Keep refs in sync for use inside fetcher useEffect
  useEffect(() => { selectedProductsRef.current = selectedProducts; });
  useEffect(() => { selectedProductDataRef.current = selectedProductData; });
  useEffect(() => { selectedModelIdRef.current = selectedModelId; });
  useEffect(() => { selectedFilterRef.current = selectedFilter; });
  useEffect(() => { if (updateImageStatus === "updated") setUpdateImageStatus("idle"); }, [selectedFilter]);

  // Cycle through generation steps while generating
  useEffect(() => {
    if (!isGenerating) { setGenStep(0); return; }
    setGenStep(0);
    const iv = setInterval(() => {
      setGenStep((prev) => Math.min(prev + 1, getGenSteps("en").length - 1));
    }, 8000);
    return () => clearInterval(iv);
  }, [isGenerating]);

  // Filter models based on current settings
  const filteredModels = modelDatabase?.models.filter(
    (m) => m.gender === gender && m.ethnicity === ethnicity
  ) || [];

  // Available ethnicities that have models
  const availableEthnicities = modelDatabase
    ? [...new Set(modelDatabase.models.filter((m) => m.gender === gender).map((m) => m.ethnicity))]
    : [];

  const ethnicityOptions = modelDatabase?.ethnicities
    .filter((e) => availableEthnicities.includes(e.id))
    .map((e) => ({ label: e.labelEn, value: e.id })) || [];

  // Jewelry models filtered by type and gender
  const filteredJewelryModels = modelDatabase?.jewelryModels?.filter(
    (m) => m.jewelryType === jewelryCategory && m.gender === gender
  ) || [];

  // Jewelry pose options for current type
  const currentJewelryPoseOptions = useMemo(() => {
    const poses = modelDatabase?.jewelryPoses?.[jewelryCategory || "ring"] || [];
    return poses.map((p) => ({ label: p.labelEn, value: p.id }));
  }, [modelDatabase, jewelryCategory]);

  // Reset pose when switching jewelry type
  useEffect(() => {
    if (isJewelryMode && currentJewelryPoseOptions.length > 0) {
      const validPoseIds = currentJewelryPoseOptions.map((p) => p.value);
      if (!validPoseIds.includes(pose)) {
        setPose(currentJewelryPoseOptions[0].value);
      }
    }
  }, [jewelryCategory, isJewelryMode, currentJewelryPoseOptions, pose]);

  // Get selected model data (fashion or jewelry)
  const selectedModel = isJewelryMode
    ? modelDatabase?.jewelryModels?.find((m) => m.id === selectedModelId) || null
    : modelDatabase?.models.find((m) => m.id === selectedModelId) || null;

  // Handle fetcher responses
  useEffect(() => {
    const data = fetcher.data as any;
    if (!data || data === lastFetcherDataRef.current) return;
    lastFetcherDataRef.current = data;

    if (data.type === "generation") {
      if (data.success && data.images?.length > 0) {
        setGeneratedImages(data.images);
        setGenerationError(null);
        setSelectedFilter("none");
        setFilteredImages({});
        setShowResultModal(true);
        // Update local credit count
        if (data.creditsRemaining !== undefined) {
          setLocalCredits((prev) => ({
            ...prev,
            creditsRemaining: data.creditsRemaining,
            creditsUsed: prev.creditsUsed + 3,
            canGenerate: data.creditsRemaining > 0 || prev.overageUsd > 0,
          }));
        }
        shopify.toast.show(data.isOverage ? t("toast.generated_overage", locale) : t("toast.generated", locale));

        // Auto-save: submit saveAllAndCollection immediately
        const base64Match = data.images[0].match(/^data:image\/\w+;base64,(.+)$/);
        if (base64Match && selectedProductsRef.current.length > 0) {
          setAutoSaveStatus("saving");
          setAutoSaveData(null);
          const saveForm = new FormData();
          saveForm.set("intent", "saveAllAndCollection");
          saveForm.set("productIds", JSON.stringify(selectedProductsRef.current));
          saveForm.set("imageBase64", base64Match[1]);
          saveForm.set("productInfo", JSON.stringify(
            selectedProductDataRef.current.map((p: any) => ({
              title: p.title,
              description: p.description || "",
              productType: p.productType,
              vendor: p.vendor,
            }))
          ));
          if (selectedModelIdRef.current) saveForm.set("modelId", selectedModelIdRef.current);
          saveForm.set("shopLocale", locale);
          fetcher.submit(saveForm, { method: "POST" });
        }

        // Track generation count for review prompt
        try {
          const count = parseInt(localStorage.getItem("vual_gen_count") || "0", 10) + 1;
          localStorage.setItem("vual_gen_count", String(count));
          const dismissed = localStorage.getItem("vual_review_dismissed");
          if (count >= 3 && !dismissed) {
            setShowReviewBanner(true);
          }
        } catch {}

      } else if (data.error) {
        setGenerationError(data.error);
      }
    }
    if (data.type === "save" && data.success) {
      shopify.toast.show(t("toast.saved", locale));
    }
    if (data.type === "saveAll") {
      if (data.collection?.success) {
        setAutoSaveStatus("saved");
        setAutoSaveData({
          collectionId: data.collection.collectionId,
          handle: data.collection.handle,
          title: data.generatedTitle || data.collection.handle,
        });
        setSavedFilter("none");
        setUpdateImageStatus("idle");
      } else {
        setAutoSaveStatus("error");
      }
    }
    if (data.type === "discard" && data.success) {
      setAutoSaveData(null);
      setAutoSaveStatus("idle");
      setSavedFilter("none");
      setUpdateImageStatus("idle");
      shopify.toast.show(t("toast.discarded", locale));
    }
    if (data.type === "updateCollectionImage") {
      if (data.success) {
        setSavedFilter(selectedFilterRef.current);
        setUpdateImageStatus("updated");
      } else {
        setUpdateImageStatus("idle");
      }
    }
  }, [fetcher.data, shopify]);

  const selectedProductData = products.filter((p) =>
    selectedProducts.includes(p.id)
  );

  const handleGenerate = useCallback(() => {
    if (selectedProductData.length === 0) return;

    // 1 product = 1 garment slot (first selected image per product)
    // Additional images are sent as reference details
    const garmentImages: string[] = [];
    const referenceImages: string[] = [];

    for (const p of selectedProductData) {
      const imgs = selectedImages[p.id];
      if (imgs && imgs.length > 0) {
        garmentImages.push(imgs[0]); // Primary image for this product
        referenceImages.push(...imgs.slice(1)); // Extra images as reference
      } else if (p.featuredImage?.url) {
        garmentImages.push(p.featuredImage.url);
      } else if (p.images.length > 0) {
        garmentImages.push(p.images[0].url);
      }
    }

    if (garmentImages.length === 0) {
      setGenerationError("Selected products have no images");
      return;
    }

    const formData = new FormData();
    formData.set("intent", "generate");
    formData.set("garmentImages", JSON.stringify(garmentImages));
    if (referenceImages.length > 0) {
      formData.set("referenceImages", JSON.stringify(referenceImages));
    }
    formData.set(
      "modelSettings",
      JSON.stringify(isJewelryMode
        ? { gender, pose, jewelryType: jewelryCategory }
        : { gender, height, ethnicity, pose }
      )
    );
    formData.set("background", background);
    formData.set("aspectRatio", aspectRatio);
    if (customPrompt) formData.set("customPrompt", customPrompt);
    if (tuckStyle !== "auto") formData.set("tuckStyle", tuckStyle);
    if (outerStyle !== "auto") formData.set("outerStyle", outerStyle);
    if (jewelryCategory) formData.set("jewelryCategory", jewelryCategory);

    // If a model/base photo is selected, convert to data URL on server
    if (selectedModel) {
      formData.set("modelImage", (selectedModel as any).fullImage);
    }

    setGenerationError(null);
    setGeneratedImages([]);
    setAutoSaveStatus("idle");
    setAutoSaveData(null);
    setShowResultModal(true);
    fetcher.submit(formData, { method: "POST" });
  }, [
    selectedProductData,
    selectedImages,
    gender,
    height,
    ethnicity,
    pose,
    background,
    aspectRatio,
    customPrompt,
    tuckStyle,
    outerStyle,
    jewelryCategory,
    selectedModel,
    fetcher,
  ]);

  const handleSaveToProduct = useCallback(
    (imageDataUrl: string, productId: string) => {
      const base64Match = imageDataUrl.match(/^data:image\/\w+;base64,(.+)$/);
      if (!base64Match) return;

      const formData = new FormData();
      formData.set("intent", "saveToProduct");
      formData.set("productId", productId);
      formData.set("imageBase64", base64Match[1]);
      if (selectedModelId) {
        formData.set("modelId", selectedModelId);
      }
      fetcher.submit(formData, { method: "POST" });
    },
    [fetcher, selectedModelId]
  );

  const handleSaveAllAndCollection = useCallback(
    (imageDataUrl: string) => {
      const base64Match = imageDataUrl.match(/^data:image\/\w+;base64,(.+)$/);
      if (!base64Match || selectedProducts.length === 0) return;

      // Gather product info for AI copywriting
      const productInfo = selectedProductData.map((p) => ({
        title: p.title,
        description: p.description || "",
        productType: p.productType,
        vendor: p.vendor,
      }));

      const formData = new FormData();
      formData.set("intent", "saveAllAndCollection");
      formData.set("productIds", JSON.stringify(selectedProducts));
      formData.set("imageBase64", base64Match[1]);
      formData.set("productInfo", JSON.stringify(productInfo));
      if (selectedModelId) {
        formData.set("modelId", selectedModelId);
      }
      fetcher.submit(formData, { method: "POST" });
    },
    [fetcher, selectedProducts, selectedProductData]
  );

  const MAX_PRODUCTS = 5;

  const toggleProduct = useCallback((productId: string) => {
    setSelectedProducts((prev) => {
      if (prev.includes(productId)) {
        // Deselect: remove product and its image selections
        setSelectedImages((imgs) => {
          const next = { ...imgs };
          delete next[productId];
          return next;
        });
        return prev.filter((id) => id !== productId);
      } else {
        if (prev.length >= MAX_PRODUCTS) return prev;
        // Select: auto-select the first image
        const product = initialProducts.find((p: any) => p.id === productId);
        if (product) {
          const firstImg = product.featuredImage?.url || product.images[0]?.url;
          if (firstImg) {
            setSelectedImages((imgs) => ({ ...imgs, [productId]: [firstImg] }));
          }
        }
        return [...prev, productId];
      }
    });
  }, [initialProducts]);

  // Total selected images across all products
  const totalSelectedImages = Object.values(selectedImages).reduce(
    (sum, imgs) => sum + imgs.length, 0
  );
  const MAX_IMAGES = 14;

  const toggleImage = useCallback((productId: string, imageUrl: string) => {
    setSelectedImages((prev) => {
      const current = prev[productId] || [];
      if (current.includes(imageUrl)) {
        // Don't allow deselecting the last image
        if (current.length <= 1) return prev;
        return { ...prev, [productId]: current.filter((u) => u !== imageUrl) };
      }
      // Check total limit
      const total = Object.values(prev).reduce((s, imgs) => s + imgs.length, 0);
      if (total >= MAX_IMAGES) return prev;
      return { ...prev, [productId]: [...current, imageUrl] };
    });
  }, []);

  return (
    <Page
      backAction={{ url: "/app" }}
      title={t("page.title", locale)}
      subtitle={t("page.subtitle", locale)}
    >
      <BlockStack gap="500">
        <Layout>
          {/* Left: Product Selection + Generated Images */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    {t("products.select", locale)}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {filteredProducts.length} product{filteredProducts.length !== 1 ? "s" : ""}
                  </Text>
                </InlineStack>

                {/* Category filter tabs */}
                {categories.length > 0 && (
                  <InlineStack gap="200" wrap>
                    <Button
                      pressed={categoryFilter === "all"}
                      onClick={() => setCategoryFilter("all")}
                      size="slim"
                    >
                      {t("products.all", locale)}
                    </Button>
                    {categories.map((cat) => (
                      <Button
                        key={cat}
                        pressed={categoryFilter === cat}
                        onClick={() => setCategoryFilter(cat)}
                        size="slim"
                      >
                        {cat}
                      </Button>
                    ))}
                  </InlineStack>
                )}

                {/* Brand filter tabs */}
                {vendors.length > 1 && (
                  <InlineStack gap="200" wrap blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">{t("products.brand", locale)}</Text>
                    <Button
                      pressed={vendorFilter === "all"}
                      onClick={() => setVendorFilter("all")}
                      size="slim"
                    >
                      {t("products.all", locale)}
                    </Button>
                    {vendors.map((v) => (
                      <Button
                        key={v}
                        pressed={vendorFilter === v}
                        onClick={() => setVendorFilter(v)}
                        size="slim"
                      >
                        {v}
                      </Button>
                    ))}
                  </InlineStack>
                )}

                <TextField
                  label=""
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder={t("products.search_placeholder", locale)}
                  clearButton
                  onClearButtonClick={() => setSearchQuery("")}
                  autoComplete="off"
                />

                {selectedProducts.length > 0 && (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                    {selectedProducts.map((pid) => {
                      const p = products.find((pr) => pr.id === pid);
                      if (!p) return null;
                      const imgUrl = p.featuredImage?.url || p.images[0]?.url;
                      return (
                        <div
                          key={pid}
                          onClick={() => toggleProduct(pid)}
                          style={{
                            position: "relative",
                            width: "52px",
                            height: "52px",
                            borderRadius: "8px",
                            overflow: "hidden",
                            border: "2px solid #2C6ECB",
                            cursor: "pointer",
                            flexShrink: 0,
                          }}
                          title={p.title}
                        >
                          {imgUrl && (
                            <img src={imgUrl} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          )}
                          <div style={{
                            position: "absolute",
                            top: "-1px",
                            right: "-1px",
                            background: "#2C6ECB",
                            color: "#fff",
                            borderRadius: "0 0 0 6px",
                            fontSize: "9px",
                            lineHeight: 1,
                            padding: "2px 4px",
                          }}>✕</div>
                        </div>
                      );
                    })}
                    <Text as="span" variant="bodySm" tone="subdued">
                      {selectedProducts.length} selected
                    </Text>
                  </div>
                )}

                <Divider />
                <div style={{ maxHeight: "800px", overflowY: "auto" }}>
                <ResourceList
                  resourceName={{ singular: "product", plural: "products" }}
                  items={filteredProducts}
                  renderItem={(product) => {
                    const isSelected = selectedProducts.includes(product.id);
                    const imageUrl =
                      product.featuredImage?.url || product.images[0]?.url;
                    const productSelectedImages = selectedImages[product.id] || [];
                    return (
                      <ResourceItem
                        id={product.id}
                        onClick={() => toggleProduct(product.id)}
                        media={
                          <Thumbnail
                            source={imageUrl || ""}
                            alt={product.title}
                            size="medium"
                          />
                        }
                        accessibilityLabel={`Select ${product.title}`}
                      >
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <Text as="span" variant="bodyMd" fontWeight="bold">
                              {product.title}
                            </Text>
                            {product.productType && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                {product.productType}
                              </Text>
                            )}
                            <Text as="span" variant="bodySm" tone="subdued">
                              {product.images.filter((img: any) => !img.altText?.startsWith("VUAL Studio AI Generated")).length} image
                              {product.images.filter((img: any) => !img.altText?.startsWith("VUAL Studio AI Generated")).length !== 1 ? "s" : ""} |{" "}
                              {product.variants.length} variant
                              {product.variants.length !== 1 ? "s" : ""}
                            </Text>
                          </BlockStack>
                          {isSelected && <Badge tone="success">Selected</Badge>}
                        </InlineStack>
                        {/* Expanded image gallery for selected products (exclude AI-generated images) */}
                        {isSelected && product.images.filter((img) => !img.altText?.startsWith("VUAL Studio AI Generated")).length > 1 && (
                          <div
                            style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid #e1e3e5" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Text as="p" variant="bodySm" tone="subdued">
                              Select images to include ({productSelectedImages.length} selected, {MAX_IMAGES - totalSelectedImages} remaining)
                            </Text>
                            <div
                              style={{
                                display: "flex",
                                gap: "6px",
                                marginTop: "6px",
                                flexWrap: "wrap",
                              }}
                            >
                              {product.images.filter((img) => !img.altText?.startsWith("VUAL Studio AI Generated")).map((img) => {
                                const isImgSelected = productSelectedImages.includes(img.url);
                                return (
                                  <div
                                    key={img.id}
                                    onClick={() => toggleImage(product.id, img.url)}
                                    style={{
                                      cursor: "pointer",
                                      width: "56px",
                                      height: "56px",
                                      borderRadius: "6px",
                                      overflow: "hidden",
                                      border: isImgSelected
                                        ? "2px solid #2C6ECB"
                                        : "2px solid #e1e3e5",
                                      opacity: isImgSelected ? 1 : 0.5,
                                      transition: "all 0.15s ease",
                                    }}
                                  >
                                    <img
                                      src={img.url}
                                      alt={img.altText || product.title}
                                      style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "cover",
                                        display: "block",
                                      }}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </ResourceItem>
                    );
                  }}
                />
                {pageInfo.hasNextPage && (
                  <InlineStack align="center">
                    <Button
                      onClick={() => {
                        const formData = new FormData();
                        formData.set("intent", "loadMore");
                        formData.set("cursor", pageInfo.endCursor || "");
                        fetcher.submit(formData, { method: "POST" });
                      }}
                      loading={
                        fetcher.state !== "idle" &&
                        fetcher.formData?.get("intent") === "loadMore"
                      }
                    >
                      {t("load_more", locale)}
                    </Button>
                  </InlineStack>
                )}
                </div>
              </BlockStack>
            </Card>

            {/* Generated Images Modal */}
            {showResultModal && (
              <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => { if (!isGenerating) setShowResultModal(false); }} />
                <div style={{ position: "relative", background: "#fff", borderRadius: "16px", maxWidth: "720px", width: "90vw", maxHeight: "90vh", overflow: "hidden", padding: "24px", display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                    <Text as="h2" variant="headingMd">{isGenerating && generatedImages.length === 0 ? t("modal.creating", locale) : t("modal.generated", locale)}</Text>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      {generatedImages.length > 0 && (
                        <button
                          title={t("modal.download", locale)}
                          onClick={() => {
                            const src = (selectedFilter !== "none" && filteredImages[`0-${selectedFilter}`]) || generatedImages[0];
                            const ext = src.startsWith("data:image/jpeg") ? "jpg" : "png";
                            fetch(src).then(r => r.blob()).then(blob => { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `vual-studio-${Date.now()}.${ext}`; a.click(); URL.revokeObjectURL(url); });
                          }}
                          style={{ background: "none", border: "1px solid #ddd", borderRadius: "6px", cursor: "pointer", color: "#444", padding: "5px 10px", fontSize: "13px", display: "flex", alignItems: "center", gap: "5px" }}
                        >
                          <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor"><path d="M6.5 9.5L2 5h3V1h3v4h3L6.5 9.5z"/><rect x="1" y="11" width="11" height="1.5" rx="0.75"/></svg>
                          {t("modal.download", locale)}
                        </button>
                      )}
                      <button onClick={() => setShowResultModal(false)} style={{ background: "none", border: "none", fontSize: "24px", cursor: "pointer", color: "#666", padding: "4px 8px" }}>&times;</button>
                    </div>
                  </div>
                  {isGenerating && generatedImages.length === 0 && (
                    <div style={{ padding: "32px 16px 40px" }}>
                      {getGenSteps(locale).map((step, i) => {
                        const done = i < genStep;
                        const active = i === genStep;
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "20px", opacity: i > genStep ? 0.28 : 1, transition: "opacity 0.6s ease" }}>
                            <div style={{ width: "28px", height: "28px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: done ? "#16a34a" : "#e5e7eb", transition: "background 0.5s ease" }}>
                              {done ? (
                                <span style={{ color: "#fff", fontSize: "14px", lineHeight: 1 }}>✓</span>
                              ) : active ? (
                                <Spinner size="small" />
                              ) : (
                                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#9ca3af", display: "block" }} />
                              )}
                            </div>
                            <span style={{ fontSize: "15px", fontWeight: active ? 600 : 400, color: done ? "#16a34a" : active ? "#111" : "#9ca3af", transition: "color 0.5s ease, font-weight 0.3s ease" }}>
                              {step}{active ? "..." : done ? "" : ""}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {generationError && generatedImages.length === 0 && (
                    <Banner tone="critical">
                      {generationError}
                      {(fetcher.data as any)?.creditExhausted && (
                        <Box paddingBlockStart="200">
                          <Button url="/app/billing" size="slim">Upgrade Plan</Button>
                        </Box>
                      )}
                    </Banner>
                  )}
                  {showReviewBanner && generatedImages.length > 0 && (
                    <div style={{ marginBottom: "16px" }}>
                      <Banner
                        title="Enjoying VUAL Studio?"
                        tone="success"
                        onDismiss={() => {
                          setShowReviewBanner(false);
                          try { localStorage.setItem("vual_review_dismissed", "1"); } catch {}
                        }}
                        action={{
                          content: "Leave a Review ★",
                          url: "https://apps.shopify.com/vual-studio#modal-show=WriteReviewModal",
                          external: true,
                        }}
                      >
                        <p>A quick review helps other store owners discover VUAL. Thank you!</p>
                      </Banner>
                    </div>
                  )}
                  {generatedImages.length > 0 && <BlockStack gap="400">
                    {generatedImages.map((img, i) => {
                      const displayImg = (selectedFilter !== "none" && filteredImages[`${i}-${selectedFilter}`]) || img;
                      return (
                      <BlockStack gap="300" key={i}>
                        <Box borderRadius="200" borderWidth="025" borderColor="border" padding="200">
                          <img src={displayImg} alt={`Generated look ${i + 1}`} style={{ width: "100%", maxHeight: "calc(90vh - 320px)", objectFit: "contain", borderRadius: "8px", display: "block", transition: "opacity 0.3s", opacity: filterProcessing ? 0.5 : 1 }} />
                        </Box>

                        {/* Filter selection */}
                        <InlineStack gap="200" wrap>
                          {getFilters(locale).map((f) => {
                            const isActive = selectedFilter === f.id;
                            return (
                              <button
                                key={f.id}
                                disabled={filterProcessing && !isActive}
                                onClick={async () => {
                                  if (isActive) return;
                                  setSelectedFilter(f.id);
                                  if (f.id === "none") return;
                                  const cacheKey = `${i}-${f.id}`;
                                  if (filteredImages[cacheKey]) return;
                                  setFilterProcessing(true);
                                  try {
                                    const { applyFilter } = await import("../lib/photo-filters");
                                    const result = await applyFilter(img, f.id);
                                    setFilteredImages((prev) => ({ ...prev, [cacheKey]: result }));
                                  } catch (err) {
                                    console.error("Filter failed:", err);
                                  } finally {
                                    setFilterProcessing(false);
                                  }
                                }}
                                style={{
                                  padding: "6px 14px",
                                  borderRadius: "20px",
                                  border: isActive ? "2px solid #333" : "1px solid #ccc",
                                  background: isActive ? "#333" : "#fff",
                                  color: isActive ? "#fff" : "#555",
                                  fontSize: "13px",
                                  fontWeight: isActive ? 600 : 400,
                                  cursor: filterProcessing && !isActive ? "wait" : "pointer",
                                  opacity: filterProcessing && !isActive ? 0.5 : 1,
                                }}
                              >
                                {filterProcessing && isActive && f.id !== "none" && !filteredImages[`${i}-${f.id}`] ? "Applying..." : f.label}
                              </button>
                            );
                          })}
                        </InlineStack>

                        {/* Auto-save status */}
                        {autoSaveStatus === "saving" && (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", borderRadius: "8px", background: "#f5f5f5" }}>
                            <Spinner size="small" />
                            <Text as="p" variant="bodySm" tone="subdued">{locale === "ja" ? "ドラフトコレクションを保存中..." : "Saving draft collection..."}</Text>
                          </div>
                        )}
                        {autoSaveStatus === "saved" && autoSaveData && (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: "8px", background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={{ color: "#16a34a", fontSize: "15px" }}>✓</span>
                              <div>
                                <Text as="p" variant="bodySm">{t("modal.draft_saved", locale)}</Text>
                                <Text as="p" variant="bodySm" tone="subdued">{autoSaveData.title}</Text>
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: "8px", flexShrink: 0, alignItems: "center" }}>
                              {selectedFilter !== savedFilter && !filterProcessing && (
                                <button
                                  disabled={updateImageStatus === "updating"}
                                  onClick={() => {
                                    const src = selectedFilter !== "none"
                                      ? filteredImages[`0-${selectedFilter}`]
                                      : generatedImages[0];
                                    const base64Match = src?.match(/^data:image\/\w+;base64,(.+)$/);
                                    if (!base64Match) return;
                                    setUpdateImageStatus("updating");
                                    const form = new FormData();
                                    form.set("intent", "updateCollectionImage");
                                    form.set("collectionId", autoSaveData.collectionId);
                                    form.set("imageBase64", base64Match[1]);
                                    fetcher.submit(form, { method: "POST" });
                                  }}
                                  style={{ fontSize: "13px", color: "#2563eb", background: "none", border: "1px solid #93c5fd", borderRadius: "6px", cursor: updateImageStatus === "updating" ? "wait" : "pointer", padding: "3px 8px", opacity: updateImageStatus === "updating" ? 0.6 : 1 }}
                                >
                                  {updateImageStatus === "updating" ? "…" : t("modal.update_image", locale)}
                                </button>
                              )}
                              {updateImageStatus === "updated" && selectedFilter === savedFilter && (
                                <span style={{ fontSize: "12px", color: "#16a34a" }}>✓ {t("modal.image_updated", locale)}</span>
                              )}
                              <a
                                href={`https://${shopDomain}/admin/collections/${autoSaveData.collectionId.split("/").pop()}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ fontSize: "13px", color: "#2563eb", textDecoration: "none", padding: "4px 0" }}
                              >
                                {t("modal.open_admin", locale)}
                              </a>
                              <button
                                onClick={() => {
                                  const discardForm = new FormData();
                                  discardForm.set("intent", "discard");
                                  discardForm.set("collectionId", autoSaveData.collectionId);
                                  fetcher.submit(discardForm, { method: "POST" });
                                }}
                                style={{ fontSize: "13px", color: "#dc2626", background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}
                              >
                                {t("modal.discard", locale)}
                              </button>
                            </div>
                          </div>
                        )}
                        {autoSaveStatus === "error" && (
                          <Banner tone="critical">Failed to save draft collection.</Banner>
                        )}
                      </BlockStack>
                      );
                    })}
                  </BlockStack>}
                </div>
              </div>
            )}
          </Layout.Section>

          {/* Right: Model + Settings */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              {/* Selected products summary */}
              {selectedProducts.length > 0 && (
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">
                      {t("selected.title", locale)} ({selectedProducts.length}/{MAX_PRODUCTS})
                    </Text>
                    {selectedProductData.map((p) => (
                      <InlineStack key={p.id} gap="200" blockAlign="center">
                        <Thumbnail
                          source={
                            p.featuredImage?.url || p.images[0]?.url || ""
                          }
                          alt={p.title}
                          size="small"
                        />
                        <Text as="span" variant="bodySm">
                          {p.title}
                        </Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </Card>
              )}

              {/* Model Selection */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    {t("model.select", locale)}
                  </Text>

                  <InlineStack gap="200">
                    <Button
                      pressed={gender === "female"}
                      onClick={() => {
                        setGender("female");
                        setSelectedModelId(null);
                      }}
                      size="slim"
                    >
                      {t("model.female", locale)}
                    </Button>
                    <Button
                      pressed={gender === "male"}
                      onClick={() => {
                        setGender("male");
                        setSelectedModelId(null);
                      }}
                      size="slim"
                    >
                      {t("model.male", locale)}
                    </Button>
                  </InlineStack>

                  {ethnicityOptions.length > 0 && (
                        <Select
                          label={t("model.ethnicity", locale)}
                          options={ethnicityOptions}
                          value={ethnicity}
                          onChange={(v) => {
                            setEthnicity(v);
                            setSelectedModelId(null);
                          }}
                        />
                      )}

                      {/* Model thumbnails gallery */}
                      {filteredModels.length > 0 ? (
                        <BlockStack gap="200">
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("model.click_to_select", locale)}
                          </Text>
                          <div style={{ maxHeight: "400px", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(2, 1fr)",
                              gap: "8px",
                            }}
                          >
                            {filteredModels.map((model) => (
                              <div
                                key={model.id}
                                onClick={() =>
                                  setSelectedModelId(
                                    selectedModelId === model.id ? null : model.id
                                  )
                                }
                                onMouseEnter={() => setHoveredModelId(model.id)}
                                onMouseLeave={() => setHoveredModelId(null)}
                                style={{
                                  cursor: "pointer",
                                  borderRadius: "8px",
                                  overflow: "hidden",
                                  border:
                                    selectedModelId === model.id
                                      ? "3px solid #2C6ECB"
                                      : "2px solid transparent",
                                  boxShadow:
                                    selectedModelId === model.id
                                      ? "0 0 0 2px rgba(44, 110, 203, 0.3)"
                                      : "none",
                                  transition: "all 0.15s ease",
                                }}
                              >
                                <div style={{ position: "relative" }}>
                                  <img
                                    src={model.thumbnail}
                                    alt={`${model.ethnicity} ${model.gender} model`}
                                    style={{
                                      width: "100%",
                                      aspectRatio: "3/4",
                                      objectFit: "cover",
                                      display: "block",
                                    }}
                                  />
                                  {hoveredModelId === model.id && (
                                    <img
                                      src={model.fullImage || model.thumbnail}
                                      alt="Face detail"
                                      style={{
                                        position: "absolute",
                                        inset: 0,
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "cover",
                                        objectPosition: "center 10%",
                                        transform: "scale(2.8)",
                                        transformOrigin: "center 10%",
                                        pointerEvents: "none",
                                      }}
                                    />
                                  )}
                                  <div style={{
                                    position: "absolute",
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    background: "rgba(0,0,0,0.6)",
                                    color: "#fff",
                                    fontSize: "8px",
                                    fontFamily: "monospace",
                                    textAlign: "center",
                                    padding: "1px 2px",
                                  }}>
                                    {model.id.replace(/-[fm]-18-stand-/, "-").toUpperCase()}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                          </div>
                          {selectedModel && (
                            <Banner tone="info">
                              {t("model.selected_label", locale)}: {selectedModel.id}
                            </Banner>
                          )}
                        </BlockStack>
                      ) : (
                        <Banner tone="warning">
                          {t("model.none_available", locale)}
                        </Banner>
                      )}
                </BlockStack>
              </Card>

              {/* Model Settings */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    {t("model_settings.title", locale)}
                  </Text>
                  <RangeSlider
                      label={`${t("model_settings.height", locale)}: ${height}cm`}
                      min={150}
                      max={190}
                      value={height}
                      onChange={(v) => setHeight(v as number)}
                      output
                    />
                  <Select
                    label={t("model_settings.pose", locale)}
                    options={getPoseOptions(locale)}
                    value={pose}
                    onChange={setPose}
                  />
                </BlockStack>
              </Card>

              {/* Styling Options */}
              {!isJewelryMode && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    {t("styling.title", locale)}
                  </Text>
                  <Select
                    label={t("styling.tops_hem", locale)}
                    options={[
                      { label: t("styling.auto", locale), value: "auto" },
                      { label: t("styling.tuck_in", locale), value: "tuck-in" },
                      { label: t("styling.tuck_out", locale), value: "tuck-out" },
                      { label: t("styling.french_tuck", locale), value: "french-tuck" },
                    ]}
                    value={tuckStyle}
                    onChange={setTuckStyle}
                  />
                  <Select
                    label={t("styling.outer_layer", locale)}
                    options={[
                      { label: t("styling.auto", locale), value: "auto" },
                      { label: t("styling.open", locale), value: "open" },
                      { label: t("styling.closed", locale), value: "closed" },
                    ]}
                    value={outerStyle}
                    onChange={setOuterStyle}
                  />
                </BlockStack>
              </Card>
              )}

              {/* Scene Settings */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    {t("scene.title", locale)}
                  </Text>
                  <Select
                    label={t("scene.background", locale)}
                    options={isJewelryMode ? getJewelryBackgroundOptions(locale) : getBackgroundOptions(locale)}
                    value={background}
                    onChange={setBackground}
                  />
                  <Select
                    label={t("scene.aspect_ratio", locale)}
                    options={getAspectRatioOptions(locale)}
                    value={aspectRatio}
                    onChange={setAspectRatio}
                  />
                  <TextField
                    label={t("scene.custom_prompt", locale)}
                    value={customPrompt}
                    onChange={setCustomPrompt}
                    multiline={3}
                    maxLength={5000}
                    showCharacterCount
                    placeholder={t("scene.custom_prompt_placeholder", locale)}
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>

              {/* Generate Button */}
              <Card>
                <BlockStack gap="300">
                  {generationError && (
                    <Banner tone="critical">
                      {generationError}
                      {(fetcher.data as any)?.creditExhausted && (
                        <Box paddingBlockStart="200">
                          <Button url="/app/billing" size="slim">
                            {t("upgrade_plan", locale)}
                          </Button>
                        </Box>
                      )}
                    </Banner>
                  )}
                  <Button
                    variant="primary"
                    size="large"
                    fullWidth
                    onClick={handleGenerate}
                    loading={isGenerating}
                    disabled={selectedProducts.length === 0 || !localCredits.canGenerate}
                  >
                    {isGenerating
                      ? t("modal.creating", locale)
                      : `${t("create_look", locale)} (${selectedProducts.length})`}
                  </Button>
                  <InlineStack align="center" gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {localCredits.creditsRemaining} pt remaining
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">•</Text>
                    <Button url="/app/billing" variant="plain" size="slim">
                      {localCredits.planKey === "free" ? "Upgrade" : "Manage"}
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
