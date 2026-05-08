/**
 * Normalizes a parsed filter object into a canonical form.
 * Two queries with the same intent must produce the same cache key.
 */
function normalizeFilters(filters) {
  const normalized = {};

  // Normalize gender
  if (filters.gender) {
    normalized.gender = filters.gender.toLowerCase().trim();
  }

  // Normalize age group
  if (filters.age_group) {
    normalized.age_group = filters.age_group.toLowerCase().trim();
  }

  // Normalize country
  if (filters.country_id) {
    normalized.country_id = filters.country_id.toUpperCase().trim();
  }

  // Normalize age range — always use min_age/max_age as numbers
  if (filters.min_age !== undefined) {
    normalized.min_age = parseInt(filters.min_age);
  }
  if (filters.max_age !== undefined) {
    normalized.max_age = parseInt(filters.max_age);
  }

  // Sort keys alphabetically so order doesn't affect cache key
  const sorted = {};
  Object.keys(normalized).sort().forEach(key => {
    sorted[key] = normalized[key];
  });

  return sorted;
}

/**
 * Generates a deterministic cache key from normalized filters.
 */
function generateCacheKey(filters, page, limit, sortBy, order) {
  const normalized = normalizeFilters(filters);
  const key = {
    ...normalized,
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 10,
    sort_by: sortBy || "created_at",
    order: (order || "asc").toLowerCase(),
  };
  return "profiles:" + JSON.stringify(key);
}

module.exports = { normalizeFilters, generateCacheKey };