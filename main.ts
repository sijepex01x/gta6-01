// Solmara — the make.fun entrypoint for bounty gta6-01.
//
// This program is the handover step: it gathers the finished game and its
// screenshots out of this repository and lays them down in the output
// directory the grader reads, then asks the vendored make.fun library to
// summarise everything into dossier.json, the document the judge reads.
//
// It needs nothing beyond the Node 22 standard library, and it runs the
// same way in the grader's sandbox as it does on a laptop:
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Leave MAKEFUN_OUTPUT_DIR unset and the output lands in /output, which is
// where the grader expects it.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The folder this file lives in — the root of the repository.
const repoRoot = dirname(fileURLToPath(import.meta.url));

// Where the finished entry goes. The grader supplies /output; a local run
// can point somewhere else with MAKEFUN_OUTPUT_DIR.
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fail loudly instead of handing in an empty game: the entry is worthless
// without its entry page, and a silent copy would hide the problem until
// the grader rejected it.
if (!existsSync(join(repoRoot, 'game', 'index.html'))) {
  throw new Error('game/index.html is missing — nothing to hand in');
}

function mirrorFolder(sourceName: string): void {
  const source = join(repoRoot, sourceName);
  if (!existsSync(source)) return;
  cpSync(source, join(outputDir, sourceName), { recursive: true });
}

mkdirSync(outputDir, { recursive: true });
mirrorFolder('game');
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
mirrorFolder('screenshots');

// The limits below mirror the scorer's own caps, so a build that would be
// refused never gets as far as the judge: at most four screenshots, none
// over 256 KiB; at most 993 entries totalling 48 MiB under game/, with no
// single path longer than 1000 bytes. The text cap (160 KiB) only trims how
// much source text the dossier carries; the other caps reject the entry.
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});

writeFileSync(join(outputDir, 'dossier.json'), dossier);
