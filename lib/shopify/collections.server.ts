/**
 * Shopify Collection helpers
 * Creates collections from AI-generated looks with linked products
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

const COLLECTION_CREATE_MUTATION = `
  mutation collectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Create a Shopify Custom Collection from an AI-generated look
 * @param admin - Authenticated Shopify Admin API context
 * @param title - Collection title (e.g., "Spring Look #1")
 * @param productIds - Array of Shopify product GIDs to include
 * @param imageUrl - Public URL of the AI-generated look image
 */
export async function createCollection(
  admin: AdminApiContext,
  title: string,
  productIds: string[],
  imageUrl?: string,
  descriptionHtml?: string
): Promise<{
  success: boolean;
  collectionId?: string;
  handle?: string;
  error?: string;
}> {
  try {
    const input: any = {
      title,
      products: productIds,
    };

    if (imageUrl) {
      input.image = { src: imageUrl };
    }

    if (descriptionHtml) {
      input.descriptionHtml = descriptionHtml;
    }

    const response = await admin.graphql(COLLECTION_CREATE_MUTATION, {
      variables: { input },
    });

    const data = await response.json();
    const errors = data.data?.collectionCreate?.userErrors || [];

    if (errors.length > 0) {
      return {
        success: false,
        error: `Collection creation failed: ${JSON.stringify(errors)}`,
      };
    }

    const collection = data.data?.collectionCreate?.collection;
    return {
      success: true,
      collectionId: collection?.id,
      handle: collection?.handle,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Collection creation failed",
    };
  }
}
