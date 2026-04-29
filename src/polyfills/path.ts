// POSIX path operations polyfill


// Path separator and delimiter constants
export const sep = '/';
export const delimiter = ':';

export function normalize(inputPath: string): string {
  if (!inputPath) return '.';

  const rooted = inputPath.charAt(0) === '/';
  const tokens = inputPath.split('/').filter(t => t.length > 0);
  const stack: string[] = [];

  for (const token of tokens) {
    if (token === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else if (!rooted) {
        stack.push('..');
      }
    } else if (token !== '.') {
      stack.push(token);
    }
  }

  let output = stack.join('/');
  if (rooted) {
    output = '/' + output;
  }
  return output || '.';
}

export function join(...fragments: string[]): string {
  if (fragments.length === 0) return '.';
  const combined = fragments.filter(f => f !== '').join('/');
  return normalize(combined);
}

// nodepod's URL polyfill auto-roots relative URLs at "http://localhost" so
// jiti / tailwindcss config loaders end up handing us strings like
// "http://localhost/app/tailwind.config.js" via path.resolve(). If we treat
// those as relative we'd produce nonsense like "/app/http://localhost/...".
// Strip the scheme/origin to recover the real pathname (issue #54).
const URL_SCHEME_RE = /^[a-z][a-z0-9+\-.]*:/i;

function stripUrlScheme(seg: string): string {
  if (!URL_SCHEME_RE.test(seg)) return seg;
  try {
    const u = new globalThis.URL(seg);
    if (u.protocol === 'file:' || u.protocol === 'http:' || u.protocol === 'https:') {
      const decoded = decodeURIComponent(u.pathname);
      return decoded || seg;
    }
  } catch { /* not parseable, leave alone */ }
  return seg;
}

// resolves right-to-left until an absolute path is formed
export function resolve(...segments: string[]): string {
  let accumulated = '';

  for (let idx = segments.length - 1; idx >= 0; idx--) {
    const raw = segments[idx];
    if (!raw) continue;
    const segment = stripUrlScheme(raw);
    accumulated = segment + (accumulated ? '/' + accumulated : '');
    if (accumulated.charAt(0) === '/') break;
  }

  if (accumulated.charAt(0) !== '/') {
    const workingDir =
      typeof globalThis !== 'undefined' &&
      globalThis.process &&
      typeof globalThis.process.cwd === 'function'
        ? globalThis.process.cwd()
        : '/';
    accumulated = workingDir + (accumulated ? '/' + accumulated : '');
  }

  return normalize(accumulated);
}

export function isAbsolute(targetPath: string): boolean {
  if (!targetPath) return false;
  if (targetPath.charAt(0) === '/') return true;
  // Stringified URLs (file:, http://localhost/..., etc.) refer to absolute
  // resources -- don't let callers treat them as relative.
  if (URL_SCHEME_RE.test(targetPath)) {
    try {
      const u = new globalThis.URL(targetPath);
      if (u.protocol === 'file:' || u.protocol === 'http:' || u.protocol === 'https:') return true;
    } catch { /* not a URL, fall through */ }
  }
  return false;
}

// Node.js path.posix.dirname does NOT normalize before slicing -- it finds
// the last meaningful slash (skipping trailing ones) and returns the
// substring before it. We previously called normalize() first, which stripped
// `.` segments from `./src/**/*.js` and produced `src/**` instead of
// `./src/**`. That corrupts callers like glob-parent (used by Tailwind and
// many other libraries) that depend on byte-accurate prefix preservation:
// they then do `pattern.substr(base.length)` and get a shifted glob like
// `rc/**/*.js` instead of `**/*.js`. (This was the actual root cause of
// issue #54's "no utility classes detected" symptom.)
export function dirname(targetPath: string): string {
  const len = targetPath ? targetPath.length : 0;
  if (len === 0) return '.';

  const hasRoot = targetPath.charAt(0) === '/';
  let end = -1;
  let matchedSlash = true;
  for (let i = len - 1; i >= 1; i--) {
    if (targetPath.charAt(i) === '/') {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }

  if (end === -1) return hasRoot ? '/' : '.';
  if (hasRoot && end === 0) return '/';
  return targetPath.substring(0, end);
}

// Same lesson as dirname: do not normalize before slicing. We need the
// LITERAL last segment, not a canonicalised version.
export function basename(targetPath: string, suffix?: string): string {
  const len = targetPath ? targetPath.length : 0;
  if (len === 0) return '';

  // Skip trailing slashes
  let end = len;
  while (end > 0 && targetPath.charAt(end - 1) === '/') end--;
  if (end === 0) return '';

  // Find the last slash before `end`
  let start = 0;
  for (let i = end - 1; i >= 0; i--) {
    if (targetPath.charAt(i) === '/') { start = i + 1; break; }
  }

  let name = targetPath.substring(start, end);
  if (suffix && name.endsWith(suffix) && name.length > suffix.length) {
    name = name.substring(0, name.length - suffix.length);
  }
  return name;
}

export function extname(targetPath: string): string {
  const name = basename(targetPath);
  const dotPos = name.lastIndexOf('.');
  if (dotPos <= 0) return '';
  return name.substring(dotPos);
}

export function relative(fromPath: string, toPath: string): string {
  const absFrom = resolve(fromPath);
  const absTo = resolve(toPath);

  if (absFrom === absTo) return '';

  const partsFrom = absFrom.split('/').filter(Boolean);
  const partsTo = absTo.split('/').filter(Boolean);

  let shared = 0;
  const limit = Math.min(partsFrom.length, partsTo.length);
  while (shared < limit && partsFrom[shared] === partsTo[shared]) {
    shared++;
  }

  const ascend = partsFrom.length - shared;
  const descend = partsTo.slice(shared);

  const pieces: string[] = [];
  for (let i = 0; i < ascend; i++) {
    pieces.push('..');
  }
  pieces.push(...descend);

  return pieces.join('/') || '.';
}

export function parse(targetPath: string): {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
} {
  const clean = normalize(targetPath);
  const rooted = isAbsolute(clean);
  const directory = dirname(clean);
  const base = basename(clean);
  const extension = extname(clean);
  const stem = base.substring(0, base.length - extension.length);

  return {
    root: rooted ? '/' : '',
    dir: directory,
    base,
    ext: extension,
    name: stem,
  };
}

export function format(components: {
  root?: string;
  dir?: string;
  base?: string;
  ext?: string;
  name?: string;
}): string {
  const directory = components.dir || components.root || '';
  const filename = components.base || (components.name || '') + (components.ext || '');

  if (!directory) return filename;
  if (directory === components.root) return directory + filename;
  return directory + '/' + filename;
}

// The posix namespace mirrors all path functions (this IS a POSIX implementation)
export const posix = {
  sep,
  delimiter,
  normalize,
  join,
  resolve,
  isAbsolute,
  dirname,
  basename,
  extname,
  relative,
  parse,
  format,
};

// Win32 namespace provided as a stub; all operations delegate to POSIX logic
export const win32 = {
  sep: '\\',
  delimiter: ';',
  normalize,
  join,
  resolve,
  isAbsolute,
  dirname,
  basename,
  extname,
  relative,
  parse,
  format,
};

export default {
  sep,
  delimiter,
  normalize,
  join,
  resolve,
  isAbsolute,
  dirname,
  basename,
  extname,
  relative,
  parse,
  format,
  posix,
  win32,
};
