#!/usr/bin/env node
// Renders the brand mark into the PNG icons an installable PWA needs (192, 512, maskable 512, Apple touch 180).
// Run after changing the logo:  pnpm --filter @670send/pwa icons
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const logo = readFileSync(path.resolve(root, '../../brand/logo-icon.svg'), 'utf8').replace(/^﻿/, '');
const out = path.join(root, 'public', 'icons');
mkdirSync(out, { recursive: true });

// The artwork without its rounded teal tile, so it can sit on a full-bleed background (maskable icons).
const art = logo
  .replace(/<\?xml[^>]*>/, '')
  .replace(/<svg[^>]*>/, '')
  .replace(/<\/svg>/, '')
  .replace(/<title>[\s\S]*?<\/title>/, '')
  .replace(/<rect[^>]*rx="28"[^>]*\/>/, '');
// Maskable: the platform may crop to a circle — keep the mark inside the central 80 % "safe zone".
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#0B4F5C"/><g transform="translate(24 24) scale(0.6)">${art}</g></svg>`;
// Apple touch icons are not masked by the OS and must not have transparent corners.
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#0B4F5C"/><g transform="translate(10 10) scale(0.833)">${art}</g></svg>`;

const render = (svg, size, file) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(out, file));
await Promise.all([render(logo, 192, 'icon-192.png'), render(logo, 512, 'icon-512.png'), render(maskable, 512, 'maskable-512.png'), render(apple, 180, 'apple-touch-icon.png')]);
writeFileSync(path.join(root, 'public', 'favicon.svg'), logo);
console.log('icons written to public/icons');
