const { fail } = require('./validation');
function parse(query, key, fallback) {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== 'string') fail(`${key} must be a single JSON value.`);
    try { return JSON.parse(query[key]); }
    catch { fail(`${key} must contain valid JSON.`); }
}
function object(query, key) {
    const value = parse(query, key, {});
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${key} must be a JSON object.`);
    return value;
}
function projection(query) {
    const value = object(query, 'select');
    if (Object.values(value).some(v => v !== 0 && v !== 1)) fail('select values must be 0 or 1.');
    const modes = new Set(Object.entries(value).filter(([key]) => key !== '_id').map(([, v]) => v));
    if (modes.size > 1) fail('select cannot mix included and excluded fields except for _id.');
    return value;
}
function collectionQuery(query, defaultLimit) {
    const where = object(query, 'where');
    const sort = object(query, 'sort');
    if (Object.values(sort).some(v => v !== 1 && v !== -1)) fail('sort values must be 1 or -1.');
    const select = projection(query);
    const skip = parse(query, 'skip', 0);
    const limit = parse(query, 'limit', defaultLimit);
    for (const [key, value] of Object.entries({ skip, limit })) {
        if (!Number.isSafeInteger(value) || value < 0) fail(`${key} must be a non-negative integer.`);
    }
    const count = parse(query, 'count', false);
    if (typeof count !== 'boolean') fail('count must be a boolean.');
    return { where, sort, select, skip, limit, count };
}
module.exports = { projection, collectionQuery };
