// Gemini responseSchema 문법(대문자 type, nullable, propertyOrdering)을 표준 JSON Schema로 바꾼다. Ollama format에 넘긴다.
export function toJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toJsonSchema);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const schema: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (key === "nullable" || key === "propertyOrdering") continue;
    if (key === "properties" && item && typeof item === "object") {
      schema.properties = Object.fromEntries(Object.entries(item).map(([name, property]) => [name, toJsonSchema(property)]));
    } else {
      schema[key] = key === "type" && typeof item === "string" ? item.toLowerCase() : toJsonSchema(item);
    }
  }
  if (source.nullable === true) {
    if (typeof schema.type === "string") schema.type = [schema.type, "null"];
    if (Array.isArray(schema.enum)) schema.enum = [...schema.enum, null];
  }
  return schema;
}
