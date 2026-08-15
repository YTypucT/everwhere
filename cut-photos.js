#!/usr/bin/env node
/* ============================================================
   cut-photos.js — нарезка фото на responsive-варианты (.webp)
   ------------------------------------------------------------
   Проходит папку photos/ рекурсивно и для каждого исходника
   генерит рядом версии по ширине: name-400.webp, name-800.webp,
   name-1200.webp. Пропорции сохраняются, вверх НЕ растягивает.

   Запуск:
     npm i sharp          (один раз)
     node cut-photos.js           — обычный прогон
     node cut-photos.js --force   — перегенерить, даже если файлы есть

   Оригиналы НЕ трогаются и НЕ удаляются.
   ============================================================ */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

/* ---------- НАСТРОЙКИ — правь здесь ---------- */
const CONFIG = {
    inputDir: "photos",                 // корневая папка с фото (относительно этого скрипта)
    widths: [400, 800, 1200],           // ступени ширины
    quality: 80,                        // качество webp (78–82 — хороший баланс)
    extensions: [".jpg", ".jpeg", ".png", ".webp"], // что считаем исходником
};
/* -------------------------------------------- */

const FORCE = process.argv.includes("--force");

// суффикс сгенерированного файла: -400 / -800 / -1200 → чтобы не резать их повторно
const VARIANT_RE = new RegExp(`-(${CONFIG.widths.join("|")})\\.webp$`, "i");

let stats = { made: 0, skipped: 0, srcCount: 0, srcBytes: 0, outBytes: 0, errors: 0 };

/** рекурсивно собрать все файлы-исходники */
function collect(dir) {
    let out = [];
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
            out = out.concat(collect(full));
        } else if (isSource(full)) {
            out.push(full);
        }
    }
    return out;
}

function isSource(file) {
    const ext = path.extname(file).toLowerCase();
    if (!CONFIG.extensions.includes(ext)) return false;
    if (VARIANT_RE.test(file)) return false;          // это уже наш сгенерированный вариант
    return true;
}

async function processOne(src) {
    stats.srcCount++;
    const srcBytes = fs.statSync(src).size;
    stats.srcBytes += srcBytes;

    const dir = path.dirname(src);
    const base = path.basename(src, path.extname(src)); // имя без расширения

    let meta;
    try {
        meta = await sharp(src).metadata();
    } catch (e) {
        console.error(`  ✗ не читается: ${src} (${e.message})`);
        stats.errors++;
        return;
    }

    for (const w of CONFIG.widths) {
        const outPath = path.join(dir, `${base}-${w}.webp`);

        // не растягиваем вверх: если исходник уже уже целевой ширины — пропускаем ступень
        if (meta.width && meta.width < w) {
            continue;
        }

        // идемпотентность: пропускаем, если вариант свежее исходника (если не --force)
        if (!FORCE && fs.existsSync(outPath) && fs.statSync(outPath).mtimeMs >= fs.statSync(src).mtimeMs) {
            stats.skipped++;
            stats.outBytes += fs.statSync(outPath).size;
            continue;
        }

        try {
            await sharp(src)
                .rotate()                                  // учесть EXIF-ориентацию
                .resize({ width: w, withoutEnlargement: true })
                .webp({ quality: CONFIG.quality })
                .toFile(outPath);
            const outSize = fs.statSync(outPath).size;
            stats.outBytes += outSize;
            stats.made++;
            console.log(`  ✓ ${path.relative(CONFIG.inputDir, outPath)}  (${kb(outSize)})`);
        } catch (e) {
            console.error(`  ✗ ошибка на ${outPath}: ${e.message}`);
            stats.errors++;
        }
    }
}

const kb = b => `${(b / 1024).toFixed(0)} КБ`;
const mb = b => `${(b / 1024 / 1024).toFixed(1)} МБ`;

(async () => {
    const root = path.resolve(CONFIG.inputDir);
    if (!fs.existsSync(root)) {
        console.error(`Папка "${CONFIG.inputDir}" не найдена. Запускай скрипт рядом с ней.`);
        process.exit(1);
    }

    const files = collect(root);
    if (!files.length) {
        console.log("Исходников не найдено.");
        return;
    }

    console.log(`Нашёл исходников: ${files.length}. Режу в ${CONFIG.widths.join(" / ")}px${FORCE ? " (--force)" : ""}\n`);

    // последовательно — чтобы не съесть всю память на больших фото
    for (const f of files) {
        await processOne(f);
    }

    console.log(`\n──────────── готово ────────────`);
    console.log(`Исходников обработано : ${stats.srcCount}`);
    console.log(`Создано вариантов     : ${stats.made}`);
    console.log(`Пропущено (уже есть)  : ${stats.skipped}`);
    if (stats.errors) console.log(`Ошибок                : ${stats.errors}`);
    console.log(`Вес исходников        : ${mb(stats.srcBytes)}`);
    console.log(`Вес всех вариантов    : ${mb(stats.outBytes)}`);
})();
