import { serviceCatalogueItem } from "@repo/db/schema";
import type { Seed } from "../types";

// Base catalogue from the UAT service list. Categories drive the filter chips
// in BrowseServicesDialog; rates are launch placeholders admins can adjust in
// the admin service-catalogue page.
export const serviceCatalogue: Seed = {
  name: "0002_service_catalogue",
  run: async (db) => {
    await db.insert(serviceCatalogueItem).values([
      { name: "Childcare", category: "Childcare", baseHourlyRateCents: 2000, isLive: true },
      { name: "Tutoring", category: "Education", baseHourlyRateCents: 2400, isLive: true },
      { name: "Elderly Check-in", category: "Elderly Care", baseHourlyRateCents: 2000, isLive: true },
      { name: "Pet Minding", category: "Pet Care", baseHourlyRateCents: 1500, isLive: true },
      { name: "Meal Preparation", category: "Home Help", baseHourlyRateCents: 2000, isLive: true },
      { name: "Light Housekeeping", category: "Home Help", baseHourlyRateCents: 1800, isLive: true },
      { name: "Yard Help", category: "Home Help", baseHourlyRateCents: 1800, isLive: true },
      { name: "Water my plants", category: "Home Help", baseHourlyRateCents: 1000, isLive: true },
      { name: "Taking out the rubbish/trash", category: "Home Help", baseHourlyRateCents: 1000, isLive: true },
      { name: "Bringing in your Amazon packages", category: "Home Help", baseHourlyRateCents: 1000, isLive: true },
      { name: "Custom Services", category: "Custom", baseHourlyRateCents: 2000, isLive: true },
    ]);
  },
};
