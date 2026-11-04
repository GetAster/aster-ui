import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

export const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
export const snippet = `<script defer src="${escape(config.scriptUrl)}" data-website-id="${escape(config.websiteId)}" data-domains="${escape(config.domains.join(','))}"></script>`;
const tracker = /<script\b[^>]*\bdata-website-id\s*=\s*(["'])[^"']*\1[^>]*>[\s\S]*?<\/script\s*>/gi;

export function instrumentHtml(html) {
  // Replace an existing tracker rather than record every page view twice.
  const old = html.match(tracker) ?? [];
  if (old.some(tag => !tag.includes(config.websiteId))) throw new Error('Unexpected analytics website ID');
  html = html.replace(tracker, '');
  if (/<\/head\s*>/i.test(html)) html = html.replace(/<\/head\s*>/i, snippet + '</head>');
  else if (/<title\b[^>]*>[\s\S]*?<\/title\s*>/i.test(html)) html = html.replace(/(<title\b[^>]*>[\s\S]*?<\/title\s*>)/i, '$1' + snippet);
  else throw new Error('HTML document has no head or title');
  if ((html.match(tracker) ?? []).length !== 1 || !html.includes(snippet)) throw new Error('Expected exactly one configured tracker');
  return html;
}

/** Apply the shared tracker to published HTML and update any per-file receipt. */
export async function instrumentDirectory(root) {
  const hashes = {};
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) await visit(path);
      else if (item.isFile() && item.name.endsWith('.html')) {
        const html = instrumentHtml(await readFile(path, 'utf8'));
        await writeFile(path, html);
        hashes[relative(root, path).replaceAll('\\', '/')] = createHash('sha256').update(html).digest('hex');
      }
    }
  }
  await visit(root);
  if (!Object.keys(hashes).length) throw new Error('No published HTML pages');
  const receiptPath = resolve(root, 'deployment.json');
  let receipt;
  try { receipt = JSON.parse(await readFile(receiptPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (receipt) {
    if (receipt.files && typeof receipt.files === 'object') Object.assign(receipt.files, hashes);
    receipt.analytics = { websiteId: config.websiteId, configSha256: createHash('sha256').update(JSON.stringify(config)).digest('hex') };
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  }
  return hashes;
}
