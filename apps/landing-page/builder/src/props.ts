export const ALLOWED_INLINE_TAGS = ["strong", "em", "b", "i", "u", "s", "span", "a", "br"] as const;

export const str = (value: string) => ({ $$type: "string" as const, value });
export const bool = (value: boolean) => ({ $$type: "boolean" as const, value });
export const num = (value: number) => ({ $$type: "number" as const, value });

export function html(value: string) {
  for (const m of value.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    if (!(ALLOWED_INLINE_TAGS as readonly string[]).includes(tag)) throw new Error(`html(): tag <${tag}> is not allowed in V4 text`);
    const attrs = m[2].trim();
    if (attrs && !(tag === "a" && /^href="[^"]*"$/.test(attrs))) throw new Error(`html(): attribute "${attrs}" on <${tag}> is stripped by Elementor`);
  }
  return { $$type: "html-v3" as const, value: { content: str(value), children: [] as unknown[] } };
}

export function classes(list: string[]) {
  for (const c of list) if (!/^[a-z][a-z0-9_-]*$/i.test(c)) throw new Error(`classes(): invalid class name "${c}"`);
  return { $$type: "classes" as const, value: [...list] };
}

export function link(url: string, opts: { blank?: boolean } = {}) {
  return {
    $$type: "link" as const,
    value: { destination: { $$type: "url" as const, value: url }, isTargetBlank: bool(opts.blank ?? false), tag: str("a") },
  };
}

const mediaHash = (hash: string) => ({ $$type: "media-hash" as const, value: hash });

export function svgRef(hash: string) {
  return { $$type: "svg-src" as const, value: { id: mediaHash(hash), url: null as null } };
}
export function imageRef(hash: string, alt: string, size = "full") {
  return {
    $$type: "image" as const,
    value: { src: { $$type: "image-src" as const, value: { id: mediaHash(hash), url: null as null, alt: str(alt) } }, size: str(size) },
  };
}
export function videoRef(url: string) {
  return { $$type: "video-src" as const, value: { id: null as null, url: { $$type: "url" as const, value: url } } };
}
