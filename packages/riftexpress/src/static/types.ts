/**
 * Options for the `rex.static` middleware.
 */
export interface StaticOptions {
  /**
   * The file to serve when a directory is requested. Set to `false` to
   * disable directory-index resolution. Default: `'index.html'`.
   */
  index?: string | false

  /**
   * `Cache-Control: max-age=<seconds>` to set on served files, in
   * MILLISECONDS (Express convention). Default: `0` (no caching).
   */
  maxAge?: number

  /**
   * Extensions to try (in order) when the requested path doesn't exist.
   * For example, `['html']` lets `/about` resolve to `/about.html`.
   * Default: `[]` (off).
   */
  extensions?: string[]

  /**
   * How to treat files / directories whose name starts with `.`:
   * - `'allow'`  — serve normally
   * - `'deny'`   — respond with 403
   * - `'ignore'` — call `next()` (let routes 404 it). DEFAULT.
   */
  dotfiles?: 'allow' | 'deny' | 'ignore'
}
