/**
 * Shopify Product API helpers
 * Fetches products from merchant's Shopify store via GraphQL Admin API
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  description: string;
  featuredImage: { url: string; altText: string | null } | null;
  images: { id: string; url: string; altText: string | null }[];
  variants: {
    id: string;
    title: string;
    price: string;
    image: { url: string } | null;
  }[];
  productType: string;
  vendor: string;
}

const PRODUCTS_QUERY = `
  query getProducts($cursor: String, $query: String) {
    products(first: 50, after: $cursor, query: $query) {
      edges {
        node {
          id
          title
          handle
          description
          productType
          vendor
          featuredImage {
            url
            altText
          }
          images(first: 10) {
            edges {
              node {
                id
                url
                altText
              }
            }
          }
          variants(first: 10) {
            edges {
              node {
                id
                title
                price
                image {
                  url
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export async function fetchProducts(
  admin: AdminApiContext,
  options?: { cursor?: string; query?: string }
): Promise<{
  products: ShopifyProduct[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}> {
  const response = await admin.graphql(PRODUCTS_QUERY, {
    variables: {
      cursor: options?.cursor || null,
      query: options?.query || null,
    },
  });

  const data = await response.json();
  const edges = data.data?.products?.edges || [];
  const pageInfo = data.data?.products?.pageInfo || {
    hasNextPage: false,
    endCursor: null,
  };

  const products: ShopifyProduct[] = edges.map((edge: any) => ({
    id: edge.node.id,
    title: edge.node.title,
    handle: edge.node.handle,
    description: edge.node.description || "",
    productType: edge.node.productType,
    vendor: edge.node.vendor || "",
    featuredImage: edge.node.featuredImage,
    images: (edge.node.images?.edges || []).map((ie: any) => ie.node),
    variants: (edge.node.variants?.edges || []).map((ve: any) => ve.node),
  }));

  return { products, pageInfo };
}
