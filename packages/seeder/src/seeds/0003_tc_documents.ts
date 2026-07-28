import { readFile } from "node:fs/promises";
import { tcDocument, tcDocumentVersion } from "@repo/db/schema";
import type { Seed } from "../types";

const content = (fileName: string) =>
  readFile(new URL(`./content/${fileName}`, import.meta.url), "utf8");

// Initial terms-and-conditions documents, each published as version 1. The
// admin edits later versions through /admin/tcs; checkbox labels live on the
// version so the acceptance audit keeps the exact agree-text users saw.
export const tcDocuments: Seed = {
  name: "0003_tc_documents",
  run: async (db) => {
    const documents = [
      {
        slug: "terms_of_service",
        title: "Terms of Service and Payment Policy",
        appliesToRole: "all",
        content: await content("terms_of_service.md"),
        checkboxLabel:
          "I have read and agree to the Poppynz Terms of Service, Payment and Cancellation Policy, and Privacy Policy.",
      },
      {
        slug: "service_provider_fee_acceptance",
        title: "Poppynz Earning Fee",
        appliesToRole: "service-provider",
        content: await content("service_provider_fee_acceptance.md"),
        checkboxLabel:
          "I understand and agree that Poppynz will deduct a 15% service fee from my Earning Rate for each completed booking.",
      },
      {
        slug: "family_fee_acceptance",
        title: "Poppynz Family Service Fee",
        appliesToRole: "family",
        content: await content("family_fee_acceptance.md"),
        checkboxLabel:
          "I understand and agree that a 5% Poppynz Family Service Fee will be added to the Caregiver Charges. I have reviewed and authorize the total amount shown above.",
      },
    ] as const;

    for (const entry of documents) {
      const [document] = await db
        .insert(tcDocument)
        .values({
          slug: entry.slug,
          title: entry.title,
          appliesToRole: entry.appliesToRole,
        })
        .returning();

      await db.insert(tcDocumentVersion).values({
        documentId: document.id,
        version: 1,
        description: "Initial version",
        content: entry.content,
        checkboxLabel: entry.checkboxLabel,
        publishedAt: new Date(),
      });
    }
  },
};
