// Isolated native decoder: no credentials, network, arbitrary input paths or URLs.
import { createRequire } from 'node:module';

const sharp = createRequire(new URL('../../../web/package.json', import.meta.url))('sharp');
sharp.concurrency(1);
sharp.cache(false);
const widths = JSON.parse(process.argv[2]);
if (!Array.isArray(widths) || widths.length > 4 || widths.some((w) => ![16, 32, 64, 96, 160, 320, 640, 960].includes(w))) process.exit(1);
let size = 0;
const chunks = [];
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 5 * 1024 * 1024) process.exit(1);
  chunks.push(chunk);
}
try {
  const bytes = Buffer.concat(chunks);
  const raster =
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)) ||
    (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') ||
    (bytes.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis', 'mif1', 'msf1'].includes(bytes.toString('ascii', 8, 12)));
  if (!raster) process.exit(1);
  const image = sharp(bytes, { limitInputPixels: 16_777_216, animated: false, failOn: 'warning' });
  const metadata = await image.metadata();
  if (
    !(['jpeg', 'png', 'webp', 'gif'].includes(metadata.format) || (metadata.format === 'heif' && metadata.compression === 'av1')) ||
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > 16_777_216
  )
    process.exit(1);
  const output = {};
  let outputBytes = 0;
  for (const width of widths) {
    const body = await image
      .clone()
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 76, effort: 3 })
      .timeout({ seconds: 4 })
      .toBuffer();
    outputBytes += body.length;
    if (outputBytes > 5 * 1024 * 1024) process.exit(1);
    output[width] = body.toString('base64');
  }
  process.stdout.write(JSON.stringify(output));
} catch {
  process.exit(1);
}
