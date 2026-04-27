#!/usr/bin/env node
/**
 * compress-glbs.mjs
 *
 * Re-encodes every .glb under public/tents/ using Meshopt compression
 * (EXT_meshopt_compression). Output is written to public/tents-compressed/
 * mirroring the source layout — originals are NEVER modified.
 *
 * Why Meshopt over Draco:
 *   - Faster decode (no WASM startup cost)
 *   - Better-than-Draco ratios on typical CAD geometry
 *   - Babylon's @babylonjs/loaders auto-handles EXT_meshopt_compression
 *
 * Usage:
 *   node scripts/compress-glbs.mjs                # default: public/tents → public/tents-compressed
 *   node scripts/compress-glbs.mjs --in <dir>     # custom source
 *   node scripts/compress-glbs.mjs --out <dir>    # custom destination
 *   node scripts/compress-glbs.mjs --in-place     # overwrite originals (use only after verifying output)
 *
 * Requires:
 *   npm install --save-dev gltfpack
 *
 * After running, point the loader at the new directory by changing the
 * folder string in your component (or copy the compressed files over the
 * originals once you've verified visual fidelity in the browser).
 */

import { readdir, mkdir, stat, copyFile } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

// ── CLI parsing ───────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function getArg(flag, fallback) {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const SOURCE = getArg('--in', join(REPO_ROOT, 'public/tents'))
const DEST = getArg('--out', join(REPO_ROOT, 'public/tents-compressed'))
const IN_PLACE = args.includes('--in-place')

// ── Walk + collect .glb paths ─────────────────────────────────────────────
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.glb')) yield path
  }
}

// ── gltfpack invocation ───────────────────────────────────────────────────
function runGltfpack(input, output) {
  return new Promise((resolve, reject) => {
    // -cc = compress + use EXT_meshopt_compression with quantization
    // -tc = compress textures (skipped — not used in this project; pass anyway, no-op)
    // -kn = keep node names (preserves part identity for our component logic)
    // -km = keep materials (we strip them at load time but keep for portability)
    const child = spawn('npx', ['--yes', 'gltfpack', '-cc', '-kn', '-km', '-i', input, '-o', output], {
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`gltfpack exited ${code}`)))
  })
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[compress-glbs] source: ${SOURCE}`)
  console.log(`[compress-glbs] dest:   ${IN_PLACE ? '(in-place)' : DEST}`)
  if (IN_PLACE) {
    console.log('[compress-glbs] WARNING: --in-place will overwrite originals.')
    console.log('[compress-glbs] Press Ctrl-C within 3s to abort...')
    await new Promise(r => setTimeout(r, 3000))
  }

  let totalIn = 0, totalOut = 0, count = 0
  for await (const inPath of walk(SOURCE)) {
    const rel = relative(SOURCE, inPath)
    const outPath = IN_PLACE ? inPath : join(DEST, rel)
    if (!IN_PLACE) await mkdir(dirname(outPath), { recursive: true })

    const tmpOut = IN_PLACE ? `${inPath}.tmp` : outPath
    console.log(`\n[compress-glbs] ${rel}`)
    try {
      await runGltfpack(inPath, tmpOut)
      if (IN_PLACE) {
        await copyFile(tmpOut, inPath)
        await (await import('node:fs/promises')).unlink(tmpOut)
      }
      const sIn = (await stat(inPath)).size
      const sOut = (await stat(outPath)).size
      totalIn += sIn; totalOut += sOut; count++
      const pct = ((1 - sOut / sIn) * 100).toFixed(1)
      console.log(`[compress-glbs]   ${(sIn / 1024).toFixed(1)} KB → ${(sOut / 1024).toFixed(1)} KB  (-${pct}%)`)
    } catch (err) {
      console.error(`[compress-glbs] FAILED: ${rel}`, err.message)
    }
  }

  if (count === 0) {
    console.log('\n[compress-glbs] No .glb files found.')
    return
  }
  const totalPct = ((1 - totalOut / totalIn) * 100).toFixed(1)
  console.log(`\n[compress-glbs] Done. ${count} files, ${(totalIn / 1024 / 1024).toFixed(2)} MB → ${(totalOut / 1024 / 1024).toFixed(2)} MB  (-${totalPct}%)`)
}

main().catch(err => {
  console.error('[compress-glbs] fatal:', err)
  process.exit(1)
})
