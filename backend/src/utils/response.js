export function ok(res, data, meta) {
  return res.json(meta ? { success: true, data, meta } : { success: true, data });
}

export function created(res, data) {
  return res.status(201).json({ success: true, data });
}

export function message(res, text) {
  return res.json({ success: true, message: text });
}
