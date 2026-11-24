// The choices a fragrance is described with. The admin offers these as one-tap options;
// the shop uses them for filters. Free text is still allowed where it makes sense.

export const AUDIENCES = ["women", "men", "unisex"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;

export const OCCASIONS = ["daily", "work", "casual", "evening", "date-night", "special"] as const;

// Suggested only: a product can use any tag. These power the admin's tap-to-choose list.
export const SUGGESTED_ACCORDS = [
  "vanilla", "oud", "amber", "musk", "sweet", "spicy", "woody", "floral", "fresh", "citrus", "fruity", "powdery",
  "smoky", "leather", "rose", "coffee", "caramel", "tobacco", "coconut", "aquatic", "green", "honey", "saffron", "sandalwood",
] as const;

export const SUGGESTED_FAMILIES = [
  "Woody", "Floral", "Fresh", "Citrus", "Oriental", "Gourmand", "Aromatic", "Musky", "Aquatic", "Leather", "Oud", "Fruity", "Spicy", "Green",
] as const;

export const SUGGESTED_SIZES_ML = [2, 3, 5, 10, 15, 20, 30] as const;
