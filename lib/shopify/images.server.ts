/**
 * Shopify Image Upload helpers
 * Uploads AI-generated images back to Shopify product pages
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

const STAGED_UPLOAD_MUTATION = `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_CREATE_MEDIA_MUTATION = `
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        id
        status
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

/**
 * Upload an AI-generated image to a Shopify product
 * @param admin - Authenticated Shopify Admin API context
 * @param productId - Shopify product GID (e.g., "gid://shopify/Product/123")
 * @param imageBase64 - Base64-encoded image data (without data URL prefix)
 * @param altText - Alt text for the image
 */
export async function uploadImageToProduct(
  admin: AdminApiContext,
  productId: string,
  imageBase64: string,
  altText: string = "VUAL Studio AI Generated"
): Promise<{ success: boolean; mediaId?: string; error?: string }> {
  try {
    // Step 1: Create staged upload target
    const stageResponse = await admin.graphql(STAGED_UPLOAD_MUTATION, {
      variables: {
        input: [
          {
            resource: "PRODUCT_IMAGE",
            filename: `vual-studio-${Date.now()}.png`,
            mimeType: "image/png",
            httpMethod: "PUT",
          },
        ],
      },
    });

    const stageData = await stageResponse.json();
    const target = stageData.data?.stagedUploadsCreate?.stagedTargets?.[0];

    if (!target) {
      const errors = stageData.data?.stagedUploadsCreate?.userErrors;
      return {
        success: false,
        error: `Failed to create staged upload: ${JSON.stringify(errors)}`,
      };
    }

    // Step 2: Upload binary data to staged URL
    const imageBuffer = Buffer.from(imageBase64, "base64");
    const uploadResponse = await fetch(target.url, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: imageBuffer,
    });

    if (!uploadResponse.ok) {
      return {
        success: false,
        error: `Upload to staged URL failed: ${uploadResponse.status}`,
      };
    }

    // Step 3: Create product media from staged upload
    const mediaResponse = await admin.graphql(PRODUCT_CREATE_MEDIA_MUTATION, {
      variables: {
        productId,
        media: [
          {
            originalSource: target.resourceUrl,
            mediaContentType: "IMAGE",
            alt: altText,
          },
        ],
      },
    });

    const mediaData = await mediaResponse.json();
    const mediaErrors =
      mediaData.data?.productCreateMedia?.mediaUserErrors || [];

    if (mediaErrors.length > 0) {
      return {
        success: false,
        error: `Media creation failed: ${JSON.stringify(mediaErrors)}`,
      };
    }

    const mediaId = mediaData.data?.productCreateMedia?.media?.[0]?.id;
    return { success: true, mediaId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}
