// page and limit come from the validated pagination query schema
export function pageRange({ page, limit }) {
  const from = (page - 1) * limit;
  return { from, to: from + limit - 1 };
}

export function pageMeta({ page, limit }, total) {
  return {
    page,
    limit,
    total: total ?? 0,
    total_pages: Math.ceil((total ?? 0) / limit),
  };
}
