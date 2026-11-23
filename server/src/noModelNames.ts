// Nothing that leaves the server says which AI RoleMatch uses (owner, 11 Nov 2026: "people can't know that this is Claude, anywhere ... they shouldn't
// know the LLM we're using"). Records and results keep the model in the database for the audit; every reply leaves out a model's identifier and the
// provider's name. Only identifiers are left out ("claude-haiku-5-5", a "model" or "provider" field naming one): a person called Claude in a CV is untouched.
const MODEL_ID = /^(claude|anthropic)([-./:][\w.-]*)?$/i, NAMES = /claude|anthropic|haiku|sonnet|opus/i;
/** A JSON.stringify replacer for every reply. */
export const withoutModelNames = (key: string, value: unknown) =>
  typeof value === "string" && (MODEL_ID.test(value.trim()) || ((key === "model" || key === "provider") && NAMES.test(value))) ? undefined : value;
