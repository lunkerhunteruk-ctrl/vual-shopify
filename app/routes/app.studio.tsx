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
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { fetchProducts } from "../../lib/shopify/products.server";
import { generateImage } from "../../lib/ai/gemini-image.server";
import { uploadImageToProduct } from "../../lib/shopify/images.server";
import { getCreditStatus, consumeCredit } from "../../lib/billing/credit-tracker.server";
import type { FilterId } from "../../lib/photo-filters";
const FILTERS: { id: FilterId; label: string }[] = [
  { id: "none", label: "Original" },
  { id: "natural", label: "Natural" },
  { id: "film", label: "Film" },
  { id: "chrome", label: "Chrome" },
  { id: "neg", label: "Neg" },
];

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
  const fs = await import("fs");
  const path = await import("path");
  let modelDatabase: ModelDatabase | null = null;
  try {
    const dbPath = path.join(process.cwd(), "public", "models", "database.json");
    const dbContent = fs.readFileSync(dbPath, "utf-8");
    modelDatabase = JSON.parse(dbContent);
  } catch (e) {
    console.error("Failed to load model database:", e);
  }

  return json({ products, pageInfo, modelDatabase, creditStatus });
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

    // Convert model image (local file path) to base64
    let modelImage: string | undefined;
    if (modelImagePath) {
      try {
        const fs = await import("fs");
        const path = await import("path");
        const fullPath = path.join(process.cwd(), "public", modelImagePath);
        const fileBuffer = fs.readFileSync(fullPath);
        const base64 = fileBuffer.toString("base64");
        modelImage = `data:image/jpeg;base64,${base64}`;
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

  return json({ error: "Unknown intent" }, { status: 400 });
};

const poseOptions = [
  { label: "Standing", value: "standing" },
  { label: "Walking", value: "walking" },
  { label: "Sitting", value: "sitting" },
  { label: "Dynamic", value: "dynamic" },
  { label: "Leaning", value: "leaning" },
];

const backgroundOptions = [
  { label: "Studio White", value: "studioWhite" },
  { label: "Studio Gray", value: "studioGray" },
  { label: "Outdoor Urban", value: "outdoorUrban" },
  { label: "Outdoor Nature", value: "outdoorNature" },
  { label: "Cafe Indoor", value: "cafeIndoor" },
  { label: "Beach Resort", value: "beachResort" },
  { label: "Custom (use prompt)", value: "custom" },
];

const jewelryBackgroundOptions = [
  { label: "Studio White", value: "studioWhite" },
  { label: "Studio Gray", value: "studioGray" },
  { label: "Marble Surface", value: "marble" },
  { label: "Velvet Dark", value: "velvet" },
  { label: "Natural Linen", value: "natural" },
];

const aspectRatioOptions = [
  { label: "3:4 (Portrait)", value: "3:4" },
  { label: "1:1 (Square)", value: "1:1" },
  { label: "4:3 (Landscape)", value: "4:3" },
  { label: "16:9 (Hero Banner)", value: "16:9" },
  { label: "9:16 (Story)", value: "9:16" },
];

export default function StudioPage() {
  const { products: initialProducts, pageInfo: initialPageInfo, modelDatabase, creditStatus } =
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
        const overageNote = data.isOverage ? " (overage)" : "";
        shopify.toast.show(`Image generated successfully!${overageNote}`);
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
      shopify.toast.show("Image saved to product!");
    }
    if (data.type === "saveAll") {
      const msg = `Saved to ${data.uploadCount}/${data.totalProducts} products` +
        (data.collection?.success ? ` + Collection "${data.generatedTitle || data.collection.handle}" created!` : "");
      shopify.toast.show(msg);
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
      title="Look Creation"
      subtitle="Generate professional model photography"
    >
      <BlockStack gap="500">
        <Layout>
          {/* Left: Product Selection + Generated Images */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Select Products
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
                      All
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
                    <Text as="span" variant="bodySm" tone="subdued">Brand:</Text>
                    <Button
                      pressed={vendorFilter === "all"}
                      onClick={() => setVendorFilter("all")}
                      size="slim"
                    >
                      All
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
                  placeholder="Search products..."
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
                      Load more products
                    </Button>
                  </InlineStack>
                )}
                </div>
              </BlockStack>
            </Card>

            {/* Generated Images Modal */}
            {showResultModal && generatedImages.length > 0 && (
              <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setShowResultModal(false)} />
                <div style={{ position: "relative", background: "#fff", borderRadius: "16px", maxWidth: "720px", width: "90vw", maxHeight: "90vh", overflow: "hidden", padding: "24px", display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                    <Text as="h2" variant="headingMd">Generated Look</Text>
                    <button onClick={() => setShowResultModal(false)} style={{ background: "none", border: "none", fontSize: "24px", cursor: "pointer", color: "#666", padding: "4px 8px" }}>&times;</button>
                  </div>
                  {showReviewBanner && (
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
                  <BlockStack gap="400">
                    {generatedImages.map((img, i) => {
                      const displayImg = (selectedFilter !== "none" && filteredImages[`${i}-${selectedFilter}`]) || img;
                      return (
                      <BlockStack gap="300" key={i}>
                        <Box borderRadius="200" borderWidth="025" borderColor="border" padding="200">
                          <img src={displayImg} alt={`Generated look ${i + 1}`} style={{ width: "100%", maxHeight: "calc(90vh - 320px)", objectFit: "contain", borderRadius: "8px", display: "block", transition: "opacity 0.3s", opacity: filterProcessing ? 0.5 : 1 }} />
                        </Box>

                        {/* Filter selection */}
                        <InlineStack gap="200" wrap>
                          {FILTERS.map((f) => {
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
                                    const { applyFilter } = await import("../../lib/photo-filters");
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

                        <InlineStack gap="200">
                          <Button onClick={() => { const src = displayImg; const ext = src.startsWith("data:image/jpeg") ? "jpg" : "png"; fetch(src).then(r => r.blob()).then(blob => { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `vual-studio-${Date.now()}.${ext}`; link.click(); URL.revokeObjectURL(url); }); }} size="slim">
                            Download
                          </Button>
                        </InlineStack>
                        {selectedProductData.length > 0 && (
                          <BlockStack gap="300">
                            <Button variant="primary" fullWidth onClick={() => handleSaveAllAndCollection(displayImg)} loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "saveAllAndCollection"}>
                              Save to All Products + Create Collection
                            </Button>
                            <InlineStack gap="200" wrap>
                              {selectedProductData.map((p) => (
                                <Button key={p.id} onClick={() => handleSaveToProduct(displayImg, p.id)} loading={isSaving} size="slim">
                                  Save to {p.title}
                                </Button>
                              ))}
                            </InlineStack>
                          </BlockStack>
                        )}
                      </BlockStack>
                      );
                    })}
                  </BlockStack>
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
                      Selected ({selectedProducts.length}/{MAX_PRODUCTS})
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
                    Select Model
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
                      Female
                    </Button>
                    <Button
                      pressed={gender === "male"}
                      onClick={() => {
                        setGender("male");
                        setSelectedModelId(null);
                      }}
                      size="slim"
                    >
                      Male
                    </Button>
                  </InlineStack>

                  {ethnicityOptions.length > 0 && (
                        <Select
                          label="Ethnicity"
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
                            Click to select a model
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
                              Model selected: {selectedModel.id}
                            </Banner>
                          )}
                        </BlockStack>
                      ) : (
                        <Banner tone="warning">
                          No models available for this selection. AI will generate
                          a model based on settings below.
                        </Banner>
                      )}
                </BlockStack>
              </Card>

              {/* Model Settings */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Model Settings
                  </Text>
                  <RangeSlider
                      label={`Height: ${height}cm`}
                      min={150}
                      max={190}
                      value={height}
                      onChange={(v) => setHeight(v as number)}
                      output
                    />
                  <Select
                    label="Pose"
                    options={poseOptions}
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
                    Styling
                  </Text>
                  <Select
                    label="Tops Hem"
                    options={[
                      { label: "Auto", value: "auto" },
                      { label: "Tucked In", value: "tuck-in" },
                      { label: "Untucked", value: "tuck-out" },
                      { label: "French Tuck", value: "french-tuck" },
                    ]}
                    value={tuckStyle}
                    onChange={setTuckStyle}
                  />
                  <Select
                    label="Outer Layer"
                    options={[
                      { label: "Auto", value: "auto" },
                      { label: "Open", value: "open" },
                      { label: "Closed", value: "closed" },
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
                    Scene Settings
                  </Text>
                  <Select
                    label="Background"
                    options={backgroundOptions}
                    value={background}
                    onChange={setBackground}
                  />
                  <Select
                    label="Aspect Ratio"
                    options={aspectRatioOptions}
                    value={aspectRatio}
                    onChange={setAspectRatio}
                  />
                  <TextField
                    label="Custom prompt (optional)"
                    value={customPrompt}
                    onChange={setCustomPrompt}
                    multiline={3}
                    maxLength={500}
                    showCharacterCount
                    placeholder="e.g., casual street style, holding a coffee cup"
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
                            Upgrade Plan
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
                      ? "Creating Look..."
                      : `Create Look (${selectedProducts.length} item${selectedProducts.length !== 1 ? "s" : ""})`}
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
