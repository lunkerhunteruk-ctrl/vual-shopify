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

const PUBLISH_MUTATION = `
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors {
        field
        message
      }
    }
  }
`;

const PUBLICATIONS_QUERY = `
  query publications {
    publications(first: 20) {
      nodes {
        id
        name
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
  descriptionHtml?: string,
  modelId?: string
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

    if (modelId) {
      input.metafields = [
        {
          namespace: "vual",
          key: "model_id",
          value: modelId,
          type: "single_line_text_field",
        },
      ];
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
    if (!collection?.id) {
      return { success: false, error: "Collection created but no ID returned" };
    }

    // Publish to Online Store so it appears in theme editor
    await publishToOnlineStore(admin, collection.id);

    return {
      success: true,
      collectionId: collection.id,
      handle: collection.handle,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Collection creation failed",
    };
  }
}

/**
 * Publish a resource to the Online Store sales channel
 */
async function publishToOnlineStore(
  admin: AdminApiContext,
  resourceId: string
): Promise<void> {
  try {
    // Find the Online Store publication
    const pubResponse = await admin.graphql(PUBLICATIONS_QUERY);
    const pubData = await pubResponse.json();
    const publications = pubData.data?.publications?.nodes || [];
    console.log("Available publications:", publications.map((p: any) => p.name));
    const onlineStore = publications.find(
      (p: any) => p.name.toLowerCase().includes("online store")
    );

    if (!onlineStore) {
      console.warn("Online Store publication not found. Available:", publications.map((p: any) => p.name));
      return;
    }

    await admin.graphql(PUBLISH_MUTATION, {
      variables: {
        id: resourceId,
        input: [{ publicationId: onlineStore.id }],
      },
    });
  } catch {
    // Non-critical — collection still exists, just not published
    console.error("Failed to publish collection to Online Store");
  }
}
