/**
 * Seed Shopify dev store with VUAL products from Supabase
 * Run with: npx shopify app dev (keep running) then in another terminal:
 * npx tsx scripts/seed-products.ts
 *
 * This uses the Shopify Admin REST/GraphQL API directly via the dev store's access token.
 */

// Products to create in Shopify (translated from Japanese VUAL data)
const PRODUCTS = [
  {
    title: "Blouse",
    body_html: "<p>A soft-touch elegant blouse. Made with 100% cotton. Machine washable.</p>",
    vendor: "VUAL",
    product_type: "Tops",
    tags: ["women", "tops", "blouse"],
    variants: [
      { option1: "36", price: "100.00" },
      { option1: "38", price: "100.00" },
    ],
    options: [{ name: "Size", values: ["36", "38"] }],
    images: [
      { src: "https://abgwfcnjjqiimuxxibnx.supabase.co/storage/v1/object/public/media/products/1772105950349-yu3z30.jpg" },
    ],
  },
  {
    title: "Wide Relaxed Pants",
    body_html: "<p>Wide relaxed fit pants. Made with 100% cotton.</p>",
    vendor: "VUAL",
    product_type: "Pants",
    tags: ["women", "pants", "bottoms"],
    variants: [
      { option1: "S", price: "200.00" },
      { option1: "M", price: "200.00" },
      { option1: "L", price: "200.00" },
    ],
    options: [{ name: "Size", values: ["S", "M", "L"] }],
    images: [
      { src: "https://abgwfcnjjqiimuxxibnx.supabase.co/storage/v1/object/public/media/products/1772106040104-3djm2w.jpg" },
    ],
  },
  {
    title: "Classic Pumps",
    body_html: "<p>Standard elegant pumps for everyday wear.</p>",
    vendor: "VUAL",
    product_type: "Shoes",
    tags: ["women", "shoes", "pumps"],
    variants: [
      { option1: "36", price: "500.00" },
      { option1: "37", price: "500.00" },
      { option1: "38", price: "500.00" },
    ],
    options: [{ name: "Size", values: ["36", "37", "38"] }],
    images: [
      { src: "https://abgwfcnjjqiimuxxibnx.supabase.co/storage/v1/object/public/media/products/1772106145631-l420c9.jpg" },
    ],
  },
  {
    title: "Tod's Leather Tote Bag",
    body_html: "<p>A modern shopping bag in calf leather combining essential design, lightness, and practicality. Features a logo metal bar accessory on the front with magnetic closure, perfect for urban daily looks.</p>",
    vendor: "VUAL",
    product_type: "Bags",
    tags: ["women", "bags", "tote", "leather"],
    variants: [
      { option1: "One Size", price: "500.00" },
    ],
    options: [{ name: "Size", values: ["One Size"] }],
    images: [
      { src: "https://abgwfcnjjqiimuxxibnx.supabase.co/storage/v1/object/public/media/products/1772106245710-pgq8ko.jpg" },
      { src: "https://abgwfcnjjqiimuxxibnx.supabase.co/storage/v1/object/public/media/products/1772106245720-y2dfih.jpg" },
      { src: "https://abgwfcnjjqiimuxxibnx.supabase.co/storage/v1/object/public/media/products/1772106245895-qlv9gt.jpg" },
    ],
  },
];

async function main() {
  // Read session from SQLite to get the access token
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const session = await prisma.session.findFirst({
    where: { shop: "vual-dev.myshopify.com" },
  });

  if (!session) {
    console.error("No session found for vual-dev.myshopify.com. Make sure shopify app dev is running.");
    process.exit(1);
  }

  const accessToken = session.accessToken;
  const shop = session.shop;
  console.log(`Using shop: ${shop}`);

  for (const product of PRODUCTS) {
    console.log(`Creating product: ${product.title}...`);

    const response = await fetch(
      `https://${shop}/admin/api/2025-01/products.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ product }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to create ${product.title}: ${response.status} ${error}`);
      continue;
    }

    const data = await response.json();
    console.log(`  Created: ${data.product.title} (ID: ${data.product.id})`);
  }

  await prisma.$disconnect();
  console.log("\nDone! All products created.");
}

main().catch(console.error);
