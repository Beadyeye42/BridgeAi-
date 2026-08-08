import { describe, expect, it, vi } from "vitest";
import { evaluateSupplierMatches } from "../lib/matching/suppliers";

describe("supplier matching with retired categories", () => {
  it("filters category selections in SQL without hydrating an RLS-hidden required relation", async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    await evaluateSupplierMatches(
      { supplierCompany: { findMany } } as never,
      {
        id: "request_1",
        categoryId: "category_composite_doors",
        deliveryPostcode: "GL52 6TD",
        deliveryLatitude: 51.9,
        deliveryLongitude: -2.1,
      },
      { postcode: "GL52 6TD", latitude: 51.9, longitude: -2.1 },
    );

    const query = findMany.mock.calls[0]?.[0];
    expect(query.include.categories).toEqual({
      where: {
        productCategory: { active: true },
        OR: [
          { productCategoryId: "category_composite_doors" },
          { productCategory: { parentId: "category_composite_doors" } },
          { productCategory: { children: { some: { id: "category_composite_doors", active: true } } } },
        ],
      },
      select: { productCategoryId: true },
    });
    expect(query.include.categories).not.toHaveProperty("include.productCategory");
  });
});
