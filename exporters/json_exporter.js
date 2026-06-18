/**
 * Convert collected data to a formatted JSON string.
 * The data object already follows the common schema:
 *   { service, title, exportedAt, url, messages: [{role, content}], sources? }
 */
export function toJson(data, _service) {
  return JSON.stringify(data, null, 2);
}
